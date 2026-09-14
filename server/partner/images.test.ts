import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageSearch, imageCatalog } from './images.ts'
import { fetchImage, publicAddress } from './image-fetch.ts'
import { workspace } from './workspace.ts'
import { interpret } from './interpreter.ts'

test('Brave metadata imports into an editable, restorable board image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-images-'))
  const signal = new AbortController().signal
  try {
    const service = imageSearch(signal, { directory, keys: { brave: 'test-key' }, fetch: async (url, init) => {
      assert.equal(new URL(String(url)).hostname, 'api.search.brave.com')
      assert.equal((init?.headers as Record<string, string>)['X-Subscription-Token'], 'test-key')
      return Response.json({ results: [{ title: 'Heart', url: 'https://example.com/heart', properties: { url: 'https://example.com/heart.png', width: 300, height: 400 } }] })
    }, download: async () => ({ bytes: Buffer.from('test image'), format: 'png', mime: 'image/png' }) })
    const results = await service.search({ query: 'heart' })
    const imported = await service.use(results.results[0].id)
    assert.match(imported.src, /^\/api\/images\/[a-f0-9]{20}\.png$/)
    const catalog = { version: 1, packs: [], assets: await imageCatalog(directory) }
    const scene = [{ kind: 'image' as const, id: 'heart', assetId: imported.assetId, src: imported.src, x: 100, y: 100, width: 240, height: 320 }]
    const work = workspace({ scene, notes: [] }, catalog, async () => { throw new Error('No browser needed') }, service)
    const restored = await work.call('snapshot', null) as { scene: typeof scene }
    assert.deepEqual(restored.scene, scene)
    await assert.rejects(work.call('put', { ...scene[0], src: '/api/images/00000000000000000000.png' }), /valid catalog asset/)
    const schema = await interpret("return JSON.parse(help('schemas/images.json')).properties.provider", work.call, signal)
    assert.ok(schema)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('automatic fallback normalizes SerpApi and does not leak provider errors', async () => {
  const calls: string[] = []
  const service = imageSearch(new AbortController().signal, { keys: { brave: 'brave-secret', serpapi: 'serp-secret' }, fetch: async url => {
    const target = new URL(String(url)); calls.push(target.hostname)
    if (target.hostname === 'api.search.brave.com') { return new Response('brave-secret', { status: 429 }) }
    assert.equal(target.searchParams.get('engine'), 'google_images')
    return Response.json({ images_results: [{ title: 'Reference', original: 'https://example.com/photo.jpg', link: 'https://example.com/page', original_width: 800, original_height: 600 }] })
  } })
  const result = await service.search({ query: 'reference' })
  assert.deepEqual(calls, ['api.search.brave.com', 'serpapi.com'])
  assert.equal(result.provider, 'serpapi'); assert.equal(result.results[0].width, 800)
  assert.deepEqual(result.notes, ['brave: HTTP 429', 'searchapi: key not configured'])
  await assert.rejects(service.use('00000000000000000000'), /ID from images.search/)
})

test('missing keys fail explicitly and private image destinations are blocked', async () => {
  const service = imageSearch(new AbortController().signal, { keys: {}, fetch: async () => { throw new Error('Network should not run') } })
  await assert.rejects(service.search({ query: 'heart' }), /key not configured/)
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) { assert.equal(publicAddress(address), false, address) }
  assert.equal(publicAddress('8.8.8.8'), true)
  await assert.rejects(fetchImage('https://127.0.0.1/secret', new AbortController().signal), /not public/)
})


test('SearchApi.io uses its own endpoint and nested original image metadata', async () => {
  const service = imageSearch(new AbortController().signal, { keys: { searchapi: 'test-searchapi-key' }, fetch: async url => {
    const target = new URL(String(url))
    assert.equal(target.origin + target.pathname, 'https://www.searchapi.io/api/v1/search')
    assert.equal(target.searchParams.get('api_key'), 'test-searchapi-key')
    return Response.json({ images: [{ title: 'Eclipse', original: { link: 'https://example.com/eclipse.jpg', width: 1600, height: 900 }, source: { link: 'https://example.com/page' }, thumbnail: null }] })
  } })
  const result = await service.search({ query: 'eclipse', provider: 'searchapi' })
  assert.equal(result.results[0].url, 'https://example.com/eclipse.jpg')
  assert.equal(result.results[0].width, 1600)
  assert.equal(result.results[0].sourceUrl, 'https://example.com/page')
})
