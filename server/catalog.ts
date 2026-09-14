import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LibraryCatalog } from '../src/library/types.ts'

let cached: { modified: number; catalog: LibraryCatalog } | undefined

export async function readCatalog() {
  const file = resolve('public/library/catalog.json')
  const info = await stat(file)
  if (cached?.modified === info.mtimeMs) { return cached.catalog }
  const catalog: LibraryCatalog = JSON.parse(await readFile(file, 'utf8'))
  cached = { modified: info.mtimeMs, catalog }
  return catalog
}
