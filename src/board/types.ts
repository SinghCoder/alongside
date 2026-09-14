export const CAPTURE_SIZE = 1400

export enum CanvasKind {
  Excalidraw = 'excalidraw',
  Tldraw = 'tldraw',
}

export enum Tone {
  Neutral = 'neutral',
  Green = 'green',
  Amber = 'amber',
}

type Position = { x: number; y: number }

export type BoardNode = Position & {
  id: string
  kind: 'node'
  text: string
  width: number
  height: number
  tone: Tone
}

export type BoardItem = (BoardNode | (Position & {
  id: string
  kind: 'native'
  width: number
  height: number
  element: Record<string, unknown>
}) | (Position & {
  id: string
  kind: 'path'
  points: readonly { x: number; y: number }[]
}) | (Position & {
  id: string
  kind: 'text'
  text: string
  size: number
}) | (Position & {
  id: string
  kind: 'image'
  assetId?: string
  src: string
  width: number
  height: number
}) | {
  id: string
  kind: 'arrow'
  from: string
  to: string
  fromAnchor?: 'left' | 'right' | 'top' | 'bottom'
  toAnchor?: 'left' | 'right' | 'top' | 'bottom'
  via?: { x: number; y: number }[]
}) & { group?: string }

export type BoardScene = readonly BoardItem[]
export type BoardFrame = { x: number; y: number; w: number; h: number }

// The lesson speaks in board concepts; engines own rendering and history.
export interface BoardPort {
  fit(): void
  reset(): void
}

export type BoardProps = {
  scene: BoardScene
  frame: BoardFrame
  onReady: (port: BoardPort | null) => void
}
