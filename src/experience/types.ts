import type { BoardDocument } from '../board/document'
import type { BoardScene } from '../board/types'
import type { PenBoard, PenFrame, Stroke, LetterLine, EraseArea, ImageReveal } from '../pen/types'

export type Shot = { scene: BoardScene; focus: string; caption: string; duration: number; speed?: number; moves?: readonly string[] }
export type LessonFrame = PenFrame & { caption: string; step: number }
export type DrawingSurface = Pick<PenBoard, 'screen' | 'ink' | 'fit'>
export interface LessonBoard extends DrawingSurface {
  scrollToContent?(scene: BoardScene, options: { fitToContent?: boolean; animate?: boolean; viewportZoomFactor?: number }): void
  load?(document: BoardDocument): void
  save?(): BoardDocument
  capture?(scene: BoardScene): Promise<{ data: string; width: number; height: number }>
  measure?(scene: BoardScene): { id: string; x: number; y: number; width: number; height: number }[]
  images?(shot: Shot): readonly Omit<ImageReveal, 'opacity'>[]
  prepare?(scene: BoardScene, signal: AbortSignal): Promise<void>
  snapshot(): { scene: BoardScene; notes: string[]; userMovedIds?: readonly string[]; annotations?: readonly Record<string, unknown>[] }
  preview(shot: Shot): readonly Stroke[] | null
  erasures(shot: Shot): readonly EraseArea[]
  lettering(shot: Shot): readonly LetterLine[]
  fills?(shot: Shot): readonly { points: Stroke; color: string }[]
  commit(shot: Shot): void
}
export enum Actor { Asha = 'asha', Ravi = 'ravi' }
