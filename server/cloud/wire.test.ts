import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer, WebSocket } from 'ws'
import { once } from 'node:events'
import { wire } from './wire.ts'

test('runtime exchanges nested calls and chunked images before completing', async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const connected = once(server, 'connection')
  const client = new WebSocket(`ws://127.0.0.1:${port}`)
  await once(client, 'open')
  const [socket] = await connected
  const notices: string[] = []
  const local = wire(client, async () => 'ack', value => notices.push(value))
  const remote = wire(socket, async (_method, value) => {
    const reply = await remote.call('draw', {})
    remote.notice(reply)
    return value
  })
  const image = '😀'.repeat(50000)
  assert.equal(await local.call('run', image), image)
  assert.deepEqual(notices, ['ack'])
  client.close(); socket.close(); server.close()
})

test('disconnect rejects awaiting operations', async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const connected = once(server, 'connection')
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`)
  await once(client, 'open')
  const [socket] = await connected
  const local = wire(client, async () => null)
  const result = local.call('run', {})
  socket.close()
  await assert.rejects(result, /connection closed/)
  server.close()
})
