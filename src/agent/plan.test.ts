import assert from 'node:assert/strict'
import test from 'node:test'
import { buildShots } from './plan.ts'
import { planSchema, type AgentRequest } from './schema.ts'

const node: AgentRequest['scene'][number] = { kind: 'node', id: 'browser', text: 'Browser', x: 100, y: 180, width: 240, height: 100, tone: 'neutral' }

test('updates retain user placement and unrelated objects', () => {
  const note = { kind: 'text' as const, id: 'note', text: 'Keep this', x: 50, y: 40, size: 20 }
  const plan = planSchema.parse({ answer: 'Updated', actions: [{ kind: 'put', item: { ...node, text: 'Browser\nCached', x: 500, width: 100 }, caption: 'Add caching' }] })
  const [shot] = buildShots([node, note], plan)
  assert.deepEqual(shot.scene.find(item => item.id === 'browser'), { ...node, text: 'Browser\nCached' })
  assert.deepEqual(shot.scene.find(item => item.id === 'note'), note)
})

test('rejects dangling arrows before returning a drawable plan', () => {
  const plan = planSchema.parse({ answer: 'Connect', actions: [{ kind: 'put', item: { kind: 'arrow', id: 'edge', from: 'browser', to: 'missing' }, caption: 'Connect' }] })
  assert.throws(() => buildShots([node], plan), /existing nodes/)
})

test('removal also removes attached arrows and rejects unknown targets', () => {
  const server = { ...node, id: 'server' }
  const edge = { kind: 'arrow' as const, id: 'edge', from: 'browser', to: 'server' }
  const plan = planSchema.parse({ answer: 'Removed', actions: [{ kind: 'remove', id: 'server', caption: 'Remove server' }] })
  assert.deepEqual(buildShots([node, server, edge], plan)[0].scene, [node])
  assert.throws(() => buildShots([node], plan), /unknown/)
})

test('new follow-up nodes never cover existing nodes', () => {
  const left = { ...node, id: 'dns', x: 60, y: 180 }
  const right = { ...node, id: 'tcp', x: 470, y: 180 }
  const added = { ...node, id: 'failure', x: 300, y: 180, tone: 'amber' as const }
  const plan = planSchema.parse({ answer: 'DNS fails', actions: [{ kind: 'put', item: added, caption: 'DNS fails' }] })
  const result = buildShots([left, right], plan)[0].scene
  const placed = result.find(item => item.id === 'failure')!
  assert.ok('x' in placed && 'width' in placed)
  for (const old of [left, right]) {
    assert.ok(placed.x + placed.width <= old.x || old.x + old.width <= placed.x || placed.y + placed.height <= old.y || old.y + old.height <= placed.y, 'New node overlaps an existing node')
  }
  assert.deepEqual(result.find(item => item.id === 'dns'), left)
  assert.deepEqual(result.find(item => item.id === 'tcp'), right)
})

test('placement reserves text and stays inside the drawing area', () => {
  const title = { kind: 'text' as const, id: 'title', text: 'How DNS works', x: 60, y: 40, size: 28 }
  const plan = planSchema.parse({ answer: 'Explain', actions: [{ kind: 'put', item: { ...node, x: 650, y: 600 }, caption: 'Browser' }] })
  const placed = buildShots([title], plan)[0].scene.find(item => item.id === node.id)!
  assert.ok(placed.kind === 'node')
  assert.ok(placed.x >= 30 && placed.y >= 30 && placed.x + placed.width <= 790 && placed.y + placed.height <= 650)
  const overlap = planSchema.parse({ answer: 'Explain', actions: [{ kind: 'put', item: { ...node, x: 60, y: 40 }, caption: 'Browser' }] })
  const moved = buildShots([title], overlap)[0].scene.find(item => item.id === node.id)!
  assert.ok(moved.kind === 'node' && moved.y >= title.y + title.size * 1.3)
})

test('a full board fails instead of covering existing objects', () => {
  const occupied = Array.from({ length: 9 }, (_, index) => ({ ...node, id: `occupied_${index}`, x: 30 + index % 3 * 250, y: 30 + Math.floor(index / 3) * 200, height: 150 }))
  const plan = planSchema.parse({ answer: 'More', actions: [{ kind: 'put', item: node, caption: 'Browser' }] })
  assert.throws(() => buildShots(occupied, plan), /No room/)
})

test('images connect to nodes and keep their geometry through follow-ups', () => {
  const image = { kind: 'image' as const, id: 'db', assetId: 'aws/database', src: '/library/12345678901234567890.svg', x: 470, y: 180, width: 80, height: 80 }
  const edge = { kind: 'arrow' as const, id: 'read', from: 'browser', to: 'db' }
  const plan = planSchema.parse({ answer: 'Read', actions: [{ kind: 'put', item: edge, caption: 'The server reads the record.' }] })
  assert.deepEqual(buildShots([node, image], plan)[0].scene, [node, image, edge])
  const moved = { ...image, x: 900, width: 180 }
  const update = planSchema.parse({ answer: 'Keep', actions: [{ kind: 'put', item: image, caption: 'The database stays in place.' }] })
  assert.deepEqual(buildShots([moved], update)[0].scene, [moved])
  const remove = planSchema.parse({ answer: 'Removed', actions: [{ kind: 'remove', id: 'db', caption: 'This path is no longer needed.' }] })
  assert.deepEqual(buildShots([node, image, edge], remove)[0].scene, [node])
})

test('icon placement reserves existing images and labels', () => {
  const image = { kind: 'image' as const, id: 'db', assetId: 'aws/database', src: '/library/12345678901234567890.svg', x: 470, y: 180, width: 80, height: 80 }
  const plan = planSchema.parse({ answer: 'Add cache', actions: [{ kind: 'put', item: { ...image, id: 'cache' }, caption: 'A cache stores repeated reads.' }] })
  const placed = buildShots([image], plan)[0].scene.find(item => item.id === 'cache')!
  assert.ok('x' in placed && 'width' in placed)
  assert.ok(placed.x + placed.width <= image.x || image.x + image.width <= placed.x || placed.y + placed.height <= image.y || image.y + image.height <= placed.y)
})
