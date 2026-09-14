import assert from 'node:assert/strict'
import test from 'node:test'
import { visualLibrary } from './visual-library.ts'
import { planSchema, type AgentRequest } from '../src/agent/schema.ts'
import type { LibraryCatalog } from '../src/library/types.ts'

const src = '/library/12345678901234567890.svg'
const asset = { id: 'aws/lambda', name: 'AWS Lambda', pack: 'AWS', group: 'Compute', src, format: 'svg', extraction: 'svg', sourceUrl: '', archived: false }
const catalog: LibraryCatalog = { version: 1, packs: [], assets: [asset] }
const icon: AgentRequest['scene'][number] = { kind: 'image', id: 'function', assetId: asset.id, src, x: 60, y: 180, width: 64, height: 64 }
const plan = planSchema.parse({ answer: 'Function', actions: [{ kind: 'put', item: icon, caption: 'Run the application code.' }] })

test('new icons must come from search results and match their catalog source', () => {
  const library = visualLibrary(catalog, [])
  assert.throws(() => library.validate(plan), /Search the library/)
  library.search(['AWS Lambda'])
  assert.deepEqual(library.validate(plan), plan)
  assert.deepEqual(library.searches[0].assetIds, [asset.id])
  const tampered = planSchema.parse({ ...plan, actions: [{ kind: 'put', item: { ...icon, src: '/library/00000000000000000000.svg' }, caption: 'Function' }] })
  assert.throws(() => library.validate(tampered), /mismatched/)
})

test('existing icons are reusable without searching and unknown context fails', () => {
  assert.deepEqual(visualLibrary(catalog, [icon]).validate(plan), plan)
  assert.throws(() => visualLibrary(catalog, [{ ...icon, assetId: 'missing' }]), /Unknown/)
  assert.throws(() => planSchema.parse({ ...plan, actions: [{ kind: 'put', item: { ...icon, src: 'https://example.com/icon.svg' }, caption: 'Function' }] }))
})

test('empty results and bounded searches do not invent assets', () => {
  const library = visualLibrary(catalog, [])
  library.search(['not found'])
  assert.equal(library.searches[0].assetIds.length, 0)
  assert.throws(() => library.validate(plan), /Search the library/)
  library.search(Array(7).fill('Lambda'))
  assert.deepEqual(library.search(['Lambda']), { error: 'Search budget reached. Use existing results or native shapes.' })
})
