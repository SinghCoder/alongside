import type { LibraryAsset, LibraryCatalog } from '../src/library/types.ts'
import { searchLibrary } from '../src/library/search.ts'
import type { AgentRequest, BoardPlan } from '../src/agent/schema.ts'

const RESULTS_PER_QUERY = 6
const MAX_SEARCHES = 8

export function visualLibrary(catalog: LibraryCatalog, scene: AgentRequest['scene']) {
  const assets = new Map(catalog.assets.map(item => [item.id, item]))
  const available = new Set<string>()
  const searches: { query: string; assetIds: string[] }[] = []

  function validate(item: { assetId: string; src: string }): LibraryAsset {
    const asset = assets.get(item.assetId)
    if (!asset || asset.src !== item.src) { throw new Error('Unknown library asset or mismatched source') }
    return asset
  }
  for (const item of scene) {
    if (item.kind === 'image') { available.add(validate(item).id) }
  }

  return {
    searches,
    search(queries: string[]) {
      if (searches.length + queries.length > MAX_SEARCHES) { return { error: 'Search budget reached. Use existing results or native shapes.' } }
      return queries.map(query => {
        const found = searchLibrary(catalog.assets, { q: query, limit: RESULTS_PER_QUERY })
        searches.push({ query, assetIds: found.assets.map(item => item.id) })
        return { query, total: found.total, assets: found.assets.map(item => {
          available.add(item.id)
          return { assetId: item.id, name: item.name, pack: item.pack, group: item.group, src: item.src }
        }) }
      })
    },
    validate(plan: BoardPlan) {
      for (const action of plan.actions) {
        if (action.kind !== 'put' || action.item.kind !== 'image') { continue }
        validate(action.item)
        if (!available.has(action.item.assetId)) { throw new Error('Search the library before placing a new asset') }
        const previous = scene.find(item => item.id === action.item.id)
        if (previous?.kind === 'image' && previous.assetId !== action.item.assetId) {
          throw new Error('Use a new object ID when replacing an icon')
        }
      }
      return plan
    },
  }
}
