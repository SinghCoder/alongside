import { normalizeNative } from './native.ts'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { BoardItem, BoardScene } from '../../src/board/types.ts'
import type { Capture, Command, Measurement, Reply, Snapshot } from '../../src/partner/protocol.ts'
import { objectSchema, pageOperationSchema, documentOpSchema, MAX_OBJECTS } from '../../src/partner/protocol.ts'
import { route, type Bounds, type Point } from '../../src/board/geometry.ts'
import type { LibraryCatalog } from '../../src/library/types.ts'
import { searchLibrary } from '../../src/library/search.ts'
import { imageQuery, type imageSearch } from './images.ts'
import { assetSchema, packSchema, catalogSchema } from './catalog-schema.ts'

const MAX_CAPTURES = 12
const MAX_BEATS = 16
const DOCS = new Map([
  ['SKILL.md', 'Workflow and available capabilities'],
  ['references/page-api.md', 'Connected Chrome page context and read-only JavaScript evaluation'],
  ['references/document-api.md', 'Persistent lesson pages: list, read, copy, create, open and rename'],
  ['schemas/document.json', 'Generated document operation schema'],
  ['references/scene-api.md', 'Board object schemas, operations and playback'],
  ['references/asset-catalog.md', 'Asset and pack schemas, field meanings, discovery and source inspection'],
  ['references/web-images.md', 'Web image providers, search and import schemas, limits and examples'],
  ['schemas/images.json', 'Generated image search input schema'],
  ['schemas/board.json', 'Generated JSON Schema for accepted board objects'],
  ['schemas/catalog.json', 'Generated JSON Schemas for asset and pack records'],
])
const PACK_EXAMPLES = 3
const DRAW_MS = 900
const PEN_SPEED = 0.45
const IMAGE_MS = 300
const SOURCE_CHARS = 8000
const MAX_SOURCE_CHARS = 12000
const intersects = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

function crosses(a: Point, b: Point, box: Bounds) {
  let low = 0, high = 1
  for (const [p, q] of [[a.x - b.x, a.x - box.x], [b.x - a.x, box.x + box.width - a.x], [a.y - b.y, a.y - box.y], [b.y - a.y, box.y + box.height - a.y]]) {
    if (p === 0 && q < 0) { return false }
    if (p < 0) { low = Math.max(low, q / p) }
    if (p > 0) { high = Math.min(high, q / p) }
  }
  return low <= high
}

export function diagnostics(scene: BoardScene, bounds: Measurement[]) {
  const boxes = new Map(bounds.map(item => [item.id, item]))
  const objects = scene.filter(item => item.kind !== 'arrow' && item.kind !== 'path')
  const issues: string[] = []
  for (const [index, item] of objects.entries()) {
    const a = boxes.get(item.id)
    if (!a) { continue }
    if (item.kind !== 'native' && (a.x < 0 || a.y < 0 || a.x + a.width > 820 || a.y + a.height > 650)) { issues.push(`${item.id}: outside teaching frame`) }
    for (const other of objects.slice(index + 1)) {
      const b = boxes.get(other.id)
      if (b && intersects(a, b)) { issues.push(`${item.id} overlaps ${other.id}`) }
    }
  }
  for (const edge of scene) {
    if (edge.kind !== 'arrow') { continue }
    const from = boxes.get(edge.from), to = boxes.get(edge.to)
    if (!from || !to) { continue }
    const points = route(edge, from, to)
    for (const item of objects) {
      if ([edge.from, edge.to].includes(item.id)) { continue }
      const box = boxes.get(item.id)
      if (box && points.slice(1).some((end, index) => crosses(points[index], end, box))) { issues.push(`${edge.id} intersects ${item.id}`) }
    }
  }
  return issues
}

