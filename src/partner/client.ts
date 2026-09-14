import type { Event, PartnerInput, Reply } from './protocol'

export async function askPartner(input: PartnerInput, signal: AbortSignal, handle: (event: Event) => Promise<(Reply & { documentRevision: number }) | void>) {
  const response = await fetch('/api/partner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal })
  if (!response.ok) { throw new Error((await response.json()).error ?? 'Request failed') }
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = '', runId = '', completed = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) { break }
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const event = JSON.parse(buffer.slice(0, newline)) as Event
        buffer = buffer.slice(newline + 1)
        if (event.type === 'heartbeat') { continue }
        if (event.type === 'hello') { runId = event.runId; continue }
        if (event.type === 'error') { throw new Error(event.message) }
        const reply = await handle(event)
        if (event.type === 'done') { completed = true }
        if (!reply || !('id' in event)) { continue }
        const payload = JSON.stringify({ ...reply, runId, id: event.id })
        const acknowledge = () => fetch('/api/partner/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal })
        // A lost response may be retried with the same operation ID, never replayed.
        const ack = await acknowledge().catch(error => { signal.throwIfAborted(); if (!(error instanceof TypeError)) { throw error } return acknowledge() })
        if (!ack.ok) { throw new Error('Could not acknowledge the drawing') }
      }
    }
    if (!completed) { throw new Error('The explanation connection ended early') }
  } finally { reader.releaseLock() }
}
