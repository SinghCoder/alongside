export const LETTER_FONT = 'Helvetica, Arial, sans-serif'
export type Point = { x: number; y: number }
export type Stroke = readonly Point[]
export enum Part { Box = 'box', Arrow = 'arrow', Note = 'note' }
export enum Playback { Ready = 'ready', Drawing = 'drawing', Paused = 'paused', Done = 'done' }

// Engine details stop here; the player uses drawing and page coordinates.
export interface PenBoard {
  commit(part: Part, strokes: readonly Stroke[]): void
  anchor(part: Part): Point | null
  screen(point: Point): Point
  fit(): void
  ink(): { color: string; width: number }
}

export enum DrawingTool { Pen, Eraser }
export type EraseArea = Point & { width: number; height: number; color: string }
export type LetterLine = Point & { baseline?: number; text: string; size: number; color: string; advances: readonly number[] }

export type ImageReveal = Point & { id: string; src: string; width: number; height: number; opacity: number }

export type PenFrame = {
  fills?: readonly { points: Stroke; color: string }[]
  images?: readonly ImageReveal[]
  tool?: DrawingTool
  erasures?: readonly EraseArea[]
  lettering?: readonly LetterLine[]
  state: Playback
  blocked: boolean
  part: Part
  strokes: readonly Stroke[]
  penOpacity?: number
  pen: Point | null
}
export type PenProps = { onReady: (board: PenBoard | null) => void }
