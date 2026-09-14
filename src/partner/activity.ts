export type Activity = {
  id: string
  recovered?: boolean
  turnId?: string
  kind: 'tool' | 'operation' | 'summary' | 'text'
  name: string
  status: 'running' | 'done' | 'error'
  at: number
  durationMs?: number
  input?: unknown
  output?: unknown
  text?: string
}
export function mergeActivity(items: Activity[], next: Activity) {
  const index = items.findIndex(item => item.id === next.id)
  if (index < 0) { return [...items, next] }
  return items.map((item, i) => i === index ? { ...item, ...next, text: next.text ? (item.text ?? '') + next.text : item.text } : item)
}

const LABELS: Record<string, string> = {
  'page.context': 'Read question context', 'page.snapshot': 'Read source page', 'page.evaluate': 'Inspect page with JavaScript',
  document: 'Work with lesson steps',
  exec: 'Run shell', view: 'View image', importImage: 'Import lesson image', emitImage: 'Inspect image',
  execute_whiteboard: 'Run JavaScript', 'images.search': 'Search web images', 'images.use': 'Import image',
  'assets.search': 'Search symbol library', 'assets.get': 'Read symbol', 'assets.inspect': 'Inspect symbol',
  'assets.catalog': 'Read asset catalog', 'assets.packs': 'Read library packs', 'assets.read': 'Read SVG source',
  snapshot: 'Read board', capture: 'Review draft image', present: 'Draw contribution', inspect: 'Measure layout',
  put: 'Add or update object', patch: 'Edit object', remove: 'Remove object', help: 'Read SDK reference',
  activate_skill: 'Read skill', skills: 'Read skill',
}
export const activityLabel = (item: Activity) => LABELS[item.name] ?? item.name.replaceAll('_', ' ')
