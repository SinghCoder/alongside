import { acceptsOrigin } from '../cloud/access'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import type { BoardDocument } from '../../src/board/document'
import { lessonStore, LessonConflict } from './store'
import { z } from 'zod'
import { documentSchema, inputSchema, replySchema, type Reply, type Event } from '../../src/partner/protocol'
import { DEFAULT_MODEL } from '../agent'
import { runPartner } from './agent'

const HTTP = { OK: 200, BAD: 400, FORBIDDEN: 403, METHOD: 405, BUSY: 429, ERROR: 502, UNAVAILABLE: 503, CONFLICT: 409 } as const
const MAX_BYTES = 16 * 1024 * 1024
const HEARTBEAT_MS = 15000
const TIMEOUT_MS = 10 * 60 * 1000
const ackSchema = replySchema.extend({ runId: z.string().uuid(), id: z.number().int(), documentRevision: z.number().int().nonnegative() })
type Pending = { id: number; resolve: (reply: Reply) => void; reject: (error: Error) => void }

async function readBody(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString()
    if (Buffer.byteLength(body) > MAX_BYTES) { throw new Error('Request too large') }
  }
  return JSON.parse(body)
}

export function partnerPlugin(): Plugin {
  const store = lessonStore()
  const runs = new Map<string, { lessonId: string; pending?: Pending; receipts: Map<number, string> }>()
  return { name: 'whiteboard-interpreter', configureServer(server) {
    server.middlewares.use('/api/lessons', async (req, res) => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
      if (!acceptsOrigin(req.headers.origin, req.headers.host)) { send(HTTP.FORBIDDEN, { error: 'Origin rejected' }); return }
      try {
        if (req.method === 'GET' && req.url === '/') { send(HTTP.OK, await store.list()); return }
        if (req.method === 'POST' && req.url === '/') { send(HTTP.OK, await store.create()); return }
        const id = z.string().uuid().parse(req.url?.slice(1))
        if (req.method === 'GET') { send(HTTP.OK, await store.read(id)); return }
        if (req.method !== 'PUT') { send(HTTP.METHOD, { error: 'Unsupported method' }); return }
        const input = z.object({ revision: z.number().int().nonnegative(), document: documentSchema }).parse(await readBody(req))
        send(HTTP.OK, await store.save(id, input.revision, input.document as unknown as BoardDocument))
      } catch (error) { send(error instanceof LessonConflict ? HTTP.CONFLICT : HTTP.BAD, { error: error instanceof Error ? error.message : 'Lesson storage failed' }) }
    })
    server.middlewares.use('/api/partner', async (req, res) => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.method !== 'POST') { send(HTTP.METHOD, { error: 'Use POST' }); return }
      if (!acceptsOrigin(req.headers.origin, req.headers.host)) { send(HTTP.FORBIDDEN, { error: 'Origin rejected' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { send(HTTP.BAD, { error: 'Expected JSON' }); return }
      let body
      try { body = await readBody(req) } catch { send(HTTP.BAD, { error: 'Invalid request' }); return }
      if (req.url === '/ack') {
        const ack = ackSchema.safeParse(body)
        if (!ack.success) { send(HTTP.BAD, { error: 'Invalid acknowledgement' }); return }
        const run = runs.get(ack.data.runId)
        if (!run) { send(HTTP.CONFLICT, { error: 'This run ended. Saved drawings remain in the lesson.' }); return }
        const encoded = JSON.stringify(ack.data)
        const receipt = run.receipts.get(ack.data.id)
        if (receipt) { send(receipt === encoded ? HTTP.OK : HTTP.CONFLICT, { ok: receipt === encoded }); return }
        if (run.pending?.id !== ack.data.id) { send(HTTP.CONFLICT, { error: 'No matching contribution' }); return }
        try {
          const saved = await store.read(run.lessonId)
          const pending = run.pending
          if (!pending || pending.id !== ack.data.id) { send(HTTP.CONFLICT, { error: 'Contribution ended' }); return }
          const changed = saved.revision !== ack.data.documentRevision
          run.receipts.set(ack.data.id, encoded); run.pending = undefined
          pending.resolve({ ...ack.data, ...saved.document.snapshot, status: changed ? 'stale' : ack.data.status, image: changed ? undefined : ack.data.image })
          send(HTTP.OK, { ok: true })
        } catch { send(HTTP.ERROR, { error: 'Could not confirm saved board' }) }
        return
      }
      const input = inputSchema.safeParse(body)
      if (!input.success) { send(HTTP.BAD, { error: 'Invalid board context' }); return }
      const key = process.env.OPENAI_API_KEY
      if (!key && !process.env.ALONGSIDE_RUNTIME_ARN) { send(HTTP.UNAVAILABLE, { error: 'Set OPENAI_API_KEY and restart the server' }); return }
      let started
      try { started = await store.begin(input.data.lessonId, input.data.turnId, input.data.revision, input.data.question) }
      catch (error) { send(HTTP.CONFLICT, { error: error instanceof Error ? error.message : 'Cannot start lesson' }); return }
      const runId = randomUUID()
      const run = { lessonId: input.data.lessonId, pending: undefined as Pending | undefined, receipts: new Map<number, string>() }
      runs.set(runId, run)
      const controller = new AbortController()
      const abort = () => { controller.abort(); run.pending?.reject(new Error('Explanation stopped')); run.pending = undefined }
      const timer = setTimeout(abort, TIMEOUT_MS)
      res.on('close', abort)
      res.writeHead(HTTP.OK, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
      const emit = (event: Event) => { if (!res.destroyed) { res.write(JSON.stringify(event) + '\n') } }
      emit({ type: 'hello', runId })
      const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), HEARTBEAT_MS)
      let activityWrites = Promise.resolve()
      const activity = (item: import('../../src/partner/activity').Activity) => {
        const event = { ...item, turnId: input.data.turnId }
        activityWrites = activityWrites.then(() => store.activity(input.data.lessonId, event))
        void activityWrites.catch(abort)
        emit({ type: 'activity', item: event })
      }
      let id = 0
      try {
        if (started.replay !== undefined) {
          emit({ type: 'done', answer: started.replay, skills: [] }); return
        }
        activity({ id: input.data.turnId, kind: 'text', name: 'Question', status: 'done', at: Date.now(), text: input.data.question })
        const result = await runPartner(input.data, started.record.document.snapshot, key || '', process.env.OPENAI_MODEL || DEFAULT_MODEL, controller.signal, command => {
          controller.signal.throwIfAborted()
          if (run.pending) { throw new Error('Await the previous board operation') }
          return new Promise<Reply>((resolve, reject) => {
            run.pending = { id: ++id, resolve, reject }
            emit({ ...command, id })
          })
        }, activity)
        await activityWrites
        await store.finish(input.data.lessonId, input.data.turnId, result.answer)
        emit({ type: 'done', ...result })
      } catch {
        emit({ type: 'error', message: controller.signal.aborted ? 'Explanation stopped or timed out.' : 'The agent could not finish. Your completed drawing is preserved.' })
      } finally {
        clearInterval(heartbeat); clearTimeout(timer); res.off('close', abort); abort(); runs.delete(runId)
        try { await activityWrites; await store.finish(input.data.lessonId, input.data.turnId) } finally { store.release(input.data.lessonId); res.end() }
      }
    })
  } }
}
