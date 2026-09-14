import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith, exportToCanvas } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import { route } from './geometry'
import { CAPTURE_SIZE, Tone, type BoardFrame, type BoardScene } from './types'

const FONT_FAMILY = 2 // Excalidraw's Helvetica font keeps explanatory labels compact.
const LABEL_SIZE = 19
const CAPTURE_PADDING = 24
const NODE_COLORS = {
  [Tone.Neutral]: { strokeColor: '#485b50', backgroundColor: '#f0f4ef' },
  [Tone.Green]: { strokeColor: '#286749', backgroundColor: '#d9eddf' },
  [Tone.Amber]: { strokeColor: '#947028', backgroundColor: '#f6eac8' },
}

function makeElements(scene: BoardScene, current: readonly ExcalidrawElement[]) {
  const live = new Map(current.filter((item) => !item.isDeleted).map((item) => [item.id, item]))
  const skeletons: ExcalidrawElementSkeleton[] = []

  for (const item of scene) {
    const existing = live.get(item.id)
    const position = existing ?? ('x' in item ? item : { x: 0, y: 0 })
    const base = { id: item.id, x: position.x, y: position.y, strokeWidth: 1.5, roughness: 0, groupIds: item.group ? [item.group] : [], fontFamily: FONT_FAMILY }

    if (item.kind === 'native') {
      skeletons.push({ roughness: 0, fontFamily: FONT_FAMILY, strokeWidth: 1.5,
        ...item.element, id: item.id, x: position.x, y: position.y,
        ...(item.element.type === 'text' ? {} : { width: existing?.width ?? item.width, height: existing?.height ?? item.height }),
      } as ExcalidrawElementSkeleton)
      continue
    }

    if (item.kind === 'path') {
      skeletons.push({ ...base, type: 'line', strokeColor: '#286749',
        points: item.points.map(point => [point.x, point.y]) })
      continue
    }

    if (item.kind === 'node') {
      skeletons.push({ ...base, type: 'rectangle', width: existing?.width ?? item.width,
        height: existing?.height ?? item.height, roundness: { type: 3 }, fillStyle: 'solid',
        ...NODE_COLORS[item.tone], label: { text: item.text, fontSize: LABEL_SIZE, fontFamily: FONT_FAMILY } })
      continue
    }

    if (item.kind === 'text') {
      skeletons.push({ ...base, type: 'text', text: item.text, fontSize: item.size, strokeColor: '#39473e' })
      continue
    }

    if (item.kind === 'image') {
      skeletons.push({ ...base, type: 'image', width: existing?.width ?? item.width, height: existing?.height ?? item.height,
        fileId: item.id as FileId, status: 'saved' })
      continue
    }

    // Bind to current node positions so arrows follow a user's rearrangement.
    const from = skeletons.find((node) => node.id === item.from)
    const to = skeletons.find((node) => node.id === item.to)
    if (!from || !to) {
      continue
    }

    const points = route(item, { x: from.x ?? 0, y: from.y ?? 0, width: from.width ?? 0, height: from.height ?? 0 },
      { x: to.x ?? 0, y: to.y ?? 0, width: to.width ?? 0, height: to.height ?? 0 })
    skeletons.push({ ...base, type: 'arrow', x: points[0].x, y: points[0].y,
      start: { id: item.from }, end: { id: item.to }, strokeColor: '#6f8175',
      points: points.map(point => [point.x - points[0].x, point.y - points[0].y]) })
  }

  // The skeleton converter cannot bind images. Use their rectangular bounds
  // for binding, then restore native images with the computed connections.
  const images = new Map(convertToExcalidrawElements(skeletons.filter(item => item.type === 'image'),
    { regenerateIds: false }).map(item => [item.id, item]))
  const bindable = skeletons.map(item => item.type === 'image'
    ? { id: item.id, type: 'rectangle' as const, x: item.x, y: item.y, width: item.width, height: item.height }
    : item)
  const elements = convertToExcalidrawElements(bindable, { regenerateIds: false }).map(item => {
    const image = images.get(item.id)
    return image ? { ...image, boundElements: item.boundElements } : item
  })
  const labels = new Map(elements.filter((item) => item.type === 'text' && item.containerId)
    .map((item) => [item.id, `${item.type === 'text' ? item.containerId : ''}-label`]))

  // The converter randomizes bound text IDs; stable IDs make edits incremental.
  const groups = new Map(scene.map(item => [item.id, item.group]))
  return elements.map((item) => {
    const group = groups.get(item.type === 'text' && item.containerId ? item.containerId : item.id)
    return { ...item, groupIds: group ? [group] : item.groupIds, id: labels.get(item.id) ?? item.id,
      boundElements: item.boundElements?.map((binding) => ({ ...binding, id: labels.get(binding.id) ?? binding.id })) ?? null }
  })
}

