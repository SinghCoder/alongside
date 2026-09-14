export type LibraryAsset = {
  id: string
  name: string
  pack: string
  group: string
  src: string
  format: string
  extraction: string
  sourceUrl: string
  archived: boolean
}
export type LibraryCatalog = {
  version: number
  packs: { name: string; expected: number; saved: number }[]
  assets: LibraryAsset[]
}
export enum Editions { Current = 'current', All = 'all' }
export type LibraryQuery = { q?: string; pack?: string; group?: string; editions?: Editions; offset?: number; limit?: number }
