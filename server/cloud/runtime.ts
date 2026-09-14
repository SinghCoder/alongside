import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { Agent, FunctionTool, ImageBlock, TextBlock, SessionManager, SummarizingConversationManager } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { activityFeed } from '../partner/activity'
import { restoreLesson } from '../partner/sessions'
import { wire } from './wire'

const PORT = 8080
const HTTP_OK = 200
const MAX_TOKENS = 6000
const secrets = new SecretsManagerClient({})
let key: Promise<string> | undefined
function modelKey() {
  key ??= secrets.send(new GetSecretValueCommand({ SecretId: process.env.ALONGSIDE_SECRET_ARN })).then(result => {
    const value = JSON.parse(result.SecretString!).OPENAI_API_KEY
    if (!value) { throw new Error('Model key unavailable') }
    process.env.OPENAI_API_KEY = value
    return value as string
  })
  return key
}
let busy = 0
const server = createServer((_req, res) => { res.writeHead(HTTP_OK, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: busy ? 'HealthyBusy' : 'Healthy' })) })
const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 * 1024 })
sockets.on('connection', socket => {
  const controller = new AbortController()
  socket.on('close', () => controller.abort())
  let active = false
  const channel = wire(socket, async (method, input) => {
    if (method !== 'run' || active) { throw new Error('Runtime already active or unsupported request') }
    active = true; busy++
    const feed = activityFeed(item => channel.notice(item))
    try {
      const storage = {
        read: async (key: string) => { const value = await channel.call('read', { key }); return value === null ? null : new Uint8Array(Buffer.from(value, 'base64')) },
        write: async (key: string, value: Uint8Array) => { await channel.call('write', { key, data: Buffer.from(value).toString('base64') }) },
        list: async (key: string) => await channel.call('list', { key }) as string[],
        delete: async (key: string) => { await channel.call('delete', { key }) },
      }
      const tools = input.tools.map((spec: any) => new FunctionTool({ ...spec, callback: async (value: any) => {
        const blocks = await channel.call('tool', { name: spec.name, input: value })
        if (!Array.isArray(blocks)) { return blocks }
        return blocks.map(block => block.image ? ImageBlock.fromJSON(block) : block.text !== undefined ? new TextBlock(block.text) : block)
      } }))
      const agent = new Agent({ id: 'whiteboard', tools, systemPrompt: input.system, printer: false, retryStrategy: null,
        sessionManager: new SessionManager({ sessionId: input.lessonId, storage, saveLatestOn: 'message' }),
        conversationManager: new SummarizingConversationManager({ proactiveCompression: true }),
        model: new OpenAIModel({ apiKey: await modelKey(), modelId: input.modelId, maxTokens: MAX_TOKENS, params: { reasoning: { summary: 'auto' } } }) })
      await restoreLesson(agent)
      let answer = ''
      for await (const event of agent.stream(input.prompt, { cancelSignal: controller.signal })) {
        feed.watch(event)
        if (event.type === 'agentResultEvent') { answer = event.result.toString() }
      }
      return { answer }
    } finally { active = false; busy-- }
  })
})
server.listen(PORT, '0.0.0.0')
