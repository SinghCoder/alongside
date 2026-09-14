import { BOX, DURATION, PARTS, TRAVEL_MS, reveal, strokesFor } from './sequence.ts'
import { Playback, type PenBoard, type PenFrame, type Point } from './types.ts'

export interface FrameClock {
  request(callback: (time: number) => void): number
  cancel(id: number): void
}
const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
}

export function createPlayer(board: PenBoard, publish: (frame: PenFrame) => void, clock = browserClock) {
  let state = Playback.Ready
  let index = 0
  let elapsed = 0
  let last: number | null = null
  let ticket = 0
  let travel = 0
  let departing: Point | null = null
  let disposed = false

  function anchor() {
    return board.anchor(PARTS[index]) ?? { x: BOX.x + BOX.w, y: BOX.y + BOX.h / 2 }
  }

  function frame() {
    const part = PARTS[index]
    const strokes = reveal(strokesFor(part, anchor()), elapsed / DURATION[part])
    let pen = strokes.at(-1)?.at(-1) ?? null
    if (travel > 0 && departing && pen) {
      const ratio = 1 - travel / TRAVEL_MS
      pen = { x: departing.x + (pen.x - departing.x) * ratio, y: departing.y + (pen.y - departing.y) * ratio }
    }
    const blocked = index > 0 && !board.anchor(part)
    publish({ state, blocked, part, strokes: blocked || travel > 0 || state === Playback.Done || state === Playback.Ready ? [] : strokes,
      pen: blocked || state === Playback.Ready || state === Playback.Done ? null : pen })
  }

  function tick(time: number) {
    if (disposed) { return }
    const delta = last === null ? 0 : time - last
    last = time
    if (state === Playback.Drawing) {
      if (travel > 0) {
        travel = Math.max(0, travel - delta)
      } else {
        elapsed += delta
        if (elapsed >= DURATION[PARTS[index]]) {
          const strokes = strokesFor(PARTS[index], anchor())
          board.commit(PARTS[index], strokes)
          departing = strokes.at(-1)?.at(-1) ?? null
          if (index === PARTS.length - 1) {
            state = Playback.Done
          } else {
            index++
            elapsed = 0
            travel = TRAVEL_MS
          }
        }
      }
    }
    frame()
    ticket = clock.request(tick)
  }

  function start() {
    if (state !== Playback.Ready && state !== Playback.Paused) { return }
    // A removed box invalidates the attachment; the user must restore it first.
    if (index > 0 && !board.anchor(PARTS[index])) { return }
    state = Playback.Drawing
    last = null
    frame()
  }

  function pause() {
    if (state !== Playback.Drawing) { return }
    state = Playback.Paused
    frame()
  }

  ticket = clock.request(tick)
  return { start, pause, dispose() { disposed = true; clock.cancel(ticket) } }
}
