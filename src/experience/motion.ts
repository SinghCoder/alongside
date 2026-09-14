import type { Point, Stroke, LetterLine, EraseArea } from '../pen/types.ts'
import { reveal } from '../pen/sequence.ts'

const MIN_TRAVEL_MS = 180
const TRAVEL_SPEED = 1

export function travelTime(from: Point, to: Point) {
  return Math.max(MIN_TRAVEL_MS, Math.hypot(to.x - from.x, to.y - from.y) / TRAVEL_SPEED)
}

export function movePen(from: Point, to: Point, fraction: number): Point {
  const t = Math.min(1, Math.max(0, fraction))
  const eased = t * t * (3 - 2 * t)
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased }
}

// Pen-up travel consumes time without connecting separate strokes with ink.
export function drawMotion(paths: readonly Stroke[], duration: number, elapsed: number) {
  const lengths = paths.map((path) => path.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - path[index].x, point.y - path[index].y), 0))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const strokes: Stroke[] = []
  let time = elapsed
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index]
    const drawing = total ? duration * lengths[index] / total : duration / paths.length
    if (time < drawing) {
      const t = Math.max(0, time / drawing)
      const visible = reveal([path], t * t * (3 - 2 * t))
      return { strokes: [...strokes, ...visible], pen: visible.at(-1)!.at(-1)!, complete: false }
    }
    strokes.push(path)
    time -= drawing
    const next = paths[index + 1]
    if (!next) { continue }
    const end = path.at(-1)!
    const travel = travelTime(end, next[0])
    if (time < travel) {
      return { strokes, pen: movePen(end, next[0], time / travel), complete: false }
    }
    time -= travel
  }
  return { strokes, pen: paths.at(-1)?.at(-1) ?? null, complete: true }
}

const CHARACTER_MS = 18

export function writeMotion(lines: readonly LetterLine[], origin: Point, elapsed: number) {
  const lettering: LetterLine[] = []
  let pen = origin
  let time = elapsed
  for (const line of lines) {
    const start = { x: line.x, y: line.y + (line.baseline ?? line.size) }
    const travel = travelTime(pen, start)
    if (time < travel) {
      return { lettering, pen: movePen(pen, start, time / travel), complete: false }
    }
    time -= travel
    const count = Math.min(line.text.length, Math.floor(time / CHARACTER_MS))
    lettering.push({ ...line, text: line.text.slice(0, count) })
    const progress = Math.min(line.text.length, time / CHARACTER_MS)
    const next = Math.min(line.text.length, count + 1)
    const x = line.advances[count] + (line.advances[next] - line.advances[count]) * (progress - count)
    pen = { x: line.x + x, y: start.y }
    if (count < line.text.length) { return { lettering, pen, complete: false } }
    time -= line.text.length * CHARACTER_MS
  }
  return { lettering, pen, complete: true }
}

const ERASE_SPEED = 0.6

export function eraseMotion(areas: readonly EraseArea[], origin: Point, elapsed: number) {
  const erasures: EraseArea[] = []
  let pen = origin
  let time = elapsed
  for (const area of areas) {
    const start = { x: area.x, y: area.y + area.height / 2 }
    const travel = travelTime(pen, start)
    if (time < travel) {
      return { erasures, pen: movePen(pen, start, time / travel), complete: false }
    }
    time -= travel
    const duration = area.width / ERASE_SPEED
    const width = area.width * Math.min(1, time / duration)
    erasures.push({ ...area, width })
    pen = { x: area.x + width, y: start.y }
    if (time < duration) { return { erasures, pen, complete: false } }
    time -= duration
  }
  return { erasures, pen, complete: true }
}
