import { createServer } from 'node:http'
import connect from 'connect'
import { partnerPlugin } from '../partner/plugin'
import { imagePlugin } from '../image-plugin'
import { libraryPlugin } from '../library'

// Mount the same API handlers used locally, without starting a development server.
const app = connect()
for (const plugin of [partnerPlugin(), imagePlugin(), libraryPlugin()]) {
  const setup = plugin.configureServer
  if (typeof setup === 'function') { (setup as Function)({ middlewares: app }) }
}
const server = createServer(app)
server.listen(0, '127.0.0.1', () => process.send?.({ port: (server.address() as { port: number }).port }))
