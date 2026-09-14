import test from 'node:test'
import assert from 'node:assert/strict'
import { workspace, diagnostics } from './workspace.ts'
import { Tone, type BoardItem } from '../../src/board/types.ts'
import type { Reply } from '../../src/partner/protocol.ts'
const catalog = { version: 1, packs: [], assets: [] }
const node = (id: string, x: number): BoardItem => ({ kind: 'node', id, x, y: 100, width: 100, height: 60, text: id, tone: Tone.Neutral })

test('presentation adopts user geometry and stale drafts are discarded', async () => {
  let stale = false
  const work = workspace({ scene: [], notes: [] }, catalog, async command => {
    assert.equal(command.type, 'present')
    return { scene: [node('a', 320)], notes: ['user note'], bounds: [], status: stale ? 'stale' : 'ok' } as Reply
  })
  await work.call('put', node('a', 20))
  await work.call('present', 'First idea')
  assert.equal((await work.call('get', 'a') as { x: number }).x, 320)
  await work.call('put', node('b', 500))
  stale = true
  await assert.rejects(work.call('present', 'Second idea'), /User edited/)
  await assert.rejects(work.call('get', 'b'), /Unknown/)
})

test('invalid mutations leave draft intact and overlap feedback does not relocate', async () => {
  const scene = [node('a', 20), node('b', 50)]
  const work = workspace({ scene, notes: [] }, catalog, async () => ({ scene, notes: [], bounds: [], status: 'ok' }))
  await assert.rejects(work.call('put', { kind: 'arrow', id: 'bad', from: 'a', to: 'missing' }), /Missing/)
  assert.equal((await work.call('snapshot') as { scene: unknown[] }).scene.length, 2)
  const bounds = scene.map(item => ({ id: item.id, x: 'x' in item ? item.x : 0, y: 100, width: 100, height: 60 }))
  assert.deepEqual(diagnostics(scene, bounds), ['a overlaps b'])
  assert.equal((await work.call('get', 'b') as { x: number }).x, 50)
})

test('connector diagnostics distinguish a crossing from a routed branch', () => {
  const scene = [node('a', 0), node('middle', 200), node('b', 400)]
  const bounds = scene.map(item => ({ id: item.id, x: 'x' in item ? item.x : 0, y: 100, width: 100, height: 60 }))
  const edge: BoardItem = { kind: 'arrow', id: 'edge', from: 'a', to: 'b' }
  assert.deepEqual(diagnostics([...scene, edge], bounds), ['edge intersects middle'])
  assert.deepEqual(diagnostics([...scene, { ...edge, fromAnchor: 'bottom', toAnchor: 'bottom', via: [{ x: 50, y: 250 }, { x: 450, y: 250 }] }], bounds), [])
})

test('catalog discovery resolves assets without relying on search ranking', async () => {
  const asset = { id: 'db', name: 'Database', pack: 'Architecture', group: 'Storage', format: 'svg', archived: false, src: '/library/aaaaaaaaaaaaaaaaaaaa.svg', extraction: 'vector', sourceUrl: 'https://example.com/private-metadata' }
  const work = workspace({ scene: [], notes: [] }, { ...catalog, assets: [asset] }, async () => { throw new Error('No playback expected') })
  const index = await work.call('assets.catalog', null) as { id: string; src?: string; sourceUrl?: string }[]
  assert.equal(index[0].id, 'db')
  assert.equal(index[0].src, asset.src)
  assert.equal(index[0].sourceUrl, asset.sourceUrl)
  const resolved = await work.call('assets.get', index[0].id) as { assetId: string; src: string }
  await work.call('put', { kind: 'image', id: 'database', assetId: resolved.assetId, src: resolved.src, x: 40, y: 80, width: 64, height: 64 })
  assert.deepEqual(work.searches, [])
  await assert.rejects(work.call('assets.get', 'invented'), /Unknown asset/)
})

test('user annotations remain available before and after presentation', async () => {
  const annotations = [{ id: 'user-line', type: 'freedraw', x: 900, y: 40, points: [[0, 0], [40, 80]] }]
  const work = workspace({ scene: [], notes: [], annotations }, catalog, async () => ({ scene: [], notes: [], annotations, bounds: [], status: 'ok' }))
  assert.deepEqual((await work.call('snapshot') as { annotations: unknown }).annotations, annotations)
  assert.deepEqual((await work.call('present', 'Consider your annotation') as { annotations: unknown }).annotations, annotations)
})

