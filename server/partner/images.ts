import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalFileStorage } from '@strands-agents/sdk/storage'
import { z } from 'zod'
import type { LibraryAsset } from '../../src/library/types.ts'
import { LESSON_DIR } from './sessions.ts'
import { fetchImage } from './image-fetch.ts'

const RESULT_LIMIT = 8
const SEARCH_LIMIT = 8
const TIMEOUT_MS = 15000
const ENDPOINTS = { brave: 'https://api.search.brave.com/res/v1/images/search', searchapi: 'https://www.searchapi.io/api/v1/search', serpapi: 'https://serpapi.com/search.json' } as const
export const IMAGE_DIR = resolve(LESSON_DIR, 'images')
export const imageQuery = z.object({ query: z.string().trim().min(1).max(200), provider: z.enum(['auto', 'brave', 'searchapi', 'serpapi']).default('auto') })
export type ImageResult = { id: string; title: string; url: string; sourceUrl: string; thumbnail?: string; width?: number; height?: number; provider: string }
type ImportedImage = LibraryAsset & { width?: number; height?: number; mime: string }
const resultSchema = z.object({ id: z.string(), title: z.string(), url: z.url(), sourceUrl: z.string(), thumbnail: z.string().optional(), width: z.number().optional(), height: z.number().optional(), provider: z.string() })
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20)

export async function imageCatalog(directory = IMAGE_DIR): Promise<ImportedImage[]> {
  const storage = new LocalFileStorage(directory)
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') { return [] } throw error })
  return Promise.all(names.filter(name => /^[a-f0-9]{20}\.json$/.test(name)).map(async name => JSON.parse(new TextDecoder().decode((await storage.read(name))!))))
}

export function imageSearch(signal: AbortSignal, options: { fetch?: typeof fetch; download?: typeof fetchImage; directory?: string; keys?: { brave?: string; searchapi?: string; serpapi?: string } } = {}) {
  const network = options.fetch ?? fetch
  const download = options.download ?? fetchImage
  const storage = new LocalFileStorage(options.directory ?? IMAGE_DIR)
  const keys = options.keys ?? { brave: process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY, searchapi: process.env.SEARCHAPI_API_KEY, serpapi: process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY }
  const candidates = new Map<string, ImageResult>()
  let searches = 0
  async function search(value: unknown) {
    const { query, provider } = imageQuery.parse(value)
    if (++searches > SEARCH_LIMIT) { throw new Error('Image search budget reached for this question') }
    const providers = provider === 'auto' ? ['brave', 'searchapi', 'serpapi'] as const : [provider]
    const errors: string[] = []
    for (const name of providers) {
      const key = keys[name]
      if (!key) { errors.push(`${name}: key not configured`); continue }
      try {
        const url = new URL(ENDPOINTS[name])
        url.searchParams.set('q', query)
        if (name === 'brave') { url.searchParams.set('count', String(RESULT_LIMIT)); url.searchParams.set('safesearch', 'strict') }
        else { url.searchParams.set('engine', 'google_images'); url.searchParams.set('api_key', key); url.searchParams.set('safe', 'active') }
        const response = await network(url, { headers: name === 'brave' ? { 'X-Subscription-Token': key } : {}, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) })
        if (!response.ok) { errors.push(`${name}: HTTP ${response.status}`); continue }
        const body = await response.json()
        if (body.error) { errors.push(`${name}: provider returned an error`); continue }
        const rows = name === 'brave' ? body.results : name === 'searchapi' ? body.images : body.images_results
        const results: ImageResult[] = []
        for (const row of Array.isArray(rows) ? rows : []) {
          const image = name === 'brave' ? row.properties : name === 'searchapi' ? { ...row.original, url: row.original?.link } : { url: row.original, width: row.original_width, height: row.original_height }
          const url = image?.url
          if (typeof url !== 'string' || !url.startsWith('https://')) { continue }
          const item = resultSchema.safeParse({ id: hash(name + url), provider: name, url, title: row.title ?? 'Image', sourceUrl: (name === 'brave' ? row.url : name === 'searchapi' ? row.source?.link : row.link) ?? '',
            thumbnail: (name === 'brave' ? row.thumbnail?.src : row.thumbnail) ?? undefined,
            width: image?.width ?? undefined, height: image?.height ?? undefined })
          if (!item.success) { continue }
          candidates.set(item.data.id, item.data); results.push(item.data)
          if (results.length >= RESULT_LIMIT) { break }
        }
        if (results.length || provider !== 'auto') { return { provider: name, results, notes: errors } }
        errors.push(`${name}: no usable results`)
      } catch { signal.throwIfAborted(); errors.push(`${name}: search unavailable`) }
    }
    throw new Error(errors.join('; ') || 'Image search unavailable')
  }
  async function use(value: unknown): Promise<ImportedImage & { assetId: string }> {
    const id = z.string().regex(/^[a-f0-9]{20}$/).parse(value)
    const candidate = candidates.get(id)
    if (!candidate) { throw new Error('Use an ID from images.search in this question') }
    const existing = await storage.read(`${id}.json`)
    if (existing) { const asset = JSON.parse(new TextDecoder().decode(existing)); return { ...asset, assetId: asset.id } }
    const image = await download(candidate.url, signal)
    const file = `${id}.${image.format}`
    const asset: ImportedImage = { id: `web-${id}`, name: candidate.title, pack: 'Web images', group: candidate.provider, src: `/api/images/${file}`, format: image.format, mime: image.mime,
      extraction: 'web-image', sourceUrl: candidate.sourceUrl, archived: false, width: candidate.width, height: candidate.height }
    await storage.write(file, image.bytes)
    await storage.write(`${id}.json`, new TextEncoder().encode(JSON.stringify(asset)))
    return { ...asset, assetId: asset.id }
  }
  return { search, use }
}
