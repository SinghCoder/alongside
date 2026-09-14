import { LocalFileStorage } from '@strands-agents/sdk/storage'
import { z } from 'zod'
import { AGENT_ID } from './sessions.ts'
import { debugValue } from './activity.ts'
import { mergeActivity, type Activity } from '../../src/partner/activity.ts'

const snapshotSchema = z.object({ createdAt: z.string(), data: z.object({ messages: z.array(z.object({ role: z.string(), content: z.array(z.record(z.string(), z.unknown())) })) }) })
const useSchema = z.object({ toolUseId: z.string(), name: z.string(), input: z.unknown() })
const resultSchema = z.object({ toolUseId: z.string(), status: z.string(), content: z.unknown() })

// Recover visible exchanges only. Compaction may have removed earlier messages;
// timings and streamed reasoning summaries cannot be recovered from this snapshot.
export async function retainedActivity(directory: string, id: string) {
  z.string().uuid().parse(id)
  const storage = new LocalFileStorage(directory)
  const bytes = await storage.read(`conversations/session/${id}/scopes/agent/${AGENT_ID}/snapshots/snapshot_latest.json`)
  if (!bytes) { return [] }
  const parsed = snapshotSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
  if (!parsed.success) { return [] }
  const at = Date.parse(parsed.data.createdAt) || 0
  let items: Activity[] = []
  for (const [index, message] of parsed.data.data.messages.entries()) {
    for (const [blockIndex, block] of message.content.entries()) {
      const use = useSchema.safeParse(block.toolUse)
      if (use.success) {
        items = mergeActivity(items, { id: `retained-${use.data.toolUseId}`, kind: 'tool', name: use.data.name, at, recovered: true,
          input: debugValue(use.data.input), status: 'running' })
        continue
      }
      const result = resultSchema.safeParse(block.toolResult)
      if (result.success) {
        const id = `retained-${result.data.toolUseId}`
        const existing = items.find(item => item.id === id)
        if (existing) { items = mergeActivity(items, { ...existing, status: result.data.status === 'success' ? 'done' : 'error', output: debugValue(result.data.content) }) }
        continue
      }
      if (typeof block.text !== 'string') { continue }
      let text = message.role === 'assistant' ? block.text : ''
      if (message.role === 'user') {
        try { const input = JSON.parse(block.text); if (typeof input.question === 'string') { text = input.question } } catch { /* Older non-question context is not an activity entry. */ }
      }
      if (!text) { continue }
      items.push({ id: `retained-text-${index}-${blockIndex}`, kind: 'text', name: message.role === 'user' ? 'Question' : 'Agent message',
        at, recovered: true, status: 'done', text: String(debugValue(text)) })
    }
  }
  return items.map(item => item.status === 'running' ? { ...item, status: 'error' as const, output: 'Result unavailable in retained conversation.' } : item)
}