test('pack discovery supplies schemas, complete groups and explicit examples', async () => {
  const assets = ['Compute', 'Storage', 'Storage', 'Network'].map((group, index) => ({ id: `asset-${index}`, name: `Symbol ${index}`, pack: 'Sample pack', group, src: '/asset.svg', format: 'svg', archived: index === 0, sourceUrl: '', extraction: 'capture' }))
  const work = workspace({ scene: [], notes: [] }, { version: 1, packs: [{ name: 'Sample pack', expected: 5, saved: 4 }], assets }, async () => { throw new Error('No playback expected') })
  const packs = await work.call('assets.packs') as { name: string; count: number; archivedCount: number; groups: unknown; examples: unknown[] }[]
  assert.equal(packs[0].count, 4)
  assert.equal(packs[0].archivedCount, 1)
  assert.deepEqual(packs[0].groups, [{ name: 'Compute', count: 1 }, { name: 'Storage', count: 2 }, { name: 'Network', count: 1 }])
  assert.equal(packs[0].examples.length, 3)
  const help = await work.call('help') as { documents: { path: string; description: string }[] }
  assert.ok(help.documents.some(doc => doc.path === 'references/asset-catalog.md' && /schemas/.test(doc.description)))
})

test('generated schemas describe the records returned by discovery', async () => {
  const work = workspace({ scene: [], notes: [] }, catalog, async () => { throw new Error('No playback expected') })
  const schema = JSON.parse(await work.call('help', 'schemas/catalog.json') as string)
  assert.equal(schema.properties.asset.properties.pack.type, 'string')
  assert.match(schema.properties.asset.properties.pack.description, /join/)
  const board = JSON.parse(await work.call('help', 'schemas/board.json') as string)
  assert.ok(board.oneOf.some((item: { properties: { kind: { const: string } } }) => item.properties.kind.const === 'image'))
})

test('draft capture returns metadata while keeping image bytes out of JavaScript', async () => {
  const image = { data: 'iVBORw0KGgo=', width: 400, height: 300 }
  const scene = [node('a', 20)]
  const work = workspace({ scene, notes: [], userMovedIds: ['a'] }, catalog, async command => {
    assert.equal(command.type, 'capture')
    return { scene, notes: [], userMovedIds: ['a'], status: 'ok', bounds: [], image }
  })
  const result = await work.call('capture') as { width: number; data?: string }
  assert.equal(result.width, 400)
  assert.equal(result.data, undefined)
  assert.deepEqual(work.takeCaptures(), [image])
  assert.deepEqual(work.takeCaptures(), [])
  assert.deepEqual((await work.call('snapshot') as { userMovedIds: string[] }).userMovedIds, ['a'])
})

test('stale captures discard the draft and never expose an outdated image', async () => {
  const scene = [node('a', 20)]
  const moved = [node('a', 200)]
  const work = workspace({ scene, notes: [] }, catalog, async () => ({
    status: 'stale', scene: moved, notes: [], bounds: [], userMovedIds: ['a'],
  }))
  await work.call('patch', { id: 'a', changes: { x: 90 } })
  await assert.rejects(work.call('capture'), /User edited/)
  assert.deepEqual(work.takeCaptures(), [])
  assert.deepEqual(work.snapshot().scene, moved)
})

test('native drawing retains Excalidraw fields and registers generated assets', async () => {
  const work = workspace({ scene: [], notes: [] }, { version: 1, packs: [], assets: [] }, async () => { throw new Error('unused') })
  const item = { kind: 'native', id: 'attention', x: 100, y: 100, width: 160, height: 60,
    element: { type: 'rectangle', strokeColor: '#1971c2', backgroundColor: '#d0ebff', label: { text: 'Attention' } } }
  assert.deepEqual(await work.call('put', item), item)
  const asset = { id: 'local-123', src: '/api/images/12345678901234567890.png', name: 'Crop', pack: 'Lesson files', group: '', format: 'png', extraction: 'web-image', sourceUrl: '', archived: false }
  work.register(asset)
  await work.call('put', { kind: 'image', id: 'crop', assetId: asset.id, src: asset.src, x: 0, y: 0, width: 100, height: 100 })
})

