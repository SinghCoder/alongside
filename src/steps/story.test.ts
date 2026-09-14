import test from 'node:test'
import assert from 'node:assert/strict'
import { lesson, Step } from './story.ts'
import { diagnostics } from '../../server/partner/workspace.ts'
import type { LibraryCatalog } from '../library/types.ts'

const ids = ['agentic-ai-workflows/computer-b1c6ef76', 'agentic-ai-workflows/server-3e567f80', 'agentic-ai-workflows/database-96cbe0f1', 'aws/amazon-elasticache-cb426b9b']
const story = lesson({ assets: ids.map(id => ({ id, src: `/library/${id}.svg` })), packs: [] } as unknown as LibraryCatalog)
const base = story.plan(Step.Request).at(-1)!.scene
const context = base.filter(item => story.contextIds.has(item.id))

test('alternatives extend shared context without erasing or mixing paths', () => {
  for (const step of [Step.Hit, Step.Miss]) {
    let previous: typeof base = context
    for (const shot of story.plan(step, context)) {
      for (const item of previous) { assert.deepEqual(shot.scene.find(next => next.id === item.id), item) }
      previous = shot.scene
    }
  }
  assert.ok(!story.plan(Step.Hit, context).at(-1)!.scene.some(item => item.kind === 'arrow' && item.to === 'db'))
  assert.ok(story.plan(Step.Miss, context).at(-1)!.scene.some(item => item.id === 'fill' && item.kind === 'arrow' && item.from === 'app' && item.to === 'cache'))
})

test('scripted connectors leave component labels readable', () => {
  for (const step of [Step.Request, Step.Hit, Step.Miss]) {
    const scene = story.plan(step, step === Step.Request ? [] : context).at(-1)!.scene
    const bounds = scene.flatMap(item => {
      if (item.kind === 'image') { return [{ id: item.id, x: item.x, y: item.y, width: item.width, height: item.height }] }
      if (item.kind === 'text') { return [{ id: item.id, x: item.x, y: item.y, width: item.text.length * 9, height: 21 }] }
      return []
    })
    assert.deepEqual(diagnostics(scene, bounds).filter(issue => /intersects (browser|app|db|cache)-label/.test(issue)), [])
  }
})
