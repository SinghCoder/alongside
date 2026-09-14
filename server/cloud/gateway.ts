import { createServer, request as httpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { issueCookie, readCookie, sameSecret, acceptsOrigin } from './access'

const HTTP = { OK: 200, BAD: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, BUSY: 429, ERROR: 502 }
const PORT = 8080
const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const COOKIE = 'alongside_session'
const MAX_WORKERS = 2
const MAX_DAILY_TURNS = 30
const MAX_GLOBAL_TURNS = 100
const IDLE_MS = 20 * 60 * 1000
const ROOT = process.env.ALONGSIDE_DATA_DIR || '/var/lib/alongside'
const secret = process.env.ALONGSIDE_COOKIE_SECRET!
const code = process.env.ALONGSIDE_ACCESS_CODE!
const originSecret = process.env.ALONGSIDE_ORIGIN_SECRET!
if (!secret || !code || !originSecret) { throw new Error('Hosted access configuration missing') }
const workers = new Map<string, { child: ChildProcess; port: Promise<number>; lastUsed: number }>()
const usageFile = resolve(ROOT, 'usage.json')
await mkdir(ROOT, { recursive: true })
let usage: { day: string; total: number; users: Record<string, number> } = JSON.parse(await readFile(usageFile, 'utf8').catch(() => '{"day":"","total":0,"users":{}}'))
let writes = Promise.resolve()
const attempts = new Map<string, { at: number; count: number }>()
function worker(id: string) {
  const previous = workers.get(id)
  if (previous) { previous.lastUsed = Date.now(); return previous.port }
  if (workers.size >= MAX_WORKERS) { throw new Error('Demo busy. Please try again shortly.') }
  const child = fork(resolve('server/cloud/worker.ts'), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, ALONGSIDE_DATA_DIR: resolve(ROOT, 'users', id), NODE_OPTIONS: '--max-old-space-size=256' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const port = new Promise<number>((resolve, reject) => {
    child.once('message', (value: any) => resolve(value.port))
    child.once('error', reject)
    child.once('exit', () => { workers.delete(id); reject(new Error('Lesson worker stopped')) })
  })
  workers.set(id, { child, port, lastUsed: Date.now() })
  return port
}
setInterval(() => {
  for (const [id, entry] of workers) {
    if (Date.now() - entry.lastUsed > IDLE_MS) { entry.child.kill(); workers.delete(id) }
  }
}, 60000).unref()
const server = createServer(async (req, res) => {
  const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
  if (!sameSecret(String(req.headers['x-alongside-origin'] || ''), originSecret)) { send(HTTP.FORBIDDEN, { error: 'Origin rejected' }); return }
  if (!acceptsOrigin(req.headers.origin, req.headers.host)) { send(HTTP.FORBIDDEN, { error: 'Origin rejected' }); return }
  const token = (req.headers.cookie || '').split('; ').find(item => item.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || ''
  const id = readCookie(token, secret)
  if (req.url === '/api/auth' && req.method === 'GET') { send(HTTP.OK, { authenticated: Boolean(id), hosted: true }); return }
  if (req.url === '/api/auth' && req.method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0]
    const attempt = attempts.get(ip)
    if (attempt && Date.now() - attempt.at < 60000 && attempt.count >= 10) { send(HTTP.BUSY, { error: 'Please wait a minute before retrying.' }); return }
    attempts.set(ip, { at: attempt?.at && Date.now() - attempt.at < 60000 ? attempt.at : Date.now(), count: attempt && Date.now() - attempt.at < 60000 ? attempt.count + 1 : 1 })
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 1024) { send(HTTP.BAD, { error: 'Request too large' }); return } }
    let submitted = ''
    try { submitted = String(JSON.parse(body).code || '') } catch { send(HTTP.BAD, { error: 'Invalid request' }); return }
    if (!sameSecret(submitted, code)) { send(HTTP.UNAUTHORIZED, { error: 'Incorrect access code' }); return }
    res.setHeader('Set-Cookie', `${COOKIE}=${issueCookie(id || randomUUID(), secret, Date.now() + SESSION_MS)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_MS / 1000}`)
    send(HTTP.OK, { authenticated: true }); return
  }
  if (!id) { send(HTTP.UNAUTHORIZED, { error: 'Enter the demo access code.' }); return }
  if (!req.url?.startsWith('/api/')) { send(HTTP.NOT_FOUND, { error: 'Not found' }); return }
  if (req.url === '/api/partner' && req.method === 'POST') {
    const day = new Date().toISOString().slice(0, 10)
    if (usage.day !== day) { usage = { day, total: 0, users: {} } }
    if ((usage.users[id] || 0) >= MAX_DAILY_TURNS || usage.total >= MAX_GLOBAL_TURNS) { send(HTTP.BUSY, { error: 'Demo daily question limit reached.' }); return }
    usage.total++; usage.users[id] = (usage.users[id] || 0) + 1
    const encoded = JSON.stringify(usage)
    writes = writes.then(() => writeFile(usageFile, encoded))
    await writes
  }
  try {
    const port = await worker(id)
    const headers = { ...req.headers }; delete headers['x-alongside-origin']
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers }, response => {
      res.writeHead(response.statusCode || HTTP.ERROR, response.headers); response.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) { send(HTTP.ERROR, { error: 'Lesson connection failed' }) } else { res.end() } })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  } catch (error) { send(HTTP.BUSY, { error: error instanceof Error ? error.message : 'Demo busy' }) }
})
server.listen(Number(process.env.ALONGSIDE_PORT || PORT), '0.0.0.0', () => process.send?.({ port: (server.address() as { port: number }).port }))
process.on('SIGTERM', () => {
  for (const entry of workers.values()) { entry.child.kill() }
  server.close(); process.exit(0)
})
