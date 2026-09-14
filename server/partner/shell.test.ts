import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { shellWorkspace } from './shell.ts'

// Opt-in integration test: requires the built lesson image and a container daemon.
test('shell isolates host access and composes persistent files with board calls', { skip: !process.env.RUN_SHELL_TESTS }, async () => {
  const operations: string[] = []
  const shell = await shellWorkspace(randomUUID(), async (method, value) => {
    operations.push(method)
    if (method === 'help') { return '{}' }
    return { method, value }
  }, () => {})
  const signal = AbortSignal.timeout(60000)
  try {
    const first = await shell.exec(`python3 - <<'PY'
from PIL import Image
Image.new('RGB',(200,100),'red').save('original.png')
Image.open('original.png').crop((10,10,80,60)).save('crop.png')
PY
node --input-type=module - <<'JS'
import {board,view} from '/opt/lesson/board.mjs';
console.log(await board.snapshot());
await view('crop.png');
JS`, signal)
    assert.equal(first.exitCode, 0, first.stderr)
    assert.match(first.stdout, /snapshot/)
    const [crop] = shell.takeImages()
    assert.equal(crop.readUInt32BE(16), 70)
    assert.equal(crop.readUInt32BE(20), 50)
    const next = await shell.exec(`test -f crop.png && test ! -e /Users && test -z "$OPENAI_API_KEY" && test ! -e /var/run/docker.sock && python3 - <<'PY'
import socket
try:
 socket.create_connection(('1.1.1.1',443),timeout=1)
 raise AssertionError('Network unexpectedly accessible')
except OSError:
 print('isolated; files persist')
PY`, signal)
    assert.equal(next.exitCode, 0, next.stderr)
    assert.match(next.stdout, /files persist/)
  } finally { await shell.close(); await rm(shell.directory, { recursive: true, force: true }) }
})

test('shell keeps SDK read-only and cancellation stops execution', { skip: !process.env.RUN_SHELL_TESTS }, async () => {
  const shell = await shellWorkspace(randomUUID(), async () => '{}', () => {})
  try {
    const result = await shell.exec(`if echo damaged > /opt/lesson/board.mjs 2>/dev/null; then exit 1; fi
node --input-type=module -e "import('/opt/lesson/board.mjs').then(m => console.log(typeof m.board.draw))"`, AbortSignal.timeout(10000))
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(result.stdout, /function/)
    await assert.rejects(shell.exec('sleep 30', AbortSignal.timeout(1000)), /abort|timeout/i)
  } finally { await shell.close(); await rm(shell.directory, { recursive: true, force: true }) }
})
