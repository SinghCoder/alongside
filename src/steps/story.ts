import type { BoardItem, BoardScene } from '../board/types'
import type { Shot } from '../experience/types'
import type { LibraryCatalog } from '../library/types'

export enum Step { Request, Hit, Miss }
export const TITLES = ['The request', 'Cache hit', 'Cache miss'] as const
export const PROMPTS = [
  'Follow one product request from the browser to the database.',
  'Same system. This time, the cache already has the product.',
  'An alternative: the cache is empty. Where does the product come from?',
] as const
const DRAW_MS = 1000
const ICON_SIZE = 60
const ASSETS = {
  browser: 'agentic-ai-workflows/computer-b1c6ef76',
  app: 'agentic-ai-workflows/server-3e567f80',
  db: 'agentic-ai-workflows/database-96cbe0f1',
  cache: 'aws/amazon-elasticache-cb426b9b',
} as const
const text = (id: string, value: string, x: number, y: number): BoardItem => ({ kind: 'text', id, text: value, x, y, size: 18 })
const link = (id: string, from: string, to: string): Extract<BoardItem, { kind: 'arrow' }> => ({ kind: 'arrow', id, from, to })

export function lesson(catalog: LibraryCatalog) {
  function icon(id: keyof typeof ASSETS, x: number, y: number): BoardItem {
    const asset = catalog.assets.find(item => item.id === ASSETS[id])
    if (!asset) { throw new Error(`Missing asset: ${ASSETS[id]}`) }
    return { kind: 'image', id, assetId: asset.id, src: asset.src, x, y, width: ICON_SIZE, height: ICON_SIZE, group: id }
  }
  const images = [icon('browser', 65, 270), icon('app', 330, 270), icon('db', 655, 440), icon('cache', 655, 115)]
  const labels = [text('browser-label', 'Browser', 61, 345), text('app-label', 'Web app', 325, 345), text('db-label', 'Database', 643, 515), text('cache-label', 'Cache', 659, 190)]
  const components = images.map((image, index) => [image, { ...labels[index], group: image.id }])
  const contextIds = new Set(['browser', 'browser-label', 'app', 'app-label', 'db', 'db-label', 'request', 'request-label'])

  function plan(step: Step, seed: BoardScene = []): Shot[] {
    let scene = [...seed]
    const shots: Shot[] = []
    function add(items: BoardItem[], caption: string) {
      scene = [...scene, ...items]
      shots.push({ scene, focus: items[0].id, caption, duration: DRAW_MS })
    }
    if (step === Step.Request) {
      add([...components[0], ...components[1]], 'The browser asks the web app for product 42.')
      add([link('request', 'browser', 'app'), text('request-label', 'GET /products/42', 155, 250)], 'The URL tells the app which product to fetch.')
      add(components[2], 'The database holds the product record: its name, price and image.')
      add([{ ...link('read', 'app', 'db'), fromAnchor: 'right', toAnchor: 'left', via: [{ x: 470, y: 470 }] }, text('read-label', 'Read product 42', 490, 440)], 'The app reads the record, then sends the product details back to the browser. Keep this diagram as our starting point.')
      return shots
    }
    add(components[3], 'A cache keeps a temporary copy. The app checks it before reading the database.')
    add([{ ...link('lookup', 'app', 'cache'), fromAnchor: 'top', toAnchor: 'left', via: [{ x: 360, y: 145 }] }, text('lookup-label', '1  Check product:42', 420, 112)], 'First, look up product:42 in the cache.')
    if (step === Step.Hit) {
      add([text('hit', 'Found → return to browser', 420, 225)], 'Cache hit: the app uses the cached product. The database is not queried. Next we’ll keep this view and explore a miss separately.')
      return shots
    }
    add([{ ...link('miss-read', 'app', 'db'), fromAnchor: 'right', toAnchor: 'left', via: [{ x: 470, y: 470 }] }, text('miss-label', '2  Read database', 490, 440)], 'Cache miss: the app reads the current product from the database.')
    add([{ ...link('fill', 'app', 'cache'), fromAnchor: 'right', toAnchor: 'right', via: [{ x: 775, y: 300 }, { x: 775, y: 145 }] }, text('fill-label', '3  Save copy + expiry', 425, 325)], 'After receiving the record, the app stores a copy with an expiry and returns the product to the browser. A later request can be a hit.')
    return shots
  }
  return { images, plan, contextIds }
}
