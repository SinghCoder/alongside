import type { Plugin } from 'vite'
import { LocalFileStorage } from '@strands-agents/sdk/storage'
import { IMAGE_DIR } from './partner/images'

const HTTP = { OK: 200, NOT_FOUND: 404, METHOD: 405 } as const
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
export function imagePlugin(): Plugin {
  const storage = new LocalFileStorage(IMAGE_DIR)
  return { name: 'imported-images', configureServer(server) {
    server.middlewares.use('/api/images', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(HTTP.METHOD); res.end(); return }
      const match = req.url?.match(/^\/([a-f0-9]{20}\.(png|jpg|webp))$/)
      const bytes = match ? await storage.read(match[1]).catch(() => null) : null
      if (!bytes || !match) { res.writeHead(HTTP.NOT_FOUND); res.end(); return }
      res.writeHead(HTTP.OK, { 'Content-Type': MIME[match[2]], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' }); res.end(Buffer.from(bytes))
    })
  } }
}
