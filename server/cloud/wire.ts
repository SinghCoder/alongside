import { randomUUID } from 'node:crypto'
import type WebSocket from 'ws'

const FRAME_CHARS = 16000
const MAX_CHARS = 32 * 1024 * 1024
const CALL_TIMEOUT_MS = 10 * 60 * 1000
export type Handler = (method: string, value: any) => Promise<any>

// Both sides can request work while awaiting a response from the other side.
export function wire(socket: WebSocket, handle: Handler, notify: (value: any) => void = () => {}) {
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let fragments = ''
  function send(value: any) {
    const encoded = JSON.stringify(value)
    if (encoded.length > MAX_CHARS) { throw new Error('Runtime message exceeds limit') }
    for (let offset = 0; offset < encoded.length; offset += FRAME_CHARS) {
      socket.send(JSON.stringify({ part: encoded.slice(offset, offset + FRAME_CHARS), end: offset + FRAME_CHARS >= encoded.length }))
    }
  }
  socket.on('message', async raw => {
    try {
      const frame = JSON.parse(raw.toString())
      if (typeof frame.part !== 'string') { throw new Error('Invalid runtime frame') }
      fragments += frame.part
      if (fragments.length > MAX_CHARS) { throw new Error('Runtime message exceeds limit') }
      if (!frame.end) { return }
      const message = JSON.parse(fragments); fragments = ''
      if (message.method) {
        try { send({ id: message.id, value: await handle(message.method, message.value) }) }
        catch (error) { send({ id: message.id, error: error instanceof Error ? error.message : 'Runtime operation failed' }) }
        return
      }
      if (message.notice) { notify(message.notice); return }
      const call = pending.get(message.id)
      if (!call) { return }
      clearTimeout(call.timer); pending.delete(message.id)
      if (message.error) { call.reject(new Error(message.error)); return }
      call.resolve(message.value)
    } catch { socket.close(1008, 'Invalid runtime message') }
  })
  socket.on('close', () => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Runtime connection closed')) }
    pending.clear()
  })
  return {
    notice: (value: any) => send({ notice: value }),
    call(method: string, value: any): Promise<any> {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Runtime call timed out')) }, CALL_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        try { send({ id, method, value }) } catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
      })
    },
  }
}
