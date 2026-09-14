import { Editions, type LibraryAsset, type LibraryQuery } from './types.ts'

export const PAGE_SIZE = 60
export const MAX_RESULTS = 100
const SCORES = { exact: 100, prefix: 50, name: 20, group: 8, pack: 4, alias: 2 } as const
const ALIASES: Record<string, string[]> = {
  db: ['database'], database: ['database', 'sql', 'dynamodb', 'rds'], storage: ['storage', 's3', 'bucket'],
  llm: ['language model', 'open ai', 'claude', 'gemini', 'mistral'], k8s: ['kubernetes'],
  queue: ['queue', 'sqs'], auth: ['identity', 'authentication', 'cognito'],
}
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// UI and agent requests share the same ranking and edition filters.
export function searchLibrary(assets: readonly LibraryAsset[], query: LibraryQuery = {}) {
  const term = words(query.q ?? '')
  const tokens = term.split(' ').filter(Boolean)
  const ranked: { asset: LibraryAsset; score: number }[] = []
  for (const asset of assets) {
    if (query.pack && asset.pack !== query.pack) { continue }
    if (query.group && asset.group !== query.group) { continue }
    if (query.editions !== Editions.All && asset.archived) { continue }
    const name = words(asset.name), group = words(asset.group), pack = words(asset.pack)
    const text = `${name} ${group} ${pack}`
    if (!tokens.every(token => text.includes(token) || ALIASES[token]?.some(alias => text.includes(alias)))) { continue }
    let score = term && name === term ? SCORES.exact : term && name.startsWith(term) ? SCORES.prefix : 0
    for (const token of tokens) {
      score += name.includes(token) ? SCORES.name : group.includes(token) ? SCORES.group : pack.includes(token) ? SCORES.pack : SCORES.alias
    }
    ranked.push({ asset, score })
  }
  ranked.sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name) || a.asset.id.localeCompare(b.asset.id))
  const offset = Math.max(0, Math.floor(query.offset ?? 0))
  const limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(query.limit ?? PAGE_SIZE)))
  return { total: ranked.length, offset, limit, assets: ranked.slice(offset, offset + limit).map(item => item.asset) }
}
