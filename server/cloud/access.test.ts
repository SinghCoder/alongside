import test from 'node:test'
import assert from 'node:assert/strict'
import { issueCookie, readCookie, acceptsOrigin } from './access.ts'

test('signed sessions reject tampering and expired tokens', () => {
  const secret = 'test-secret'
  const token = issueCookie('user-one', secret, 1000)
  assert.equal(readCookie(token, secret, 999), 'user-one')
  assert.equal(readCookie(token, secret, 1001), null)
  assert.equal(readCookie(token + 'x', secret, 999), null)
  assert.equal(readCookie(token, 'wrong-key', 999), null)
})
test('HTTPS origin is accepted only when configured', () => {
  assert.equal(acceptsOrigin('https://demo.example.com', 'internal:8080', 'https://demo.example.com'), true)
  assert.equal(acceptsOrigin('https://evil.example.com', 'internal:8080', 'https://demo.example.com'), false)
  assert.equal(acceptsOrigin('http://127.0.0.1:5176', '127.0.0.1:5176'), true)
})
