import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStreamEvent } from '@strands-agents/sdk'
import { activityFeed, debugValue } from './activity.ts'
import { mergeActivity, type Activity } from '../../src/partner/activity.ts'

test('activity pairs calls and results, preserving inputs and reporting errors', async () => {
  let items: Activity[] = []
  const feed = activityFeed(item => { items = mergeActivity(items, JSON.parse(JSON.stringify(item))) })
  await feed.operation('images.search', { query: 'heart' }, async () => ({ results: ['heart'] }))
  assert.equal(items.length, 1); assert.equal(items[0].status, 'done')
  assert.deepEqual(items[0].input, { query: 'heart' }); assert.deepEqual(items[0].output, { results: ['heart'] })
  await assert.rejects(feed.operation('images.use', 'missing', async () => { throw new Error('Unknown image') }))
  assert.equal(items[1].status, 'error')
})

test('public summaries stream separately from messages; signatures are excluded', () => {
  let items: Activity[] = []
  const feed = activityFeed(item => { items = mergeActivity(items, item) })
  for (const text of ['Review ', 'the image.']) {
    feed.watch({ type: 'modelStreamUpdateEvent', event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'reasoningContentDelta', text, signature: 'never-show' } } } as AgentStreamEvent)
  }
  assert.equal(items[0].text, 'Review the image.'); assert.equal(items[0].kind, 'summary')
  assert.doesNotMatch(JSON.stringify(items), /never-show/)
  assert.deepEqual(debugValue({ api_key: 'secret', image: new Uint8Array([1, 2]), data: 'data:image/png;base64,aGVsbG8=' }), { api_key: '[omitted]', image: '[binary: 2 bytes]', data: '[image data omitted]' })
})
