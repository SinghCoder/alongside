import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request } from 'node:https'

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15000
const MAX_REDIRECTS = 4
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const HTTP_OK = 200
const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) { blocked.addSubnet(address, prefix, 'ipv4') }
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) { blocked.addSubnet(address, prefix, 'ipv6') }
export const publicAddress = (address: string) => !!isIP(address) && !address.toLowerCase().startsWith('::ffff:') && !blocked.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')

// Pin the validated DNS address for each request, including redirects.
export async function fetchImage(source: string, signal: AbortSignal, redirects = 0): Promise<{ bytes: Buffer; format: string; mime: string }> {
  const url = new URL(source)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) { throw new Error('Images require a public HTTPS URL') }
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) { throw new Error('Image host is not public') }
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(url, { signal, lookup: (_host, options, callback) => {
      if (options.all) { callback(null, addresses) }
      else { callback(null, addresses[0].address, addresses[0].family) }
    } }, resolve)
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Image download timed out')))
    req.on('error', reject); req.end()
  })
  if (REDIRECTS.has(response.statusCode ?? 0)) {
    response.destroy()
    if (redirects >= MAX_REDIRECTS || !response.headers.location) { throw new Error('Too many image redirects') }
    return fetchImage(new URL(response.headers.location, url).href, signal, redirects + 1)
  }
  if (response.statusCode !== HTTP_OK) { response.destroy(); throw new Error(`Image host returned HTTP ${response.statusCode}`) }
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of response) {
    size += chunk.length
    if (size > MAX_BYTES) { response.destroy(); throw new Error('Image exceeds 5 MB; choose another result') }
    chunks.push(Buffer.from(chunk))
  }
  const bytes = Buffer.concat(chunks)
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { return { bytes, format: 'png', mime: 'image/png' } }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) { return { bytes, format: 'jpg', mime: 'image/jpeg' } }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') { return { bytes, format: 'webp', mime: 'image/webp' } }
  throw new Error('Expected a PNG, JPEG or WebP image; choose another result')
}
