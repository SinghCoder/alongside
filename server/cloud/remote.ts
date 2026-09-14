import { WebSocket } from 'ws'
import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { LocalFileStorage } from '@strands-agents/sdk/storage'
import { resolve } from 'node:path'
import { z } from 'zod'
import { LESSON_DIR } from '../partner/sessions'
import { wire } from './wire'

const OPEN_TIMEOUT_MS = 60000
const storageInput = z.object({ key: z.string().max(1000).refine(key => !key.startsWith('/') && !key.split('/').includes('..')), data: z.string().optional() })
export async function remoteAgent(input: { lessonId: string; prompt: string; system: string; modelId: string; tools: { name: string; toolSpec: unknown; invoke: (input: any) => Promise<any> }[] }, signal: AbortSignal, emit: (value: any) => void) {
  const region = process.env.AWS_REGION || 'us-east-1'
  const runtime = process.env.ALONGSIDE_RUNTIME_ARN!
  const hostname = `bedrock-agentcore.${region}.amazonaws.com`
  const path = `/runtimes/${encodeURIComponent(runtime)}/ws`
  const signer = new SignatureV4({ service: 'bedrock-agentcore', region, credentials: defaultProvider(), sha256: Sha256 })
  const signed = await signer.sign(new HttpRequest({ protocol: 'https:', hostname, method: 'GET', path,
    headers: { host: hostname, 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': input.lessonId } }))
  const socket = new WebSocket(`wss://${hostname}${path}`, { headers: signed.headers, handshakeTimeout: OPEN_TIMEOUT_MS })
  const stop = () => socket.close()
  signal.addEventListener('abort', stop, { once: true })
  const storage = new LocalFileStorage(resolve(LESSON_DIR, 'cloud-conversations', input.lessonId))
  const channel = wire(socket, async (method, value) => {
    if (method === 'tool') {
      const selected = input.tools.find(item => item.name === value.name)
      if (!selected) { throw new Error('Unknown tool') }
      return selected.invoke(value.input)
    }
    const { key, data } = storageInput.parse(value)
    if (method === 'read') { const bytes = await storage.read(key); return bytes ? Buffer.from(bytes).toString('base64') : null }
    if (method === 'write') { await storage.write(key, Buffer.from(data!, 'base64')); return null }
    if (method === 'list') { return storage.list(key) }
    if (method === 'delete') { await storage.delete(key); return null }
    throw new Error('Unknown storage operation')
  }, emit)
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    signal.throwIfAborted()
    return await channel.call('run', { ...input, tools: input.tools.map(item => item.toolSpec) }) as { answer: string }
  } finally { signal.removeEventListener('abort', stop); socket.close() }
}
