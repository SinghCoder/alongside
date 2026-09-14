import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('hosted API isolates two signed browser sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alongside-cloud-test-'))
  const child = fork(resolve('server/cloud/gateway.ts'), [], { execArgv: ['--import', 'tsx'], env: { ...process.env,
    ALONGSIDE_PORT: '0', ALONGSIDE_DATA_DIR: directory, ALONGSIDE_COOKIE_SECRET: 'cookie-test', ALONGSIDE_ACCESS_CODE: 'demo-test', ALONGSIDE_ORIGIN_SECRET: 'origin-test', ALONGSIDE_PUBLIC_ORIGIN: 'https://demo.example.com' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  try {
    const [{ port }] = await once(child, 'message')
    const url = `http://127.0.0.1:${port}`
    const headers = { 'x-alongside-origin': 'origin-test', origin: 'https://demo.example.com', 'Content-Type': 'application/json' }
    assert.equal((await fetch(url + '/api/lessons/', { headers })).status, 401)
    assert.equal((await fetch(url + '/api/auth', { headers: { ...headers, origin: 'https://evil.example.com' } })).status, 403)
    async function login() {
      const response = await fetch(url + '/api/auth', { method: 'POST', headers, body: JSON.stringify({ code: 'demo-test' }) })
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie')!.split(';')[0]
    }
    const a = await login(), b = await login()
    assert.notEqual(a, b)
    const created = await fetch(url + '/api/lessons/', { method: 'POST', headers: { ...headers, cookie: a } })
    assert.equal(created.status, 200)
    const lesson = await created.json() as { id: string }
    assert.equal((await fetch(url + '/api/lessons/' + lesson.id, { headers: { ...headers, cookie: a } })).status, 200)
    assert.equal((await fetch(url + '/api/lessons/' + lesson.id, { headers: { ...headers, cookie: b } })).status, 400)
    assert.deepEqual(await (await fetch(url + '/api/lessons/', { headers: { ...headers, cookie: b } })).json(), [])
  } finally { child.kill(); await once(child, 'exit'); await rm(directory, { recursive: true, force: true }) }
})
