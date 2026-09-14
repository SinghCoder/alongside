import { readCatalog } from './catalog'
import type { Plugin } from 'vite'
import { z } from 'zod'
import { Editions } from '../src/library/types'
import { MAX_RESULTS, searchLibrary } from '../src/library/search'

const HTTP = { OK: 200, BAD_REQUEST: 400, NOT_FOUND: 404, METHOD: 405, UNAVAILABLE: 503 } as const
const querySchema = z.object({ q: z.string().max(200).optional(), pack: z.string().max(100).optional(),
  group: z.string().max(100).optional(), editions: z.nativeEnum(Editions).optional(),
  offset: z.coerce.number().int().min(0).max(100000).optional(), limit: z.coerce.number().int().min(1).max(MAX_RESULTS).optional(),
  id: z.string().max(250).optional() })
export function libraryPlugin(): Plugin {
  return { name: 'local-visual-library', configureServer(server) {
    server.middlewares.use('/api/library/search', async (req, res) => {
      const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
      if (req.method !== 'GET') { send(HTTP.METHOD, { error: 'Use GET' }); return }
      const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams))
      if (!parsed.success) { send(HTTP.BAD_REQUEST, { error: 'Invalid library query' }); return }
      try {
        const catalog = await readCatalog()
        if (parsed.data.id) {
          const asset = catalog.assets.find(item => item.id === parsed.data.id)
          send(asset ? HTTP.OK : HTTP.NOT_FOUND, asset ?? { error: 'Unknown asset' }); return
        }
        send(HTTP.OK, searchLibrary(catalog.assets, parsed.data))
      } catch { send(HTTP.UNAVAILABLE, { error: 'Local library is unavailable; run the import.' }) }
    })
  } }
}
