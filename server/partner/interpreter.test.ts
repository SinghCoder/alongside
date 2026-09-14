import assert from 'node:assert/strict'
import test from 'node:test'
import { interpret } from './interpreter.ts'

test('interpreter pauses inside code until a presentation is acknowledged', async () => {
  const calls: string[] = []
  let resume!: () => void
  let reached!: () => void
  const arrived = new Promise<void>(resolve => { reached = resolve })
  const playback = new Promise<void>(resolve => { resume = resolve })
  const running = interpret("board.present('First'); board.present('Second'); return 42", async (_, value) => {
    calls.push(String(value))
    if (value === 'First') { reached(); await playback }
    return null
  }, new AbortController().signal)
  await arrived
  assert.deepEqual(calls, ['First'])
  resume()
  assert.equal(await running, 42)
  assert.deepEqual(calls, ['First', 'Second'])
})

test('execution has no ambient host capabilities and surfaces errors', async () => {
  const signal = new AbortController().signal
  assert.deepEqual(await interpret('return [typeof process, typeof require, typeof fetch]', async () => null, signal), ['undefined', 'undefined', 'undefined'])
  await assert.rejects(interpret("board.get('missing')", async () => { throw new Error('Unknown object') }, signal), /Unknown object/)
  await assert.rejects(interpret('while(true){}', async () => null, signal), /interrupted/)
})


test('repeated bridge calls cannot evade the execution budget', async () => {
  await assert.rejects(interpret('while(true){try{board.snapshot()}catch{}}', async () => null, new AbortController().signal), /interrupted/)
})

test('asset discovery is lazy, cached and composable inside JavaScript', async () => {
  let reads = 0
  const rows = Array.from({ length: 7500 }, (_, index) => ({ id: `asset-${index}`, name: index === 42 ? 'Database' : `Component ${index}`, pack: 'Architecture', group: 'General', format: 'svg', archived: false }))
  const bridge = async (method: string) => {
    assert.equal(method, 'assets.catalog')
    reads++
    return rows
  }
  const signal = new AbortController().signal
  assert.equal(await interpret('return 1', bridge, signal), 1)
  assert.equal(reads, 0)
  assert.deepEqual(await interpret("const matches=ALL_ASSETS.filter(a=>/database/i.test(a.name)); return {count:ALL_ASSETS.length,ids:matches.map(a=>a.id)}", bridge, signal), { count: 7500, ids: ['asset-42'] })
  assert.equal(reads, 1)
})
