import { createHmac, timingSafeEqual } from 'node:crypto'

export function sameSecret(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
export function issueCookie(id: string, secret: string, expires: number) {
  const payload = Buffer.from(JSON.stringify({ id, expires })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
export function readCookie(token: string, secret: string, now = Date.now()): string | null {
  try {
    const [payload, signature, extra] = token.split('.')
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    if (extra || !signature || !sameSecret(signature, expected)) { return null }
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof value.id === 'string' && value.expires > now ? value.id : null
  } catch { return null }
}
export function acceptsOrigin(origin: string | undefined, host: string | undefined, configured = process.env.ALONGSIDE_PUBLIC_ORIGIN) {
  return !origin || origin === (configured || `http://${host}`)
}