export function createExcalDriver(api: ExcalidrawImperativeAPI, initial: BoardScene, frame: BoardFrame) {
  let previous: BoardScene = initial
  let desired: BoardScene = initial

  function project(scene: BoardScene, moves: readonly string[] = []) {
    const live = api.getSceneElementsIncludingDeleted()
    const generated = makeElements(scene, live.filter(item => !moves.includes(item.id)))
    const oldItems = new Map(previous.map((item) => [item.id, item]))
    const nextItems = new Map(scene.map((item) => [item.id, item]))
    const nextElements = new Map(generated.map((item) => [item.id, item]))
    const previousIds = new Set(makeElements(previous, live).map((item) => item.id))
    const liveIds = new Set(live.map((item) => item.id))

    const elements = live.map((element) => {
      const next = nextElements.get(element.id)
      if (!next && previousIds.has(element.id)) {
        return newElementWith(element, { isDeleted: true })
      }
      const owner = element.type === 'text' && element.containerId ? element.containerId : element.id
      if (next && element.isDeleted && !oldItems.has(owner)) {
        return newElementWith(element, { ...next, isDeleted: false })
      }
      if (!next || element.isDeleted) {
        return element
      }

      const item = nextItems.get(owner)
      const groups = oldItems.get(owner)?.group !== item?.group ? next.groupIds : element.groupIds
      const changed = JSON.stringify(oldItems.get(owner)) !== JSON.stringify(item) ||
        (item?.kind === 'arrow' && (moves.includes(item.from) || moves.includes(item.to)))
      // Only content and script-owned bindings change; leave user geometry intact.
      const bindings = next.boundElements
        ? [...(element.boundElements ?? []).filter((binding) => !previousIds.has(binding.id)), ...next.boundElements]
        : element.boundElements

      if (changed && item?.kind === 'native') {
        return newElementWith(element, { ...next, x: moves.includes(element.id) ? next.x : element.x,
          y: moves.includes(element.id) ? next.y : element.y })
      }
      if (changed && element.type === 'arrow' && next.type === 'arrow') {
        return newElementWith(element, { x: next.x, y: next.y, width: next.width, height: next.height,
          points: next.points, groupIds: groups, startBinding: next.startBinding, endBinding: next.endBinding })
      }
      if (moves.includes(element.id)) {
        return newElementWith(element, { ...next, groupIds: groups })
      }
      if (changed && element.type === 'text' && next.type === 'text') {
        return newElementWith(element, { text: next.text, originalText: next.originalText,
          width: next.width, height: next.height, boundElements: bindings, groupIds: groups,
          ...(element.containerId ? { x: next.x, y: next.y } : {}) })
      }

      return newElementWith(element, { boundElements: bindings, groupIds: groups,
        ...(changed ? { strokeColor: next.strokeColor, backgroundColor: next.backgroundColor } : {}) })
    })

    elements.push(...generated.filter((item) => !liveIds.has(item.id)))
    return elements
  }

  function apply(scene: BoardScene, moves: readonly string[] = []) {
    desired = scene
    api.updateScene({ elements: project(scene, moves), captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    previous = scene
  }

  function fit() {
    const bounds = convertToExcalidrawElements([{ type: 'rectangle', x: frame.x, y: frame.y, width: frame.w, height: frame.h }])
    api.scrollToContent([...api.getSceneElements(), ...bounds], { fitToContent: true, animate: false })
  }

  function reset() {
    const lessonIds = new Set(makeElements(desired, []).map((item) => item.id))
    const notes = api.getSceneElements().filter((item) => !lessonIds.has(item.id))
    api.updateScene({ elements: [...notes, ...makeElements(desired, [])], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    fit()
  }

  function labels(scene: BoardScene) {
    return makeElements(scene, api.getSceneElements()).filter((item) => item.type === 'text')
  }

  async function capture(scene: BoardScene) {
    const live = new Map(api.getSceneElements().map(item => [item.id, item]))
    const moves = scene.filter(item => {
      const native = live.get(item.id)
      return native && 'x' in item && (item.x !== native.x || item.y !== native.y ||
        ('width' in item && (item.width !== native.width || item.height !== native.height)))
    }).map(item => item.id)
    const canvas = await exportToCanvas({ elements: project(scene, moves).filter(item => !item.isDeleted),
      files: api.getFiles(), appState: { ...api.getAppState(), exportBackground: true, exportScale: 1, viewBackgroundColor: '#ffffff' },
      maxWidthOrHeight: CAPTURE_SIZE, exportPadding: CAPTURE_PADDING })
    return { data: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }
  }

  return { apply, fit, reset, labels, capture, scrollToContent(scene: BoardScene, options: { fitToContent?: boolean; animate?: boolean; viewportZoomFactor?: number }) { api.scrollToContent(makeElements(scene, []), { fitToContent: true, ...options }) } }
}

export function measureBoard(scene: BoardScene) {
  return makeElements(scene, []).map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))
}
