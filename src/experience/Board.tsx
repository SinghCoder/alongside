import { useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import { loadImages } from '../board/images'
import { EMPTY_DOCUMENT, type BoardDocument } from '../board/document'
import type { BoardScene } from '../board/types'
import { makeLessonBoard } from './driver'
import { Actor, type LessonBoard } from './types'
import '@excalidraw/excalidraw/index.css'

const NO_IMAGES: BoardScene = []

export default function Board({ onReady, onSelect, images = NO_IMAGES, initial = EMPTY_DOCUMENT, onChange }: {
  images?: BoardScene
  initial?: BoardDocument
  onChange?: (document: BoardDocument) => void
  onReady: (board: LessonBoard | null) => void
  onSelect: (actor: Actor | null) => void
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [error, setError] = useState('')
  const adapter = useRef<{ api: ExcalidrawImperativeAPI; board: LessonBoard } | null>(null)
  useEffect(() => {
    if (!api) { return }
    // Effects may restart while the native canvas survives. Keep its ownership map.
    if (adapter.current?.api !== api) {
      adapter.current = { api, board: makeLessonBoard(api, initial.snapshot.scene, initial.snapshot.userMovedIds) }
    }
    const board = adapter.current.board
    const controller = new AbortController()
    let handle = 0
    loadImages(api, images, controller.signal).then(() => {
      if (controller.signal.aborted) { return }
      handle = requestAnimationFrame(() => { if (!initial.viewport) { board.fit() } onReady(board) })
    }).catch((reason: Error) => { if (!controller.signal.aborted) { setError(reason.message) } })
    const unsubscribe = api.onChange((elements, state) => {
      queueMicrotask(() => onChange?.(board.save!()))
      const selected = elements.filter((item) => state.selectedElementIds[item.id])
        .map((item) => item.type === 'text' && item.containerId ? item.containerId : item.id)
      const actors = Object.values(Actor).filter((actor) => selected.includes(actor))
      onSelect(actors.length === 1 ? actors[0] : null)
    })
    return () => { controller.abort(); cancelAnimationFrame(handle); unsubscribe(); onReady(null) }
  }, [api, onReady, onSelect, images, initial, onChange])
  const viewport = initial.viewport && { ...initial.viewport, zoom: { value: initial.viewport.zoom.value as NormalizedZoomValue } }
  return <><Excalidraw excalidrawAPI={setApi} initialData={{ elements: initial.elements, files: initial.files, appState: viewport }} theme="light"
    UIOptions={{ canvasActions: { toggleTheme: false, loadScene: false } }} />
    {error && <p role="alert" className="absolute bottom-8 left-6 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </>
}
