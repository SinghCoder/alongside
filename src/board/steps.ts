import { EMPTY_DOCUMENT, type BoardDocument, type BoardPage } from './document.ts'

export type DocumentOp =
  | { action: 'list' }
  | { action: 'read'; id: string }
  | { action: 'open'; id: string }
  | { action: 'create'; id: string; title: string }
  | { action: 'copy'; id: string; title: string; from?: string }
  | { action: 'rename'; id: string; title: string }
export const MAX_STEPS = 30
export const FIRST_STEP = 'start'

export function pageOf(document: BoardDocument): BoardPage {
  const { steps: _steps, ...page } = document
  return page
}
export function withSteps(document: BoardDocument): BoardDocument {
  if (document.steps) { return document }
  return { ...document, steps: { activeId: FIRST_STEP, pages: [{ id: FIRST_STEP, title: 'Starting point', board: pageOf(document) }] } }
}
// Capture the active page before any switch; copies never share mutable objects.
export function savePage(document: BoardDocument, board: BoardPage): BoardDocument {
  const steps = withSteps(document).steps!
  return { ...board, steps: { ...steps, pages: steps.pages.map(page => page.id === steps.activeId ? { ...page, board } : page) } }
}
export function documentInfo(document: BoardDocument, id?: string) {
  const steps = withSteps(document).steps!
  const page = id === undefined ? undefined : steps.pages.find(page => page.id === id)
  if (id !== undefined && !page) { throw new Error(`Unknown step: ${id}`) }
  return { activeId: steps.activeId, pages: steps.pages.map(({ id, title, parentId, board }) => ({ id, title, ...(parentId ? { parentId } : {}), objects: board.snapshot.scene.length })),
    ...(page ? { page: { id: page.id, title: page.title, snapshot: page.board.snapshot } } : {}) }
}
export function changeStep(document: BoardDocument, operation: DocumentOp): BoardDocument {
  const current = withSteps(document)
  const steps = current.steps!
  if (operation.action === 'list' || operation.action === 'read') { return current }
  if (operation.action === 'rename') {
    if (!steps.pages.some(page => page.id === operation.id)) { throw new Error('Unknown step') }
    return { ...current, steps: { ...steps, pages: steps.pages.map(page => page.id === operation.id ? { ...page, title: operation.title } : page) } }
  }
  if (operation.action === 'open') {
    const page = steps.pages.find(page => page.id === operation.id)
    if (!page) { throw new Error('Unknown step') }
    return { ...structuredClone(page.board), steps: { ...steps, activeId: page.id } }
  }
  if (steps.pages.length >= MAX_STEPS) { throw new Error('Step limit reached') }
  if (steps.pages.some(page => page.id === operation.id)) { throw new Error('Step ID already exists') }
  const source = operation.action === 'copy' ? steps.pages.find(page => page.id === (operation.from ?? steps.activeId)) : undefined
  if (operation.action === 'copy' && !source) { throw new Error('Unknown source step') }
  const board = structuredClone(source?.board ?? EMPTY_DOCUMENT)
  const page = { id: operation.id, title: operation.title, ...(source ? { parentId: source.id } : {}), board }
  return { ...board, steps: { activeId: page.id, pages: [...steps.pages, page] } }
}