export function workspace(initial: Snapshot, catalog: LibraryCatalog, exchange: (command: Command) => Promise<Reply>, images?: ReturnType<typeof imageSearch>, delivery: 'live' | 'draft' = 'draft') {
  let live = initial
  let draft = [...initial.scene]
  let revision = 0
  let beats = 0
  let captureCount = 0
  const captures: Capture[] = []
  const assets = new Map(catalog.assets.map(asset => [asset.id, asset]))
  const retrieved = new Set(initial.scene.flatMap(item => item.kind === 'image' && item.assetId ? [item.assetId] : []))
  const searches: string[] = []
  const trace: { caption: string; changed: string[] }[] = []

  function validate(scene: BoardScene) {
    if (scene.length > MAX_OBJECTS) { throw new Error('Too many objects; simplify this contribution') }
    const byId = new Map(scene.map(item => [item.id, item]))
    if (byId.size !== scene.length) { throw new Error('Duplicate object IDs') }
    for (const item of scene) {
      objectSchema.parse(item)
      if (item.kind === 'arrow' && [item.from, item.to].some(id => !['node', 'image'].includes(byId.get(id)?.kind ?? ''))) { throw new Error(`Missing node/image endpoint for ${item.id}`) }
      if (item.kind !== 'image') { continue }
      const asset = assets.get(item.assetId ?? '')
      if (!asset || asset.src !== item.src || !retrieved.has(asset.id)) { throw new Error(`Search and use a valid catalog asset for ${item.id}`) }
      const old = live.scene.find(previous => previous.id === item.id)
      if (old?.kind === 'image' && old.assetId !== item.assetId) { throw new Error('Use a new ID when replacing an image asset') }
    }
  }
  validate(draft)
  function get(id: unknown) {
    const item = draft.find(item => item.id === id)
    if (!item) { throw new Error(`Unknown object: ${String(id)}`) }
    return item
  }
  async function present(value: unknown) {
    const caption = z.string().min(1).max(500).parse(value)
    validate(draft)
    if (delivery === 'draft' && beats >= MAX_BEATS) { throw new Error('Teaching step budget reached; finish this explanation') }
    const changed = draft.filter(item => JSON.stringify(item) !== JSON.stringify(live.scene.find(old => old.id === item.id)))
    const moves = changed.filter(item => {
      const old = live.scene.find(old => old.id === item.id)
      return old && 'x' in old && 'x' in item && (old.x !== item.x || old.y !== item.y || ('width' in old && 'width' in item && (old.width !== item.width || old.height !== item.height)))
    }).map(item => item.id)
    const removed = live.scene.filter(item => !draft.some(next => next.id === item.id))
    if (delivery === 'live' && !changed.length && !removed.length) { return { revision, objects: live.scene } }
    const focus = changed[0]?.id ?? removed[0]?.id ?? draft[0]?.id ?? 'empty'
    const shot = { speed: delivery === 'live' ? PEN_SPEED : undefined, scene: draft, focus, caption, moves, duration: changed.every(item => ['image', 'text'].includes(item.kind)) ? IMAGE_MS : DRAW_MS }
    const reply = await exchange({ type: 'present', before: live.scene, shot })
    live = { scene: reply.scene, notes: reply.notes, annotations: reply.annotations, userMovedIds: reply.userMovedIds }; draft = [...live.scene]; revision++
    if (reply.status === 'stale') { throw new Error('User edited the board. Draft discarded; inspect current state and adapt.') }
    beats++; trace.push({ caption, changed: [...changed, ...removed].map(item => item.id) })
    return { revision, objects: live.scene, notes: live.notes, annotations: live.annotations ?? [], userMovedIds: live.userMovedIds ?? [], diagnostics: diagnostics(live.scene, reply.bounds) }
  }

  async function call(method: string, value: unknown): Promise<unknown> {
    if (method === 'page.snapshot' || method === 'page.evaluate') {
      const operation = pageOperationSchema.parse(method === 'page.snapshot' ? { type: 'snapshot' } : { type: 'evaluate', code: value })
      const result = await exchange({ type: 'page', operation })
      if (result.pageError) { throw new Error(result.pageError) }
      return result.pageResult
    }
    if (method === 'document') {
      const operation = documentOpSchema.parse(value)
      if (!['list', 'read'].includes(operation.action) && JSON.stringify(draft) !== JSON.stringify(live.scene)) { throw new Error('Present or discard the current draft before changing steps') }
      const result = await exchange({ type: 'document', operation, before: live.scene })
      if (result.status === 'stale') {
        live = { scene: result.scene, notes: result.notes, annotations: result.annotations, userMovedIds: result.userMovedIds }
        draft = [...live.scene]; revision++
        throw new Error('The board changed. Read current state before changing steps.')
      }
      if (!result.document) { throw new Error('Browser did not return document state') }
      if (!['list', 'read'].includes(operation.action)) {
        live = { scene: result.scene, notes: result.notes, annotations: result.annotations, userMovedIds: result.userMovedIds }
        draft = [...live.scene]; revision++
        for (const item of draft) { if (item.kind === 'image' && item.assetId) { retrieved.add(item.assetId) } }
        validate(draft)
      }
      return result.document
    }
    if (method === 'snapshot') { return { revision, scene: draft, notes: live.notes, annotations: live.annotations ?? [], userMovedIds: live.userMovedIds ?? [] } }
    if (method === 'capture') {
      validate(draft)
      if (captureCount >= MAX_CAPTURES) { throw new Error('Capture budget reached') }
      const reply = await exchange({ type: 'capture', scene: draft, before: live.scene })
      if (reply.status === 'stale') {
        live = { scene: reply.scene, notes: reply.notes, annotations: reply.annotations, userMovedIds: reply.userMovedIds }
        draft = [...live.scene]; revision++
        throw new Error('User edited the board. Draft discarded; inspect current state and adapt.')
      }
      if (!reply.image) { throw new Error('Browser did not return a draft image') }
      captures.push(reply.image); captureCount++
      return { width: reply.image.width, height: reply.image.height, instruction: 'End this execution to see the image. Review it before presenting.' }
    }
    if (method === 'viewport') {
      const { ids, options } = z.object({ ids: z.array(z.string()).default([]), options: z.object({ fitToContent: z.boolean().optional(), animate: z.boolean().optional(), viewportZoomFactor: z.number().min(0.1).max(1).optional() }).default({}) }).parse(value)
      const scene = ids.length ? draft.filter(item => ids.includes(item.id)) : draft
      if (!scene.length) { throw new Error('No objects to frame') }
      await exchange({ type: 'viewport', scene, options })
      return { framed: scene.map(item => item.id) }
    }
    if (method === 'get') { return get(value) }
    if (method === 'discard') { draft = [...live.scene]; return { revision, scene: draft } }
    if (method === 'present') { return present(value) }
    if (method === 'inspect') {
      validate(draft)
      const result = await exchange({ type: 'inspect', scene: draft })
      return { revision, objects: draft, bounds: result.bounds, diagnostics: diagnostics(draft, result.bounds), notes: result.notes, annotations: result.annotations ?? [] }
    }
    if (method === 'put') {
      const item = objectSchema.parse(normalizeNative(value)) as BoardItem
      const previous = draft.find(old => old.id === item.id)
      if (previous && previous.kind !== item.kind) { throw new Error('Remove an object before changing its type') }
      const next = previous ? draft.map(old => old.id === item.id ? item : old) : [...draft, item]
      validate(next); draft = next
      if (delivery === 'live') { await present('Drawing together…') }
      return item
    }
    if (method === 'patch') {
      const { id, changes } = z.object({ id: z.string(), changes: z.record(z.string(), z.unknown()) }).parse(value)
      const current = get(id)
      if (current.kind !== 'native') { return call('put', { ...current, ...changes, id }) }
      // Native callers use Excalidraw fields directly; never silently drop edits.
      const { element, id: _id, kind: _kind, group, ...fields } = changes
      const nested = element === undefined ? {} : z.record(z.string(), z.unknown()).parse(element)
      return call('put', { ...current, ...fields, id, ...(group === undefined ? {} : { group }),
        element: { ...current.element, ...fields, ...nested } })
    }
    if (method === 'remove') {
      get(value)
      draft = draft.filter(item => item.id !== value && !(item.kind === 'arrow' && [item.from, item.to].includes(String(value))))
      if (delivery === 'live') { await present('Updating the explanation…') }
      return { removed: value }
    }
    if (method === 'images.search') {
      if (!images) { throw new Error('Image search is unavailable') }
      return images.search(value)
    }
    if (method === 'images.use') {
      if (!images) { throw new Error('Image search is unavailable') }
      const asset = await images.use(value)
      assets.set(asset.id, asset); retrieved.add(asset.id)
      return asset
    }
    if (method === 'assets.packs') {
      const names = new Set([...catalog.packs.map(pack => pack.name), ...catalog.assets.map(asset => asset.pack)])
      return [...names].map(name => {
        const entries = catalog.assets.filter(asset => asset.pack === name)
        const groups = new Map<string, number>()
        for (const asset of entries) { groups.set(asset.group, (groups.get(asset.group) ?? 0) + 1) }
        const capture = catalog.packs.find(pack => pack.name === name)
        return packSchema.parse({ name, count: entries.length, archivedCount: entries.filter(asset => asset.archived).length,
          expected: capture?.expected ?? null, saved: capture?.saved ?? null,
          groups: [...groups].map(([name, count]) => ({ name, count })),
          examples: entries.slice(0, PACK_EXAMPLES).map(({ id, name, group, format }) => ({ id, name, group, format })) })
      })
    }
    if (method === 'assets.catalog') {
      return catalog.assets.map(asset => assetSchema.parse(asset))
    }
    if (method === 'assets.get') {
      const asset = assets.get(String(value))
      if (!asset) { throw new Error('Unknown asset ID; discover it through ALL_ASSETS or search') }
      retrieved.add(asset.id)
      return { ...assetSchema.parse(asset), assetId: asset.id }
    }
    if (method === 'assets.search') {
      const query = z.string().min(1).max(120).parse(value)
      searches.push(query)
      const result = searchLibrary(catalog.assets, { q: query, limit: 8 })
      for (const asset of result.assets) { retrieved.add(asset.id) }
      return { schema: 'references/asset-catalog.md', total: result.total, assets: result.assets.map(({ id, name, src, pack }) => ({ assetId: id, name, src, pack })) }
    }
    if (method === 'assets.read') {
      const { id, offset, limit } = z.object({ id: z.string(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(MAX_SOURCE_CHARS).default(SOURCE_CHARS) }).parse(value)
      const asset = assets.get(id)
      if (!asset) { throw new Error('Unknown asset ID') }
      if (asset.format !== 'svg') { throw new Error(`Asset is ${asset.format}, not SVG text. Use assets.inspect for metadata.`) }
      const source = await readFile(resolve('public', '.' + asset.src), 'utf8')
      const end = Math.min(offset + limit, source.length)
      return { assetId: id, source: source.slice(offset, end), offset, totalChars: source.length, nextOffset: end < source.length ? end : null }
    }
    if (method === 'assets.inspect') {
      const asset = assets.get(String(value))
      if (!asset) { throw new Error('Unknown asset ID; discover it through ALL_ASSETS or search') }
      if (asset.extraction === 'web-image') { return { ...asset, instruction: 'Use board.capture to review this raster image in context.' } }
      const content = await readFile(resolve('public', '.' + asset.src))
      const svg = asset.format === 'svg' ? content.toString() : ''
      const embedded = [...svg.matchAll(/data:image\/png;base64,([^"\s]+)/g)].map(match => {
        const png = Buffer.from(match[1], 'base64')
        return png.length >= 24 ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } : null
      })
      return { assetId: asset.id, format: asset.format, embeddedBitmaps: embedded, svgHeader: svg.slice(0, svg.indexOf('>') + 1) }
    }
    if (method === 'help') {
      if (!DOCS.has(String(value))) { return { documents: [...DOCS].map(([path, description]) => ({ path, description })) } }
      if (value === 'schemas/document.json') { return JSON.stringify(z.toJSONSchema(documentOpSchema)) }
      if (value === 'schemas/images.json') { return JSON.stringify(z.toJSONSchema(imageQuery)) }
      if (value === 'schemas/board.json') { return JSON.stringify(z.toJSONSchema(objectSchema)) }
      if (value === 'schemas/catalog.json') { return JSON.stringify(z.toJSONSchema(catalogSchema)) }
      return readFile(resolve('skills/whiteboard', String(value)), 'utf8')
    }
    throw new Error(`Unknown operation: ${method}`)
  }
  return { register(asset: import('../../src/library/types.ts').LibraryAsset) { assets.set(asset.id, asset); retrieved.add(asset.id) }, call, searches, trace, takeCaptures: () => captures.splice(0), snapshot: () => live }
}
