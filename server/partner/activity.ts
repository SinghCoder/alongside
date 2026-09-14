import { randomUUID } from 'node:crypto'
import type { AgentStreamEvent } from '@strands-agents/sdk'
import type { Activity } from '../../src/partner/activity.ts'

const MAX_TEXT = 32000
const MAX_ARRAY = 100
// Debug output is a bounded projection, never an agent/session/config object.
export function debugValue(value: unknown): unknown {
  if (value instanceof Uint8Array) { return `[binary: ${value.byteLength} bytes]` }
  if (typeof value === 'string') {
    let text = value.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[image data omitted]')
    for (const name of ['OPENAI_API_KEY', 'BRAVE_SEARCH_API_KEY', 'BRAVE_API_KEY', 'SEARCHAPI_API_KEY', 'SERPAPI_API_KEY', 'SERPAPI_KEY']) {
      const secret = process.env[name]
      if (secret) { text = text.replaceAll(secret, '[redacted]') }
    }
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n[truncated in activity panel]' : text
  }
  if (Array.isArray(value)) { return [...value.slice(0, MAX_ARRAY).map(debugValue), ...(value.length > MAX_ARRAY ? [`[${value.length - MAX_ARRAY} more items omitted]`] : [])] }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, /apikey|api_key|authorization|signature|redactedContent|bytes/i.test(key) ? '[omitted]' : debugValue(value)]))
  }
  return value
}

export function activityFeed(emit: (item: Activity) => void) {
  const started = new Map<string, number>()
  let message = randomUUID()
  function send(item: Activity) { emit({ ...item, input: debugValue(item.input), output: debugValue(item.output), text: item.text ? String(debugValue(item.text)) : undefined }) }
  function start(id: string, name: string, input: unknown, kind: Activity['kind']) {
    const at = Date.now(); started.set(id, at)
    send({ id, name, kind, input, at, status: 'running' })
  }
  function end(id: string, name: string, output: unknown, status: Activity['status'], kind: Activity['kind']) {
    const at = started.get(id) ?? Date.now(); started.delete(id)
    send({ id, name, kind, output, status, at, durationMs: Date.now() - at })
  }
  return {
    async operation(name: string, input: unknown, run: () => Promise<unknown>) {
      const id = randomUUID(); start(id, name, input, 'operation')
      try { const output = await run(); end(id, name, output, 'done', 'operation'); return output }
      catch (error) { end(id, name, error instanceof Error ? error.message : 'Operation failed', 'error', 'operation'); throw error }
    },
    watch(event: AgentStreamEvent) {
      if (event.type === 'beforeToolCallEvent') { start(event.toolUse.toolUseId, event.toolUse.name, event.toolUse.input, 'tool') }
      if (event.type === 'afterToolCallEvent') { end(event.toolUse.toolUseId, event.toolUse.name, event.result.content, event.result.status === 'error' ? 'error' : 'done', 'tool') }
      if (event.type === 'beforeModelCallEvent') { message = randomUUID() }
      if (event.type !== 'modelStreamUpdateEvent') { return }
      if (event.event.type === 'modelMessageStopEvent') {
        for (const kind of ['summary', 'text'] as const) {
          const id = `${message}-${kind}`
          if (started.has(id)) { end(id, kind === 'summary' ? 'Reasoning summary' : 'Agent message', undefined, 'done', kind) }
        }
      }
      if (event.event.type !== 'modelContentBlockDeltaEvent') { return }
      const delta = event.event.delta
      // The OpenAI Responses adapter maps public reasoning-summary deltas here.
      if (delta.type !== 'textDelta' && delta.type !== 'reasoningContentDelta') { return }
      if (!delta.text) { return }
      const kind = delta.type === 'textDelta' ? 'text' : 'summary'
      const id = `${message}-${kind}`
      if (!started.has(id)) { started.set(id, Date.now()) }
      send({ id, kind, name: kind === 'summary' ? 'Reasoning summary' : 'Agent message', status: 'running', at: started.get(id)!, text: delta.text })
    },
  }
}
