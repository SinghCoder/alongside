import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdir, readFile, writeFile, readdir, open, cp, rm, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { IMAGE_DIR } from './images.ts'
import { LESSON_DIR } from './sessions.ts'
import type { LibraryAsset } from '../../src/library/types.ts'

const IMAGE = 'alongside-lesson:1'
const OUTPUT_LIMIT = 24000
const FILE_LIMIT = 8 * 1024 * 1024
const COMMAND_MS = 300000
const MAX_RPC_CALLS = 200
const MAX_IMAGES = 12
const POLL_MS = 50
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const RPC = z.object({ method: z.string(), value: z.unknown().optional() })
const IMPORT = z.object({ data: z.string().max(FILE_LIMIT), name: z.string().max(200), sourceUrl: z.string().max(2000).default('') })
type Bridge = (method: string, value: unknown) => Promise<unknown>

function docker(args: string[]) {
  return process.env.ALONGSIDE_CONTAINER_CLI === 'colima'
    ? spawn('colima', ['ssh', '--', 'docker', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

// No host paths supplied by model code are dereferenced by the broker.
async function readRequest(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if ((await file.stat()).size > FILE_LIMIT) { throw new Error('RPC request too large') }
    return RPC.parse(JSON.parse(await file.readFile('utf8')))
  } finally { await file.close() }
}
async function reply(path: string, result: unknown) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(JSON.stringify(result)) } finally { await file.close() }
}

export async function shellWorkspace(lessonId: string, bridge: Bridge, register: (asset: LibraryAsset) => void) {
  z.string().uuid().parse(lessonId)
  const directory = resolve(LESSON_DIR, 'workspaces', lessonId)
  await mkdir(directory, { recursive: true })
  if (await realpath(directory) !== directory) { throw new Error('Workspace must not be a symlink') }
  const runtime = resolve(LESSON_DIR, 'runtimes', randomUUID())
  await mkdir(runtime, { recursive: true })
  await cp(resolve('sandbox/lesson/workspace'), runtime, { recursive: true })
  await mkdir(join(runtime, 'docs'), { recursive: true })
  // Copy public declarations, never the server's dependencies or environment.
  await cp(resolve('node_modules/@excalidraw/excalidraw/dist/types/excalidraw'), join(runtime, 'docs/excalidraw'), { recursive: true })
  for (const path of ['references/page-api.md', 'references/document-api.md', 'schemas/document.json', 'schemas/board.json', 'schemas/catalog.json', 'schemas/images.json', 'references/web-images.md', 'references/asset-catalog.md']) {
    await writeFile(join(runtime, 'docs', path.replaceAll('/', '-')), String(await bridge('help', path)))
  }
  const emitted: Buffer[] = []
  let calls = 0, imageCount = 0
  async function call(method: string, value: unknown) {
    if (++calls > MAX_RPC_CALLS) { throw new Error('SDK call budget reached') }
    if (method === 'emitImage') {
      if (++imageCount > MAX_IMAGES) { throw new Error('Image observation budget reached') }
      const bytes = Buffer.from(z.string().max(FILE_LIMIT).parse(value), 'base64')
      if (!bytes.subarray(0, 8).equals(PNG_HEADER)) { throw new Error('view requires a PNG; convert with Pillow first') }
      emitted.push(bytes); return { viewed: true }
    }
    if (method === 'importImage') {
      const input = IMPORT.parse(value)
      const bytes = Buffer.from(input.data, 'base64')
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_HEADER)) { throw new Error('Import a PNG file') }
      const id = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
      const asset = { id: `local-${id}`, name: input.name, src: `/api/images/${id}.png`, pack: 'Lesson files', group: 'Generated', format: 'png', extraction: 'web-image', sourceUrl: input.sourceUrl, archived: false,
        width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: 'image/png' }
      await mkdir(IMAGE_DIR, { recursive: true })
      await writeFile(join(IMAGE_DIR, `${id}.png`), bytes)
      await writeFile(join(IMAGE_DIR, `${id}.json`), JSON.stringify(asset))
      register(asset)
      return { ...asset, assetId: asset.id }
    }
    const result = await bridge(method, value)
    if (method !== 'images.use' && method !== 'assets.get') { return result }
    const asset = result as LibraryAsset
    const src = asset.src
    if (!/^\/api\/images\/[a-f0-9]{20}\.(png|jpg|webp)$/.test(src) && !/^\/library\/[a-f0-9]{20}\.(png|jpg|jpeg|svg)$/.test(src)) { throw new Error('Invalid asset path') }
    const source = src.startsWith('/api/images/') ? join(IMAGE_DIR, src.split('/').at(-1)!) : resolve('public', '.' + src)
    return { ...asset, assetId: asset.id, filename: src.split('/').at(-1), data: (await readFile(source)).toString('base64') }
  }
  async function exec(command: string, signal: AbortSignal) {
    const runId = randomUUID()
    const name = `alongside-${runId}`
    const rpcDir = resolve(LESSON_DIR, 'rpc', runId)
    await mkdir(rpcDir, { recursive: true })
    const child = docker(['run', '--rm', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '96', '--memory', '512m', '--cpus', '1', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--tmpfs', '/tmp:rw,nosuid,size=128m', '-v', `${directory}:/workspace`, '-v', `${runtime}:/opt/lesson:ro`, '-v', `${rpcDir}:/bridge`, IMAGE, 'bash', '-lc', command])
    let stdout = '', stderr = '', done = false, stdoutTruncated = false, stderrTruncated = false
    child.stdout.on('data', chunk => { stdoutTruncated ||= stdout.length + chunk.length > OUTPUT_LIMIT; stdout = (stdout + chunk).slice(-OUTPUT_LIMIT) })
    child.stderr.on('data', chunk => { stderrTruncated ||= stderr.length + chunk.length > OUTPUT_LIMIT; stderr = (stderr + chunk).slice(-OUTPUT_LIMIT) })
    const ended = new Promise<number>((resolve, reject) => {
      child.on('error', error => { done = true; reject(error) })
      child.on('close', code => { done = true; resolve(code ?? 1) })
    })
    // Observe rejection immediately, even while the broker is waiting on playback.
    void ended.catch(() => {})
    const deadline = AbortSignal.timeout(COMMAND_MS)
    const stopped = AbortSignal.any([signal, deadline])
    const stop = () => { docker(['rm', '-f', name]); child.kill() }
    stopped.addEventListener('abort', stop, { once: true })
    const handled = new Set<string>()
    try {
      while (!done) {
        stopped.throwIfAborted()
        for (const filename of await readdir(rpcDir)) {
          if (!/^[a-f0-9-]+\.request$/.test(filename) || handled.has(filename)) { continue }
          handled.add(filename)
          let response
          try { const request = await readRequest(join(rpcDir, filename)); response = { result: await call(request.method, request.value) } }
          catch (error) { response = { error: error instanceof Error ? error.message : 'SDK call failed' } }
          await reply(join(rpcDir, filename.replace('.request', '.response')), response)
        }
        await delay(POLL_MS)
      }
      stopped.throwIfAborted()
      return { exitCode: await ended, stdout, stderr, stdoutTruncated, stderrTruncated }
    } finally {
      stopped.removeEventListener('abort', stop)
      if (!done) { stop() }
      await rm(rpcDir, { recursive: true, force: true })
    }
  }
  return { exec, takeImages: () => emitted.splice(0), directory, close: () => rm(runtime, { recursive: true, force: true }) }
}
