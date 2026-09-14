import type { Plugin } from 'vite'
import { requestSchema } from '../src/agent/schema'
import { explain, DEFAULT_MODEL } from './agent'

const HTTP = { OK: 200, BAD_REQUEST: 400, FORBIDDEN: 403, METHOD: 405, BUSY: 429, ERROR: 502, UNAVAILABLE: 503 } as const
const MAX_BODY_BYTES = 64 * 1024
const TIMEOUT_MS = 60000

export function agentPlugin(): Plugin {
  let busy = false
  return { name: 'local-whiteboard-agent', configureServer(server) {
    server.middlewares.use('/api/explain', async (req, res) => {
      const send = (status: number, data: unknown) => {
        if (res.destroyed) { return }
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(data))
      }
      if (req.method !== 'POST') { send(HTTP.METHOD, { error: 'Use POST' }); return }
      const origin = req.headers.origin
      if (origin && origin !== `http://${req.headers.host}`) { send(HTTP.FORBIDDEN, { error: 'Origin rejected' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { send(HTTP.BAD_REQUEST, { error: 'Expected JSON' }); return }
      const key = process.env.OPENAI_API_KEY
      if (!key) { send(HTTP.UNAVAILABLE, { error: 'Set OPENAI_API_KEY in the server environment and restart npm run dev.' }); return }
      if (busy) { send(HTTP.BUSY, { error: 'An explanation is already running.' }); return }
      busy = true
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      res.on('close', () => controller.abort())
      try {
        let body = ''
        for await (const chunk of req) {
          body += chunk.toString()
          if (Buffer.byteLength(body) > MAX_BODY_BYTES) { send(HTTP.BAD_REQUEST, { error: 'Request too large' }); return }
        }
        let input
        try { input = requestSchema.parse(JSON.parse(body)) }
        catch { send(HTTP.BAD_REQUEST, { error: 'Invalid question or board context' }); return }
        const plan = await explain(input, key, process.env.OPENAI_MODEL || DEFAULT_MODEL, controller.signal)
        send(HTTP.OK, plan)
      } catch {
        // Provider errors can contain request details; expose no raw exception.
        send(HTTP.ERROR, { error: controller.signal.aborted ? 'The request timed out. Try a shorter question.' : 'OpenAI could not produce a valid board plan. Check API access or try again.' })
      } finally { clearTimeout(timer); busy = false }
    })
  } }
}
