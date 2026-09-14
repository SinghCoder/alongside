import { z } from 'zod'

export const MAX_ACTIONS = 12
export const MAX_ITEMS = 30
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)
const text = z.string().min(1).max(160)
const position = { x: z.number().min(30).max(650), y: z.number().min(30).max(600) }
const tone = z.enum(['neutral', 'green', 'amber'])
export const itemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), id, text, ...position, width: z.number().min(100).max(300), height: z.number().min(60).max(150), tone }),
  z.object({ kind: z.literal('text'), id, text, ...position, size: z.number().min(16).max(30) }),
  z.object({ kind: z.literal('arrow'), id, from: id, to: id }),
  z.object({ kind: z.literal('image'), id, assetId: z.string().min(1).max(250),
    src: z.string().regex(/^\/library\/[a-f0-9]{20}\.(svg|png|jpg|jpeg)$/),
    ...position, width: z.number().min(48).max(160), height: z.number().min(48).max(160) }),
])
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('put'), item: itemSchema, caption: text }),
  z.object({ kind: z.literal('remove'), id, caption: text }),
])
export const planSchema = z.object({ answer: z.string().min(1).max(600), actions: z.array(actionSchema).max(MAX_ACTIONS) })
const scenePosition = { x: z.number().min(-5000).max(5000), y: z.number().min(-5000).max(5000) }
const contextItem = z.discriminatedUnion('kind', [
  itemSchema.options[0].extend(scenePosition), itemSchema.options[1].extend(scenePosition), itemSchema.options[2],
  itemSchema.options[3].extend({ ...scenePosition, width: z.number().min(1).max(5000), height: z.number().min(1).max(5000) }),
])
export const requestSchema = z.object({
  question: z.string().trim().min(1).max(1500),
  scene: z.array(contextItem).max(MAX_ITEMS),
  notes: z.array(z.string().max(300)).max(20),
  history: z.array(z.object({ question: z.string().max(1500), answer: z.string().max(600) })).max(6),
})
export type AgentRequest = z.infer<typeof requestSchema>
export type BoardPlan = z.infer<typeof planSchema>
