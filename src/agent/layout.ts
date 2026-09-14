import type { AgentRequest } from './schema.ts'

type Item = AgentRequest['scene'][number]
type Positioned = Exclude<Item, { kind: 'arrow' }>
const FRAME = { left: 30, top: 30, right: 790, bottom: 650 }
const GAP = 24
const GRID = 20
const TEXT_WIDTH = 0.75
const LINE_HEIGHT = 1.3

function bounds(item: Positioned) {
  if (item.kind === 'node' || item.kind === 'image') { return item }
  const lines = item.text.split('\n')
  return { ...item, width: Math.max(...lines.map(line => line.length)) * item.size * TEXT_WIDTH,
    height: lines.length * item.size * LINE_HEIGHT }
}

export function placeItem(item: Item, scene: Iterable<Item>): Item {
  if (item.kind === 'arrow') { return item }
  const box = bounds(item)
  const occupied = [...scene].filter((other): other is Positioned => other.kind !== 'arrow').map(bounds)
  const fits = (x: number, y: number) => x >= FRAME.left && y >= FRAME.top &&
    x + box.width <= FRAME.right && y + box.height <= FRAME.bottom &&
    occupied.every(other => x + box.width + GAP <= other.x || other.x + other.width + GAP <= x ||
      y + box.height + GAP <= other.y || other.y + other.height + GAP <= y)
  if (fits(item.x, item.y)) { return item }

  // Move only the new object; preserve the user's existing arrangement.
  const candidates: { x: number; y: number; distance: number }[] = []
  for (let y = FRAME.top; y + box.height <= FRAME.bottom; y += GRID) {
    for (let x = FRAME.left; x + box.width <= FRAME.right; x += GRID) {
      if (!fits(x, y)) { continue }
      candidates.push({ x, y, distance: (x - item.x) ** 2 + (y - item.y) ** 2 })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  const free = candidates[0]
  if (!free) { throw new Error('No room on the board; revise existing objects') }
  return { ...item, x: free.x, y: free.y }
}
