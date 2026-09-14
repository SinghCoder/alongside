import type { ExcalidrawTextElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import { loadImages } from '../board/images'
import { route } from '../board/geometry'
import { createExcalDriver, measureBoard } from '../board/excalidraw-driver'
import type { BoardScene, BoardItem } from '../board/types'
import { INK } from '../pen/sequence'
import { LETTER_FONT, type Point, type Stroke, type LetterLine, type EraseArea } from '../pen/types'
import type { LessonBoard, Shot } from './types'

// Reserve space above the scene for native canvas tools.
const DRAWING_FRAME = { x: 0, y: -90, w: 820, h: 800 }
const HIGHLIGHT_GAP = 8
const HEAD_LENGTH = 12
const HEAD_ANGLE = Math.PI / 6
const CORNER_SAMPLES = 8
const MAX_CORNER_RADIUS = 32
const CORNER_RATIO = 0.25
// Excalidraw 0.18 Helvetica metrics, shared by its canvas and SVG renderer.
const FONT_EM = 2048
const FONT_ASCENDER = 1577
const FONT_DESCENDER = -471
const ERASE_PADDING = 1

function boxOutline(x: number, y: number, width: number, height: number): Stroke {
  // Match Excalidraw's adaptive radius and quadratic corner geometry.
  const radius = Math.min(MAX_CORNER_RADIUS, Math.min(width, height) * CORNER_RATIO)
  const points: Point[] = [{ x: x + radius, y }]
  function corner(start: Point, control: Point, end: Point) {
    points.push(start)
    for (let index = 1; index <= CORNER_SAMPLES; index++) {
      const t = index / CORNER_SAMPLES
      const u = 1 - t
      points.push({ x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * control.y + t * t * end.y })
    }
  }
  const right = x + width
  const bottom = y + height
  corner({ x: right - radius, y }, { x: right, y }, { x: right, y: y + radius })
  corner({ x: right, y: bottom - radius }, { x: right, y: bottom }, { x: right - radius, y: bottom })
  corner({ x: x + radius, y: bottom }, { x, y: bottom }, { x, y: bottom - radius })
  corner({ x, y: y + radius }, { x, y }, { x: x + radius, y })
  return points
}

export function makeLessonBoard(api: ExcalidrawImperativeAPI, initial: BoardScene = [], initialMoved: readonly string[] = []): LessonBoard {
  let driver = createExcalDriver(api, initial, DRAWING_FRAME)
  let previous: BoardScene = initial
  let placements = new Map<string, string>()
  const userMoved = new Set<string>(initialMoved)
  const placement = (item: { x: number; y: number; width: number; height: number; angle: number }) => JSON.stringify([item.x, item.y, item.width, item.height, item.angle])

  function preview(shot: Shot): readonly Stroke[] | null {
    const live = new Map(api.getSceneElements().map((item) => [item.id, item]))
    const known = new Set(previous.map((item) => item.id))
    const proposed = new Map(shot.scene.filter(item => item.kind === 'node' || item.kind === 'image').map(item => [item.id, item]))
    const endpoint = (id: string) => shot.moves?.includes(id) ? proposed.get(id) : live.get(id) ?? proposed.get(id)
    // Missing source objects must be restored by the user, not silently replaced.
    if (previous.some((item) => item.kind === 'node' && !live.has(item.id))) { return null }
    const result: Stroke[] = []
    for (const item of shot.scene) {
      if (known.has(item.id)) { continue }
      if (item.kind === 'native') {
        const points = item.element.points as number[][] | undefined
        if (points?.length) {
          const path = points.map(([x, y]) => ({ x: item.x + x, y: item.y + y }))
          result.push(path)
          if (item.element.type === 'arrow') {
            const end = path.at(-1)!, before = path.at(-2) ?? path[0]
            const angle = Math.atan2(end.y - before.y, end.x - before.x)
            result.push([{ x: end.x - HEAD_LENGTH * Math.cos(angle + HEAD_ANGLE), y: end.y - HEAD_LENGTH * Math.sin(angle + HEAD_ANGLE) }, end,
              { x: end.x - HEAD_LENGTH * Math.cos(angle - HEAD_ANGLE), y: end.y - HEAD_LENGTH * Math.sin(angle - HEAD_ANGLE) }])
          }
        } else if (item.element.type === 'text') { result.push([{ x: item.x, y: item.y }]) }
        else if (item.element.type === 'rectangle' && !item.element.roundness) { result.push([{x:item.x,y:item.y},{x:item.x+item.width,y:item.y},{x:item.x+item.width,y:item.y+item.height},{x:item.x,y:item.y+item.height},{x:item.x,y:item.y}]) }
        else { result.push(boxOutline(item.x, item.y, item.width, item.height)) }
      }
      if (item.kind === 'path') {
        result.push(item.points.map(point => ({ x: item.x + point.x, y: item.y + point.y })))
      }
      if (item.kind === 'image') {
        result.push([{ x: item.x, y: item.y }])
      }
      if (item.kind === 'node') {
        result.push(boxOutline(item.x, item.y, item.width, item.height))
      }
      if (item.kind === 'text') { result.push([{ x: item.x, y: item.y }]) }
      if (item.kind !== 'arrow') { continue }
      const from = endpoint(item.from)
      const to = endpoint(item.to)
      if (!from || !to) { return null }
      const points = route(item, from, to)
      const end = points.at(-1)!
      const before = points.at(-2)!
      const angle = Math.atan2(end.y - before.y, end.x - before.x)
      const wing = (offset: number): Point => ({ x: end.x - HEAD_LENGTH * Math.cos(angle + offset), y: end.y - HEAD_LENGTH * Math.sin(angle + offset) })
      result.push(points, [wing(HEAD_ANGLE), end, wing(-HEAD_ANGLE)])
    }
    if (result.length) { return result }
    const focus = live.get(shot.focus)
    if (!focus) { return [[{ x: 60, y: 40 }]] }
    const y = focus.y + focus.height + HIGHLIGHT_GAP
    return [[{ x: focus.x, y }, { x: focus.x + focus.width, y }]]
  }

  function textChanges(shot: Shot) {
    const before = new Map(previous.map((item) => [item.id, item]))
    const after = new Map(shot.scene.map((item) => [item.id, item]))
    return (id: string) => {
      const old = before.get(id)
      const next = after.get(id)
      const content = (item: BoardItem | undefined) => item?.kind === 'native' ? JSON.stringify([item.element.text, item.element.label]) : item && 'text' in item ? item.text : undefined
      return content(old) !== content(next)
    }
  }

  function textLines(item: ExcalidrawTextElement): LetterLine[] {
    const measure = document.createElement('canvas').getContext('2d')!
    measure.font = `${item.fontSize}px ${LETTER_FONT}`
    const baseline = (item.fontSize * item.lineHeight + item.fontSize * (FONT_ASCENDER + FONT_DESCENDER) / FONT_EM) / 2
    return item.text.split('\n').map((text, index) => {
      const width = measure.measureText(text).width
      const offset = item.textAlign === 'center' ? (item.width - width) / 2 : 0
      const advances = Array.from({ length: text.length + 1 }, (_, count) => measure.measureText(text.slice(0, count)).width)
      return { x: item.x + offset, y: item.y + index * item.fontSize * item.lineHeight,
        text, size: item.fontSize, color: item.strokeColor, advances, baseline }
    })
  }

  function lettering(shot: Shot): readonly LetterLine[] {
    const changed = textChanges(shot)
    const live = new Map(api.getSceneElements().map((item) => [item.id, item]))
    return driver.labels(shot.scene).filter((item) => changed(item.containerId ?? item.id)).flatMap((item) => {
      const old = live.get(item.id)
      const lines = old?.type === 'text' ? old.text.split('\n') : []
      return textLines(item).filter((line, index) => line.text !== lines[index])
        .map((line) => ({ ...line, color: old?.type === 'text' ? old.strokeColor : line.color }))
    })
  }

  function erasures(shot: Shot): readonly EraseArea[] {
    const changed = textChanges(shot)
    const next = new Map(driver.labels(shot.scene).map((item) => [item.id, item]))
    const live = api.getSceneElements()
    return live.filter((item) => item.type === 'text').flatMap((item) => {
      if (!changed(item.containerId ?? item.id)) { return [] }
      const parent = live.find((node) => node.id === item.containerId)
      const color = parent?.backgroundColor && parent.backgroundColor !== 'transparent' ? parent.backgroundColor : '#ffffff'
      const following = next.get(item.id)?.text.split('\n') ?? []
      return textLines(item).flatMap((line, index) => line.text === following[index] ? [] : [{
        x: line.x - ERASE_PADDING, y: line.y, width: line.advances.at(-1)! + ERASE_PADDING * 2,
        height: item.fontSize * item.lineHeight, color,
      }])
    })
  }

  function snapshot() {
    const live = new Map(api.getSceneElements().map((item) => [item.id, item]))
    const owned = new Set(previous.flatMap((item) => [item.id, `${item.id}-label`]))
    const scene = previous.flatMap<BoardItem>((item) => {
      const native = live.get(item.id)
      if (!native) { return [] }
      if (item.kind === 'arrow') { return [item] }
      const label = live.get(item.kind === 'node' ? `${item.id}-label` : item.id)
      return [{ ...item, x: native.x, y: native.y,
        ...('width' in item ? { width: native.width, height: native.height } : {}),
        ...(item.kind === 'native' ? { element: { ...item.element, x: native.x, y: native.y,
          ...(native.type === 'text' ? { text: native.originalText } : {}),
          ...('points' in native ? { points: native.points } : {}) } } : {}),
        ...('text' in item && label?.type === 'text' ? { text: label.originalText } : {}) }]
    }) as BoardScene
    const notes = [...live.values()].filter((item) => !owned.has(item.id) && item.type === 'text')
      .map((item) => item.type === 'text' ? item.text.slice(0, 300) : '').slice(0, 20)
    const annotations = [...live.values()].filter(item => !owned.has(item.id)).map(item => ({
      id: item.id, type: item.type, x: item.x, y: item.y, width: item.width, height: item.height,
      angle: item.angle, groupIds: item.groupIds, locked: item.locked,
      strokeColor: item.strokeColor, backgroundColor: item.backgroundColor,
      ...('points' in item ? { points: item.points } : {}),
      ...(item.type === 'text' ? { text: item.originalText, fontSize: item.fontSize, fontFamily: item.fontFamily } : {}),
      ...(item.type === 'image' ? { fileId: item.fileId } : {}),
    }))
    for (const item of scene) {
      const native = live.get(item.id)
      if (native && placements.has(item.id) && placements.get(item.id) !== placement(native)) { userMoved.add(item.id) }
    }
    return { scene, notes, annotations, userMovedIds: [...userMoved].filter(id => scene.some(item => item.id === id)) }
  }

  return {
    load(document) {
      previous = document.snapshot.scene
      placements.clear(); userMoved.clear()
      for (const id of document.snapshot.userMovedIds ?? []) { userMoved.add(id) }
      driver = createExcalDriver(api, previous, DRAWING_FRAME)
      api.resetScene()
      api.addFiles(Object.values(document.files))
      const viewport = document.viewport
      api.updateScene({ elements: structuredClone(document.elements), appState: viewport ? { ...viewport, zoom: { value: viewport.zoom.value as NormalizedZoomValue } } : { scrollX: 0, scrollY: 0, zoom: { value: 1 as NormalizedZoomValue } } })
      if (!viewport) { driver.fit() }
    },
    save() {
      const state = api.getAppState()
      return structuredClone({ snapshot: snapshot(), elements: api.getSceneElementsIncludingDeleted(), files: api.getFiles(),
        viewport: { scrollX: state.scrollX, scrollY: state.scrollY, zoom: { value: state.zoom.value } } })
    },
    capture: scene => driver.capture(scene),
    scrollToContent: (scene, options) => driver.scrollToContent(scene, options),
    measure: measureBoard,
    prepare: (scene, signal) => loadImages(api, scene, signal),
    images(shot) {
      const known = new Set(previous.map(item => item.id))
      return shot.scene.filter((item): item is Extract<BoardItem, { kind: 'image' }> => item.kind === 'image' && !known.has(item.id))
    },
    snapshot,
    preview,
    lettering,
    erasures,
    fills(shot) {
      return shot.scene.flatMap(item => {
        if (item.kind !== 'native' || typeof item.element.backgroundColor !== 'string' || item.element.backgroundColor === 'transparent') { return [] }
        if (JSON.stringify(previous.find(old => old.id === item.id)) === JSON.stringify(item)) { return [] }
        const {x,y,width:w,height:h} = item
        let points: Point[]
        if (item.element.type === 'rectangle') {
          points = item.element.roundness ? [...boxOutline(x,y,w,h)] : [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
        } else if (item.element.type === 'diamond') {
          points = [{x:x+w/2,y},{x:x+w,y:y+h/2},{x:x+w/2,y:y+h},{x,y:y+h/2}]
        } else if (item.element.type === 'ellipse') {
          const samples = 48
          points = Array.from({length:samples},(_,i)=>({x:x+w/2+Math.cos(i*2*Math.PI/samples)*w/2,y:y+h/2+Math.sin(i*2*Math.PI/samples)*h/2}))
        } else { return [] }
        return [{points,color:item.element.backgroundColor}]
      })
    },
    commit(shot) {
      snapshot()
      driver.apply(shot.scene, shot.moves); previous = shot.scene
      placements = new Map(api.getSceneElements().map(item => [item.id, placement(item)]))
    },
    fit: () => driver.fit(),
    ink() { return { color: INK, width: 1.5 * api.getAppState().zoom.value } },
    screen(point) {
      const state = api.getAppState()
      return { x: (point.x + state.scrollX) * state.zoom.value, y: (point.y + state.scrollY) * state.zoom.value }
    },
  }
}
