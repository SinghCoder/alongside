import { MAX_ITEMS, type AgentRequest, type BoardPlan } from './schema.ts'
import type { BoardScene } from '../board/types.ts'
import { placeItem } from './layout.ts'
import type { Shot } from '../experience/types.ts'

const DRAW_MS = 1000
const TEXT_MS = 120

export function buildShots(input: AgentRequest['scene'], plan: BoardPlan): Shot[] {
  const scene = new Map(input.map((item) => [item.id, item]))
  if (scene.size !== input.length) { throw new Error('Duplicate board IDs') }
  const shots: Shot[] = []
  for (const action of plan.actions) {
    const focus = action.kind === 'put' ? action.item.id : action.id
    if (action.kind === 'remove') {
      if (!scene.has(action.id)) { throw new Error('Cannot remove an unknown object') }
      scene.delete(action.id)
      for (const [id, item] of scene) {
        if (item.kind === 'arrow' && [item.from, item.to].includes(action.id)) { scene.delete(id) }
      }
    } else {
      const old = scene.get(action.item.id)
      if (old && old.kind !== action.item.kind) { throw new Error('Cannot change an object type') }
      const item = old && 'x' in old && 'x' in action.item
        ? { ...action.item, x: old.x, y: old.y, ...('width' in old ? { width: old.width, height: old.height } : {}) }
        : placeItem(action.item, scene.values())
      scene.set(item.id, item)
    }
    if (scene.size > MAX_ITEMS) { throw new Error('Board is full; revise existing objects') }
    for (const item of scene.values()) {
      if (item.kind === 'arrow' && (!['node', 'image'].includes(scene.get(item.from)?.kind ?? '') || !['node', 'image'].includes(scene.get(item.to)?.kind ?? ''))) {
        throw new Error('Connections require two existing nodes or images')
      }
    }
    shots.push({ scene: [...scene.values()] as BoardScene, focus, caption: action.caption,
      duration: action.kind === 'put' && action.item.kind === 'text' ? TEXT_MS : DRAW_MS })
  }
  return shots
}
