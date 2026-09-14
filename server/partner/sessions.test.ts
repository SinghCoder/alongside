import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Agent, Model, Message, TextBlock, ToolUseBlock, ToolResultBlock, ImageBlock, type ModelStreamEvent } from '@strands-agents/sdk'
import { sessionConfig } from './sessions.ts'
import { lessonStore } from './store.ts'
import { EMPTY_DOCUMENT } from '../../src/board/document.ts'

class SummaryModel extends Model {
  updateConfig() {}
  getConfig() { return { modelId: 'test', contextWindowLimit: 1000 } }
  async *stream(): AsyncGenerator<ModelStreamEvent> {
    yield { type: 'modelMessageStartEvent', role: 'assistant' }
    yield { type: 'modelContentBlockStartEvent' }
    yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Learner prefers diagrams. Product cache has an expiry.' } }
    yield { type: 'modelContentBlockStopEvent' }
    yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
  }
}

test('native sessions restore tool exchanges and compacted context independently of the board', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-session-'))
  try {
    const id = randomUUID()
    const first = new Agent({ ...sessionConfig(id, directory), model: new SummaryModel(), printer: false })
    await first.initialize()
    first.messages.push(new Message({ role: 'user', content: [new TextBlock('Prefer diagrams.')] }),
      new Message({ role: 'assistant', content: [new ToolUseBlock({ toolUseId: 'draw-1', name: 'execute_whiteboard', input: { code: 'return board.capture()' } })] }),
      new Message({ role: 'user', content: [new ToolResultBlock({ toolUseId: 'draw-1', status: 'success', content: [new TextBlock('Recorded board revision 7'), new ImageBlock({ format: 'png', source: { bytes: new Uint8Array([1, 2, 3]) } })] })] }))
    await first.sessionManager!.saveSnapshot({ target: first, isLatest: true })
    const config = sessionConfig(id, directory)
    const restored = new Agent({ ...config, model: new SummaryModel(), printer: false })
    await restored.initialize()
    assert.equal(restored.messages.length, 3)
    const result = restored.messages[2].content[0] as ToolResultBlock
    assert.equal(result.toolUseId, 'draw-1')
    assert.equal(result.content[1].type, 'imageBlock')
    for (let turn = 0; turn < 10; turn++) { await restored.invoke(`Follow-up ${turn}`) }
    const before = restored.messages.length
    assert.equal(await config.conversationManager.reduce({ agent: restored, model: new SummaryModel() }), true)
    assert.ok(restored.messages.length < before)
    await restored.sessionManager!.saveSnapshot({ target: restored, isLatest: true })
    const reopened = new Agent({ ...sessionConfig(id, directory), model: new SummaryModel(), printer: false })
    await reopened.initialize()
    assert.equal(reopened.messages.length, restored.messages.length)
    assert.match(JSON.stringify(reopened.messages), /Learner prefers diagrams/)
    const other = new Agent({ ...sessionConfig(randomUUID(), directory), model: new SummaryModel(), printer: false })
    await other.initialize()
    assert.equal(other.messages.length, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('documents survive reopen and reject conflicting saves and duplicate turns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-document-'))
  try {
    const store = lessonStore(directory)
    const record = await store.create()
    const document = { ...EMPTY_DOCUMENT, snapshot: { scene: [], notes: ['keep this annotation'] } }
    const saved = await store.save(record.id, 0, document)
    assert.equal(saved.revision, 1)
    assert.equal((await store.save(record.id, 0, document)).revision, 1)
    await assert.rejects(store.save(record.id, 0, EMPTY_DOCUMENT), /another tab/)
    const reopened = lessonStore(directory)
    assert.deepEqual((await reopened.read(record.id)).document, document)
    const turn = randomUUID()
    await reopened.begin(record.id, turn, 1)
    await assert.rejects(reopened.begin(record.id, randomUUID(), 1), /active question/)
    await reopened.finish(record.id, turn, 'Remembered')
    reopened.release(record.id)
    const replay = await reopened.begin(record.id, turn, 1)
    assert.equal(replay.replay, 'Remembered')
    reopened.release(record.id)
    const interrupted = randomUUID()
    await reopened.begin(record.id, interrupted, 1)
    const afterRestart = lessonStore(directory)
    await assert.rejects(afterRestart.begin(record.id, interrupted, 1), /interrupted/)
    assert.equal((await afterRestart.read(record.id)).interrupted, true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('lesson writer remains locked until the invocation has finished cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-lock-'))
  try {
    const store = lessonStore(directory)
    const record = await store.create()
    const turn = randomUUID()
    await store.begin(record.id, turn, 0)
    await store.finish(record.id, turn, 'Done')
    await assert.rejects(store.begin(record.id, randomUUID(), 0), /active question/)
    store.release(record.id)
    await store.begin(record.id, randomUUID(), 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('restart closes an orphaned tool exchange without executing it again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-orphan-'))
  try {
    const { restoreLesson } = await import('./sessions.ts')
    const id = randomUUID()
    const first = new Agent({ ...sessionConfig(id, directory), model: new SummaryModel(), printer: false })
    await first.initialize()
    first.messages.push(new Message({ role: 'assistant', content: [new ToolUseBlock({ toolUseId: 'interrupted-draw', name: 'execute_whiteboard', input: { code: 'board.present("One box")' } })] }))
    await first.sessionManager!.saveSnapshot({ target: first, isLatest: true })
    const reopened = new Agent({ ...sessionConfig(id, directory), model: new SummaryModel(), printer: false })
    await restoreLesson(reopened)
    const result = reopened.messages.at(-1)!.content[0] as ToolResultBlock
    assert.equal(result.toolUseId, 'interrupted-draw')
    assert.equal(result.status, 'error')
    assert.match(JSON.stringify(result), /do not replay/)
    await restoreLesson(reopened)
    assert.equal(reopened.messages.length, 2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('activity survives restart, merges deltas and stays within its lesson', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-activity-'))
  try {
    const store = lessonStore(directory)
    const first = await store.create(), second = await store.create()
    const turn = randomUUID()
    await store.begin(first.id, turn, 0, 'Explain attention')
    const item = { id: 'summary', kind: 'summary' as const, name: 'Reasoning summary', at: 1, status: 'running' as const }
    await store.activity(first.id, { ...item, text: 'Read ' })
    await store.activity(first.id, { ...item, text: 'the diagram.' })
    await store.finish(first.id, turn, 'Done')
    store.release(first.id)
    const reopened = lessonStore(directory)
    const saved = await reopened.read(first.id)
    assert.equal(saved.activity?.find(value => value.id === 'summary')?.text, 'Read the diagram.')
    assert.equal(saved.activity?.find(value => value.id === 'summary')?.status, 'error')
    assert.deepEqual((await reopened.read(second.id)).activity, [])
    assert.equal((await reopened.list()).find(value => value.id === first.id)?.title, 'Explain attention')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('older lessons recover retained tool exchanges before new activity is journaled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-retained-'))
  try {
    const store = lessonStore(directory)
    const record = await store.create()
    const agent = new Agent({ ...sessionConfig(record.id, directory), model: new SummaryModel(), printer: false })
    await agent.initialize()
    agent.messages.push(new Message({ role: 'user', content: [new TextBlock(JSON.stringify({ question: 'Explain the encoder' }))] }),
      new Message({ role: 'assistant', content: [new ToolUseBlock({ toolUseId: 'old-call', name: 'exec', input: { command: 'python3 crop.py' } })] }),
      new Message({ role: 'user', content: [new ToolResultBlock({ toolUseId: 'old-call', status: 'success', content: [new TextBlock('Crop saved')] })] }))
    await agent.sessionManager!.saveSnapshot({ target: agent, isLatest: true })
    const old = (await store.read(record.id)).activity!
    assert.equal(old.find(item => item.name === 'exec')?.status, 'done')
    assert.equal(old.find(item => item.name === 'exec')?.recovered, true)
    assert.equal(old.find(item => item.name === 'exec')?.durationMs, undefined)
    await store.activity(record.id, { id: 'new', kind: 'text', name: 'Question', text: 'Next question', at: 1, status: 'done' })
    const restored = (await lessonStore(directory).read(record.id)).activity!
    assert.equal(restored.filter(item => item.name === 'exec').length, 1)
    assert.equal(restored.at(-1)?.text, 'Next question')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
