import { z } from 'zod'

export const assetSchema = z.object({
  id: z.string().describe('Stable opaque catalog key; copy from discovery'),
  name: z.string().describe('Human-readable symbol name; not globally unique'),
  pack: z.string().describe('Collection name; exact join to pack.name'),
  group: z.string().describe('Category within the collection'),
  src: z.string().describe('Local served file path used for image placement'),
  format: z.string().describe('Stored file format; SVG can contain embedded bitmaps'),
  extraction: z.string().describe('Capture method, not a quality score'),
  sourceUrl: z.string().describe('Recorded original source, possibly empty'),
  archived: z.boolean().describe('Archived collection/edition; still available'),
})
export const packSchema = z.object({
  name: z.string().describe('Exact collection name matching asset.pack'),
  count: z.number().int().nonnegative().describe('Actual indexed entry count'),
  archivedCount: z.number().int().nonnegative(),
  expected: z.number().nullable().describe('Expected capture count if recorded'),
  saved: z.number().nullable().describe('Recorded saved count; can differ from current index'),
  groups: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })).describe('All categories in this collection'),
  examples: z.array(assetSchema.pick({ id: true, name: true, group: true, format: true })).describe('Illustrative sample, not all entries or ranked recommendations'),
})
export const catalogSchema = z.object({ asset: assetSchema, pack: packSchema })
