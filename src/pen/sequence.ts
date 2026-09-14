import { Part, type Point, type Stroke } from './types.ts'

export const BOX = { x: 180, y: 230, w: 240, h: 140 }
export const FRAME = { x: 0, y: 0, w: 1040, h: 660 }
export const PARTS = [Part.Box, Part.Arrow, Part.Note] as const
export const DURATION = { [Part.Box]: 1800, [Part.Arrow]: 1200, [Part.Note]: 2000 }
export const TRAVEL_MS = 250
export const TOTAL_MS = Object.values(DURATION).reduce((sum, value) => sum + value, 0) + TRAVEL_MS * (PARTS.length - 1)
export const BOX_ID = 'pen-check-box'
export const INK = '#286749'
export const ARROW_LENGTH = 240
const HEAD_SIZE = 14
const LETTER_RADIUS = 23

export function strokesFor(part: Part, anchor: Point): readonly Stroke[] {
  if (part === Part.Box) {
    const { x, y, w, h } = BOX
    return [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]]
  }
  const end = { x: anchor.x + ARROW_LENGTH, y: anchor.y }
  if (part === Part.Arrow) {
    return [[anchor, end], [{ x: end.x - HEAD_SIZE, y: end.y - HEAD_SIZE / 2 }, end, { x: end.x - HEAD_SIZE, y: end.y + HEAD_SIZE / 2 }]]
  }

  const x = end.x + 55
  const y = end.y
  const circle = Array.from({ length: 41 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 40
    return { x: x + Math.cos(angle) * LETTER_RADIUS * 0.7, y: y + Math.sin(angle) * LETTER_RADIUS }
  })
  return [circle, [{ x: x + 38, y: y - LETTER_RADIUS }, { x: x + 38, y: y + LETTER_RADIUS }],
    [{ x: x + 66, y: y - LETTER_RADIUS }, { x: x + 38, y }, { x: x + 66, y: y + LETTER_RADIUS }]]
}

export function reveal(strokes: readonly Stroke[], fraction: number): Stroke[] {
  const length = (stroke: Stroke) => stroke.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - stroke[i].x, p.y - stroke[i].y), 0)
  let remaining = strokes.reduce((sum, stroke) => sum + length(stroke), 0) * Math.max(0, Math.min(1, fraction))
  const result: Stroke[] = []
  for (const stroke of strokes) {
    const points: Point[] = [stroke[0]]
    for (let index = 1; index < stroke.length && remaining > 0; index++) {
      const a = stroke[index - 1]
      const b = stroke[index]
      const distance = Math.hypot(b.x - a.x, b.y - a.y)
      const ratio = Math.min(1, remaining / distance)
      points.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio })
      remaining -= distance
    }
    result.push(points)
    if (remaining <= 0) { break }
  }
  return result
}
