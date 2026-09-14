import assert from 'node:assert/strict'
import test from 'node:test'
import { searchLibrary } from './search.ts'
import { Editions, type LibraryAsset } from './types.ts'

const asset = (id: string, name: string, pack = 'Standard'): LibraryAsset => ({ id, name, pack, archived: false, group: 'Shapes', src: '/library/test.svg', format: 'svg', extraction: 'rendered-svg', sourceUrl: '' })
const fixtures = [asset('db', 'Database'), asset('rds', 'Amazon RDS', 'AWS'), { ...asset('old', 'Database', 'AWS 2017'), archived: true }, asset('icon', 'Database search', 'Agentic AI Workflows')]

test('exact names outrank partial names and aliases', () => {
  assert.equal(searchLibrary(fixtures, { q: 'database' }).assets[0].id, 'db')
  assert.ok(searchLibrary(fixtures, { q: 'database' }).assets.some(item => item.id === 'rds'))
})
test('pack and archive filters compose without leaking other editions', () => {
  assert.deepEqual(searchLibrary(fixtures, { q: 'database', pack: 'AWS' }).assets.map(item => item.id), ['rds'])
  assert.equal(searchLibrary(fixtures, { pack: 'AWS 2017' }).total, 0)
  assert.equal(searchLibrary(fixtures, { pack: 'AWS 2017', editions: Editions.All }).total, 1)
})
test('pagination is stable and reports the full filtered count', () => {
  const first = searchLibrary(fixtures, { limit: 1 })
  const second = searchLibrary(fixtures, { offset: 1, limit: 1 })
  assert.equal(first.total, 3)
  assert.notEqual(first.assets[0].id, second.assets[0].id)
  assert.deepEqual(searchLibrary(fixtures, { q: 'no such object' }).assets, [])
})
