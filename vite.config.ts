import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { libraryPlugin } from './server/library'
import { agentPlugin } from './server/plugin'
import { imagePlugin } from './server/image-plugin'
import { partnerPlugin } from './server/partner/plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'BRAVE_SEARCH_API_KEY', 'BRAVE_API_KEY', 'SEARCHAPI_API_KEY', 'SERPAPI_API_KEY', 'SERPAPI_KEY', 'ALONGSIDE_HARNESS', 'ALONGSIDE_DATA_DIR', 'ALONGSIDE_CONTAINER_CLI']) {
    if (!process.env[key] && env[key]) { process.env[key] = env[key] }
  }
  return {
  plugins: [react(), tailwindcss(), agentPlugin(), partnerPlugin(), imagePlugin(), libraryPlugin()],
  server: { host: '127.0.0.1' },
  }
})