test('native axis-aligned arrows survive renderer dimensions', async () => {
  const work = workspace({ scene: [], notes: [] }, { version: 1, packs: [], assets: [] }, async () => { throw new Error('unused') })
  const item = { kind: 'native', id: 'vertical', x: 10, y: 10, width: 0, height: 100,
    element: { type: 'arrow', points: [[0, 0], [0, 100]] } }
  assert.deepEqual(await work.call('put', item), item)
})

test('native patches apply public element fields instead of dropping them', async () => {
  const work = workspace({ scene: [], notes: [] }, { version: 1, packs: [], assets: [] }, async () => { throw new Error('unused') })
  await work.call('put', { kind: 'native', id: 'label', x: 0, y: 0, width: 1, height: 1,
    element: { type: 'text', text: 'Long label', fontSize: 20, strokeColor: '#123456' } })
  const updated = await work.call('patch', { id: 'label', changes: { text: 'Short', fontSize: 14, x: 10 } }) as { x: number; element: Record<string, unknown> }
  assert.equal(updated.element.text, 'Short')
  assert.equal(updated.element.fontSize, 14)
  assert.equal(updated.element.strokeColor, '#123456')
  assert.equal(updated.x, 10)
})

test('document switches require a settled draft and adopt the restored page', async () => {
  let calls = 0
  const work = workspace({ scene: [node('source', 10)], notes: [] }, catalog, async command => {
    calls++
    assert.equal(command.type, 'document')
    return { scene: [node('detail', 300)], notes: ['preserved note'], bounds: [], status: 'ok',
      document: { activeId: 'detail', pages: [{ id: 'detail', title: 'Detail', objects: 1 }] } }
  })
  await work.call('put', node('draft', 100))
  await assert.rejects(work.call('document', { action: 'copy', id: 'next', title: 'Next' }), /Present or discard/)
  assert.equal(calls, 0)
  await work.call('discard', null)
  await work.call('document', { action: 'open', id: 'detail' })
  assert.equal((await work.call('get', 'detail') as { x: number }).x, 300)
  await assert.rejects(work.call('get', 'source'), /Unknown/)
})

test('source page tools use the existing exchange and surface disconnected errors', async () => {
  const work = workspace({ scene: [], notes: [] }, catalog, async command => {
    assert.equal(command.type, 'page')
    if (command.type !== 'page') { throw new Error('Wrong command') }
    return { scene: [], notes: [], bounds: [], status: 'ok', ...(command.operation.type === 'snapshot' ? { pageResult: { title: 'PR context' } } : { pageError: 'Source navigated' }) }
  })
  assert.deepEqual(await work.call('page.snapshot', null), { title: 'PR context' })
  await assert.rejects(work.call('page.evaluate', 'document.title'), /Source navigated/)
})

test('native upward arrows retain endpoints with positive bounds', async () => {
  const work = workspace({scene:[],notes:[]},catalog,async()=>{throw new Error('No presentation expected')})
  const item = await work.call('put',{kind:'native',id:'up',x:717,y:1172,width:0,height:-45,element:{type:'arrow',points:[[0,0],[0,-45]],endArrowhead:'triangle'}}) as Extract<BoardItem, {kind:'native'}>
  assert.equal(item.y,1127)
  assert.equal(item.height,45)
  assert.deepEqual(item.element.points,[[0,45],[0,0]])
})

test('live delivery presents each mutation before the next SDK call', async () => {
  const shown: string[][] = []
  const work = workspace({scene:[],notes:[]},catalog,async command=>{
    assert.equal(command.type,'present')
    if(command.type !== 'present'){throw new Error('Expected presentation')}
    shown.push(command.shot.scene.map(item=>item.id))
    return {scene:command.shot.scene,notes:[],bounds:[],status:'ok'}
  },undefined,'live')
  await work.call('put',node('first',0))
  assert.deepEqual(shown,[['first']])
  await work.call('put',node('second',200))
  assert.deepEqual(shown,[['first'],['first','second']])
})
