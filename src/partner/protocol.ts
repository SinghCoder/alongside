import { MAX_STEPS, type DocumentOp, type documentInfo } from '../board/steps.ts'
import type { PageOperation } from '../page/bridge'
import type { Activity } from './activity'
import type { BoardDocument, BoardSnapshot } from '../board/document'
import { z } from 'zod'
import { itemSchema } from '../agent/schema.ts'
import { CAPTURE_SIZE, Tone, type BoardScene } from '../board/types.ts'
import type { Shot } from '../experience/types.ts'

export const MAX_OBJECTS = 300
export const MAX_CAPTURE_CHARS = 3 * 1024 * 1024
const group = { group: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).optional() }
const coordinate = z.number().finite().min(-5000).max(5000)
const position = { x: coordinate, y: coordinate }
const extent = z.number().min(1).max(5000)
const nativeExtent = z.number().min(0).max(5000)
const point = z.object(position)
const side = z.enum(['left', 'right', 'top', 'bottom'])
export const objectSchema = z.discriminatedUnion('kind', [
  z.object({ ...group, kind: z.literal('native'), id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), ...position, width: nativeExtent, height: nativeExtent,
    element: z.object({ type: z.enum(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'freedraw']) }).passthrough() }),
  itemSchema.options[0].extend({ ...group, ...position, width: extent, height: extent, tone: z.enum(Tone) }),
  itemSchema.options[1].extend({ ...group, ...position }),
  itemSchema.options[2].extend({ ...group, fromAnchor: side.optional(), toAnchor: side.optional(), via: z.array(point).max(20).optional() }),
  itemSchema.options[3].extend({ ...group, ...position, width: extent, height: extent, src: z.string().regex(/^(\/library\/[a-f0-9]{20}\.(svg|png|jpg|jpeg)|\/api\/images\/[a-f0-9]{20}\.(png|jpg|webp))$/) }),
  z.object({ ...group, kind: z.literal('path'), id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), ...position, points: z.array(point).min(2).max(300) }),
])
export const captureSchema = z.object({ data: z.string().max(MAX_CAPTURE_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/), width: z.number().int().positive().max(CAPTURE_SIZE), height: z.number().int().positive().max(CAPTURE_SIZE) })
export type Capture = z.infer<typeof captureSchema>
export const snapshotSchema = z.object({
  userMovedIds: z.array(z.string()).max(MAX_OBJECTS).optional(),
  annotations: z.array(z.record(z.string(), z.unknown())).optional(),
  scene: z.array(objectSchema).max(MAX_OBJECTS), notes: z.array(z.string().max(300)).max(20),
})
export const pageOperationSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('snapshot') }), z.object({ type: z.literal('evaluate'), code: z.string().min(1).max(16000) })])
const pageContextSchema = z.object({ url: z.string().url(), title: z.string(), kind: z.string(), capturedAt: z.string() }).passthrough()
export const inputSchema = z.object({ pageContext: pageContextSchema.optional(), lessonId: z.string().uuid(), turnId: z.string().uuid(), revision: z.number().int().nonnegative(), question: z.string().trim().min(1).max(1500) })
export type Snapshot = BoardSnapshot
export type PartnerInput = z.infer<typeof inputSchema>
const pageSchema = z.object({
  snapshot: snapshotSchema,
  elements: z.array(z.record(z.string(), z.unknown())).max(10000),
  files: z.record(z.string(), z.unknown()),
  viewport: z.object({ scrollX: z.number().finite(), scrollY: z.number().finite(), zoom: z.object({ value: z.number().positive().max(30) }) }).optional(),
})
const stepId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)
const stepTitle = z.string().trim().min(1).max(120)
export const documentOpSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('read'), id: stepId }),
  z.object({ action: z.literal('open'), id: stepId }),
  z.object({ action: z.literal('create'), id: stepId, title: stepTitle }),
  z.object({ action: z.literal('copy'), id: stepId, title: stepTitle, from: stepId.optional() }),
  z.object({ action: z.literal('rename'), id: stepId, title: stepTitle }),
])
export const documentSchema = pageSchema.extend({ steps: z.object({ activeId: stepId, pages: z.array(z.object({ id: stepId, title: stepTitle, parentId: stepId.optional(), board: pageSchema })).min(1).max(MAX_STEPS) }).optional() }).superRefine((document, ctx) => {
  if (!document.steps) { return }
  const { pages, activeId } = document.steps
  const active = pages.find(page => page.id === activeId)
  if (!active || new Set(pages.map(page => page.id)).size !== pages.length) { ctx.addIssue({ code: 'custom', message: 'Invalid active step or duplicate step IDs' }); return }
  const { steps: _steps, ...page } = document
  if (JSON.stringify(page) !== JSON.stringify(active.board)) { ctx.addIssue({ code: 'custom', message: 'Active step must match the visible board' }) }
})
const documentInfoSchema = z.object({ activeId: stepId, pages: z.array(z.object({ id: stepId, title: stepTitle, parentId: stepId.optional(), objects: z.number().int().nonnegative() })), page: z.object({ id: stepId, title: stepTitle, snapshot: snapshotSchema }).optional() })
export type LessonSummary = { id: string; title: string; updatedAt: number; interrupted: boolean }
export type LessonRecord = { activity?: Activity[]; title?: string; id: string; revision: number; document: BoardDocument; answer: string; interrupted: boolean }
export type Measurement = { id: string; x: number; y: number; width: number; height: number }
export type Command = { type: 'page'; operation: PageOperation } | { type: 'document'; operation: DocumentOp; before: BoardScene } | { type: 'viewport'; scene: import('../board/types').BoardScene; options: { fitToContent?: boolean; animate?: boolean; viewportZoomFactor?: number } } | { type: 'present'; before: BoardScene; shot: Shot } | { type: 'inspect'; scene: BoardScene } | { type: 'capture'; scene: BoardScene; before: BoardScene }
export type Reply = Snapshot & { pageResult?: unknown; pageError?: string; document?: ReturnType<typeof documentInfo>; status: 'ok' | 'stale'; bounds: Measurement[]; image?: Capture }
export type Event = { type: 'heartbeat' } | { type: 'activity'; item: Activity } | { type: 'hello'; runId: string } | (Command & { id: number }) |
  { type: 'done'; answer: string; skills: readonly string[]; audit?: { executions: number; operations: string[] } } | { type: 'error'; message: string }
export const replySchema = snapshotSchema.extend({ pageResult: z.unknown().optional(), pageError: z.string().optional(), document: documentInfoSchema.optional(), image: captureSchema.optional(), status: z.enum(['ok', 'stale']), bounds: z.array(z.object({ id: z.string(), ...position, width: z.number(), height: z.number() })).max(MAX_OBJECTS * 2) })
