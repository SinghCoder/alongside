import type { BoardItem } from './types.ts'

export type Bounds = { x: number; y: number; width: number; height: number }
export type Anchor = 'left' | 'right' | 'top' | 'bottom'
export type Point = { x: number; y: number }
export type Connection = Extract<BoardItem, { kind: 'arrow' }>

export function anchor(box: Bounds, side: Anchor): Point {
  if (side === 'left') { return { x: box.x, y: box.y + box.height / 2 } }
  if (side === 'right') { return { x: box.x + box.width, y: box.y + box.height / 2 } }
  if (side === 'top') { return { x: box.x + box.width / 2, y: box.y } }
  return { x: box.x + box.width / 2, y: box.y + box.height }
}

export function route(edge: Connection, from: Bounds, to: Bounds): Point[] {
  return [anchor(from, edge.fromAnchor ?? 'right'), ...(edge.via ?? []), anchor(to, edge.toAnchor ?? 'left')]
}
