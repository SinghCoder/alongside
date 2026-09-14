import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_DOCUMENT } from './document.ts'
import { changeStep, savePage, withSteps, documentInfo } from './steps.ts'

test('copies preserve exact pages, edits stay local and navigation restores originals', () => {
  const source = withSteps({ ...EMPTY_DOCUMENT, snapshot: { scene: [], notes: ['original annotation'] }, viewport: { scrollX: 12, scrollY: 34, zoom: { value: 1.2 } } })
  let document = changeStep(source, { action: 'copy', id: 'detail', title: 'Attention detail' })
  document.snapshot.notes.push('new note')
  document = savePage(document, { ...document.steps!.pages[1].board, snapshot: document.snapshot })
  document = changeStep(document, { action: 'open', id: 'start' })
  assert.deepEqual(document.snapshot.notes, ['original annotation'])
  assert.equal(document.viewport?.zoom.value, 1.2)
  document = changeStep(document, { action: 'open', id: 'detail' })
  assert.deepEqual(document.snapshot.notes, ['original annotation', 'new note'])
  assert.equal(documentInfo(document).pages[1].parentId, 'start')
  assert.throws(() => changeStep(document, { action: 'copy', id: 'detail', title: 'Duplicate' }), /exists/)
  assert.throws(() => changeStep(document, { action: 'open', id: 'absent' }), /Unknown/)
})

test('document schema preserves pages and rejects mismatched active state', async () => {
  const { documentSchema } = await import('../partner/protocol.ts')
  const document = changeStep(withSteps(EMPTY_DOCUMENT), { action: 'create', id: 'next', title: 'Next' })
  assert.equal(documentSchema.parse(document).steps?.pages.length, 2)
  assert.equal(documentSchema.safeParse({ ...document, snapshot: { scene: [], notes: ['not in page'] } }).success, false)
})
