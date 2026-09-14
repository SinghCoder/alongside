import { appendFile, writeFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { retainedActivity } from './retained.ts'
import { mergeActivity, type Activity } from '../../src/partner/activity.ts'
import { randomUUID } from 'node:crypto'
import { LocalFileStorage } from '@strands-agents/sdk/storage'
import { z } from 'zod'
import { EMPTY_DOCUMENT, type BoardDocument } from '../../src/board/document.ts'
import type { LessonRecord } from '../../src/partner/protocol.ts'
import { LESSON_DIR } from './sessions.ts'

type Turn = { id: string; status: 'running' | 'done' | 'interrupted'; answer?: string }
type Stored = LessonRecord & { turns: Turn[] }
export class LessonConflict extends Error {}

export function lessonStore(directory = LESSON_DIR) {
  const storage = new LocalFileStorage(directory)
  const queues = new Map<string, Promise<unknown>>()
  const active = new Set<string>()
  const seeded = new Set<string>()
  const activityQueues = new Map<string, Promise<void>>()
  const logPath = (id: string) => join(directory, 'activity', `${z.string().uuid().parse(id)}.jsonl`)
  async function history(id: string) {
    await activityQueues.get(id)
    let source = ''
    try { source = await readFile(logPath(id), 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error } return retainedActivity(directory, id) }
    let items: Activity[] = []
    for (const line of source.split('\n')) {
      if (!line) { continue }
      try { items = mergeActivity(items, JSON.parse(line)) } catch { /* Ignore a partial final journal write. */ }
    }
    return items.map(item => item.status === 'running' && !active.has(id) ? { ...item, status: 'error' as const, output: item.output ?? 'Run ended before completion.' } : item)
  }
  const path = (id: string) => `documents/${z.string().uuid().parse(id)}.json`
  async function read(id: string): Promise<Stored> {
    const bytes = await storage.read(path(id))
    if (!bytes) { throw new Error('Lesson not found') }
    const record = JSON.parse(new TextDecoder().decode(bytes)) as Stored
    record.interrupted = record.turns.at(-1)?.status !== 'done' && record.turns.length > 0 && !active.has(id)
    return record
  }
  async function write(record: Stored) {
    await storage.write(path(record.id), new TextEncoder().encode(JSON.stringify(record)))
    return record
  }
  function change<T>(id: string, apply: (record: Stored) => Promise<T>) {
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => apply(await read(id)))
    queues.set(id, next)
    void next.finally(() => { if (queues.get(id) === next) { queues.delete(id) } }).catch(() => {})
    return next
  }
  return {
    async read(id: string) { return { ...await read(id), activity: await history(id) } },
    async list() {
      let files: string[]
      try { files = await readdir(join(directory, 'documents')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return [] } throw error }
      const records = await Promise.all(files.filter(file => /^[a-f0-9-]+\.json$/.test(file)).map(async file => {
        const record = await read(file.slice(0, -5))
        const modified = await stat(join(directory, 'documents', file))
        return { id: record.id, title: record.title || record.document.snapshot.scene.flatMap(item => item.kind === 'text' ? [item.text] : item.kind === 'native' && typeof item.element.text === 'string' ? [item.element.text] : []).find(Boolean)?.slice(0, 120) || 'Untitled lesson', updatedAt: modified.mtimeMs, interrupted: record.interrupted }
      }))
      return records.sort((a, b) => b.updatedAt - a.updatedAt)
    },
    activity(id: string, item: Activity) {
      const next = (activityQueues.get(id) ?? Promise.resolve()).then(async () => {
        await mkdir(join(directory, 'activity'), { recursive: true })
        if (!seeded.has(id)) {
          const previous = await retainedActivity(directory, id)
          try { await writeFile(logPath(id), previous.map(item => JSON.stringify(item) + '\n').join(''), { flag: 'wx' }) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error } }
          seeded.add(id)
        }
        await appendFile(logPath(id), JSON.stringify(item) + '\n')
      })
      activityQueues.set(id, next)
      void next.catch(() => {})
      return next
    },
    create: () => write({ id: randomUUID(), revision: 0, document: EMPTY_DOCUMENT, answer: '', interrupted: false, turns: [] }),
    save(id: string, revision: number, document: BoardDocument) {
      return change(id, async record => {
        // A retry of an already committed save is harmless.
        if (JSON.stringify(record.document) === JSON.stringify(document)) { return record }
        if (record.revision !== revision) { throw new LessonConflict('This lesson changed in another tab. Reload before editing.') }
        return write({ ...record, revision: revision + 1, document })
      })
    },
    async begin(id: string, turnId: string, revision: number, question = '') {
      if (active.has(id)) { throw new LessonConflict('This lesson already has an active question.') }
      active.add(id)
      try {
        return await change(id, async record => {
          const previous = record.turns.find(turn => turn.id === turnId)
          if (previous?.status === 'done') { return { record, replay: previous.answer ?? '' } }
          if (previous) { throw new LessonConflict('This question was interrupted. Ask a follow-up to continue; it will not be replayed.') }
          if (revision !== record.revision) { throw new LessonConflict('The board changed. Save it before asking.') }
          record.turns = record.turns.map(turn => turn.status === 'running' ? { ...turn, status: 'interrupted' } : turn)
          record.turns.push({ id: turnId, status: 'running' })
          if (!record.title && question) { record.title = question.slice(0, 120) }
          return { record: await write(record), replay: undefined }
        })
      } catch (error) { active.delete(id); throw error }
    },
    async finish(id: string, turnId: string, answer?: string) {
      await change(id, async record => {
        const turn = record.turns.find(turn => turn.id === turnId)
        if (turn?.status === 'running') {
          turn.status = answer === undefined ? 'interrupted' : 'done'
          if (answer !== undefined) { turn.answer = answer; record.answer = answer }
        }
        return write(record)
      })
    },
    release(id: string) { active.delete(id) },
  }
}
