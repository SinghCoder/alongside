import type { BoardDocument } from '../board/document'
import type { LessonRecord, LessonSummary } from './protocol'

const SAVE_DELAY_MS = 300
const RETRY_COUNT = 2
async function request(path: string, init?: RequestInit): Promise<LessonRecord> {
  const response = await fetch(`/api/lessons${path}`, init)
  const body = await response.json()
  if (!response.ok) { throw new Error(body.error || 'Could not save lesson') }
  return body
}
export async function listLessons(): Promise<LessonSummary[]> {
  const response = await fetch('/api/lessons/')
  if (!response.ok) { throw new Error('Could not load lessons') }
  return response.json()
}
export async function openLesson(id: string | null) {
  return id ? request(`/${id}`) : request('/', { method: 'POST' })
}

// Serialize autosaves and flush before turns/acknowledgements; revisions reject stale tabs.
export function lessonClient(initial: LessonRecord, onError: (message: string) => void) {
  let record = initial
  let last = JSON.stringify(initial.document)
  let draft: BoardDocument | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  let failure: Error | undefined
  async function persist(document: BoardDocument) {
    const value = JSON.stringify(document)
    if (value === last) { return }
    for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
      try {
        record = await request(`/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: record.revision, document }) })
        last = value; failure = undefined; return
      } catch (error) {
        if (attempt < RETRY_COUNT - 1 && error instanceof TypeError) { continue }
        failure = error instanceof Error ? error : new Error('Could not save lesson')
        onError(failure.message); throw failure
      }
    }
  }
  function flush(document?: BoardDocument) {
    clearTimeout(timer)
    const next = document ?? draft
    draft = undefined
    if (next) { queue = queue.catch(() => {}).then(() => persist(next)) }
    return queue.then(() => { if (failure) { throw failure } return record })
  }
  return {
    flush,
    changed(document: BoardDocument) {
      draft = document; clearTimeout(timer)
      timer = setTimeout(() => { void flush().catch(() => {}) }, SAVE_DELAY_MS)
    },
    close() { clearTimeout(timer); void flush().catch(() => {}) },
  }
}
