import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import type { BoardScene } from './types'

export type BoardSnapshot = { scene: BoardScene; notes: string[]; userMovedIds?: readonly string[]; annotations?: readonly Record<string, unknown>[] }
export type BoardPage = {
  snapshot: BoardSnapshot
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  viewport?: { scrollX: number; scrollY: number; zoom: { value: number } }
}
export type BoardDocument = BoardPage & { steps?: { activeId: string; pages: { id: string; title: string; parentId?: string; board: BoardPage }[] } }
export const EMPTY_DOCUMENT: BoardDocument = { snapshot: { scene: [], notes: [] }, elements: [], files: {} }
