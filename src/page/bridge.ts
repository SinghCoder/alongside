export type PageOperation = { type: 'snapshot' } | { type: 'evaluate'; code: string }
export type PageContext = { url: string; title: string; kind: string; capturedAt: string; selection: string; text: string; video?: { currentTime: number | null; transcriptSource: string; notice?: string | null }; [key: string]: unknown }
const WAIT_MS = 15000

export function readPage(binding: string, operation: PageOperation): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const stop = () => { clearTimeout(timer); window.removeEventListener('message', receive) }
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'alongside:response' || event.data.id !== id) { return }
      stop()
      if (event.data.error) { reject(new Error(event.data.error)); return }
      resolve(event.data.value)
    }
    const timer = setTimeout(() => { stop(); reject(new Error('Extension unavailable. Open this lesson through Alongside in Chrome.')) }, WAIT_MS)
    window.addEventListener('message', receive)
    window.postMessage({channel:'alongside:request',id,binding,operation},location.origin)
  })
}
