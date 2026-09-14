import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayer, type FrameClock } from './player.ts'
import { DURATION, TOTAL_MS, TRAVEL_MS } from './sequence.ts'
import { Part, Playback, type PenBoard, type PenFrame, type Stroke } from './types.ts'

function harness() {
  let callback: ((time: number) => void) | null = null
  let time = 0
  let x = 420
  const commits: { part: Part; strokes: readonly Stroke[] }[] = []
  let frame: PenFrame | undefined
  const clock: FrameClock = { request(next) { callback = next; return 1 }, cancel() { callback = null } }
  const board: PenBoard = {
    anchor: () => commits.some((item) => item.part === Part.Box) ? { x, y: 300 } : null,
    screen: (point) => point,
    fit() {},
    ink: () => ({ color: "green", width: 2 }),
    commit(part, strokes) { commits.push({ part, strokes }) },
  }
  const player = createPlayer(board, (next) => { frame = next }, clock)
  function advance(milliseconds: number) {
    const end = time + milliseconds
    while (time < end) { time = Math.min(time + 16, end); callback?.(time) }
  }
  return { player, commits, advance, frame: () => frame!, move: (value: number) => { x = value } }
}

test('a paused stroke freezes, resumes from the moved box, and commits once', () => {
  const h = harness()
  h.player.start()
  h.advance(DURATION[Part.Box] + TRAVEL_MS + 300)
  assert.deepEqual(h.commits.map((item) => item.part), [Part.Box])
  h.player.pause()
  const paused = h.frame().strokes
  h.advance(5000)
  assert.deepEqual(h.frame().strokes, paused)
  assert.equal(h.commits.length, 1)
  h.move(520)
  h.advance(16)
  assert.equal(h.frame().strokes[0][0].x, 520)
  h.player.start()
  h.advance(7000)
  assert.deepEqual(h.commits.map((item) => item.part), [Part.Box, Part.Arrow, Part.Note])
  assert.equal(h.commits[1].strokes[0][0].x, 520)
  assert.equal(h.frame().state, Playback.Done)
  h.advance(5000)
  assert.equal(h.commits.length, 3)
  h.player.dispose()
})

test('disposing while drawing prevents late commits', () => {
  const h = harness()
  h.player.start()
  h.advance(1000)
  h.player.dispose()
  h.advance(20000)
  assert.equal(h.commits.length, 0)
})

test('an uninterrupted sequence completes in the configured duration', () => {
  const h = harness()
  h.player.start()
  h.advance(TOTAL_MS - 100)
  assert.notEqual(h.frame().state, Playback.Done)
  h.advance(300)
  assert.equal(h.frame().state, Playback.Done)
  h.player.dispose()
})
