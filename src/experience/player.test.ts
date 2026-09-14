import assert from 'node:assert/strict'
import test from 'node:test'
import { createLessonPlayer } from './player.ts'
import { drawMotion } from './motion.ts'
import { Playback, DrawingTool } from '../pen/types.ts'
import type { FrameClock } from '../pen/player.ts'
import type { LessonBoard, LessonFrame, Shot } from './types.ts'

function setup() {
  let tick: ((time: number) => void) | null = null
  let time = 0
  let missing = false
  let moved = 0
  let frame: LessonFrame | undefined
  const commits: string[] = []
  const history: LessonFrame[] = []
  const clock: FrameClock = { request(fn) { tick = fn; return 1 }, cancel() { tick = null } }
  const shots: Shot[] = ['first', 'second'].map((focus) => ({ focus, scene: [], caption: focus, duration: 1000 }))
  const board: LessonBoard = {
    snapshot: () => ({ scene: [], notes: [] }),
    preview: (shot) => missing ? null : [[{ x: moved, y: shot.focus === 'first' ? 0 : 200 }, { x: moved + 100, y: shot.focus === 'first' ? 0 : 200 }]],
    lettering: () => [],
    erasures: () => [],
    commit: (shot) => { commits.push(shot.focus) },
    screen: (point) => point, ink: () => ({ color: 'green', width: 2 }), fit() {},
  }
  const player = createLessonPlayer(board, shots, (next) => { frame = next; history.push(next) }, clock)
  function advance(amount: number) {
    const end = time + amount
    while (time < end) { time = Math.min(end, time + 16); tick?.(time) }
  }
  return { board, player, advance, commits, history, frame: () => frame!, remove: () => { missing = true }, restore: () => { missing = false }, move: () => { moved = 80 } }
}

test('interruption preserves progress and uses edited geometry on resume', () => {
  const h = setup()
  h.player.start(); h.advance(500); h.player.pause()
  const before = h.frame().strokes
  h.advance(3000)
  assert.deepEqual(h.frame().strokes, before)
  assert.equal(h.commits.length, 0)
  h.move(); h.advance(16)
  assert.equal(h.frame().strokes[0][0].x, 80)
  h.player.start(); h.advance(3000)
  assert.deepEqual(h.commits, ['first', 'second'])
  assert.equal(h.frame().state, Playback.Done)
})

test('missing objects block mutations until restored', () => {
  const h = setup()
  h.player.start(); h.advance(500); h.remove(); h.advance(2000)
  assert.equal(h.frame().state, Playback.Paused)
  assert.equal(h.frame().blocked, true)
  assert.equal(h.commits.length, 0)
  h.player.start(); h.advance(2000)
  assert.equal(h.commits.length, 0)
  h.restore(); h.player.start(); h.advance(3000)
  assert.deepEqual(h.commits, ['first', 'second'])
})

test('replacing a lesson cancels all pending contributions', () => {
  const h = setup()
  h.player.start(); h.advance(500); h.player.dispose(); h.advance(5000)
  assert.equal(h.commits.length, 0)
})

test('the pen stays visible at commit and travels between contributions', () => {
  const h = setup()
  h.player.start(); h.advance(3500)
  const frames = h.history.filter((frame) => frame.state === Playback.Drawing)
  assert.ok(frames.every((frame) => frame.pen !== null), 'Pen disappears between contributions')
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1].pen!
    const after = frames[index].pen!
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 30, 'Pen teleports at handoff')
  }
  assert.deepEqual(h.commits, ['first', 'second'])
})

test('pausing during pen-up travel freezes the nib without adding ink', () => {
  const h = setup()
  h.player.start(); h.advance(1900); h.player.pause()
  const before = h.frame()
  assert.equal(before.strokes.length, 0)
  assert.ok(before.pen!.y > 0 && before.pen!.y < 200)
  h.advance(1000)
  assert.deepEqual(h.frame().pen, before.pen)
  h.player.start(); h.advance(4000)
  assert.deepEqual(h.commits, ['first', 'second'])
})

test('separate strokes have continuous pen-up travel without connecting ink', () => {
  const paths = [[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 1000, y: 0 }, { x: 1100, y: 0 }]]
  const frame = drawMotion(paths, 1000, 700)
  assert.ok(frame.pen!.x > 100 && frame.pen!.x < 1000)
  assert.deepEqual(frame.strokes, [paths[0]])
  assert.equal(frame.complete, false)
  assert.equal(drawMotion(paths, 1000, 2000).complete, true)
})

test('lettering pauses before committing and becomes native only when complete', () => {
  const h = setup()
  const text = 'A request for the last seat'
  h.board.lettering = () => [{ x: 100, y: 0, size: 18, color: 'green', text,
    advances: Array.from({ length: text.length + 1 }, (_, index) => index * 9) }]
  h.player.start(); h.advance(1500); h.player.pause()
  const letters = h.frame().lettering!
  assert.ok(letters[0].text.length > 0 && letters[0].text.length < text.length)
  assert.equal(h.commits.length, 0)
  h.advance(1000)
  assert.deepEqual(h.frame().lettering, letters)
  h.player.start(); h.advance(6000)
  assert.deepEqual(h.commits, ['first', 'second'])
  assert.equal(h.frame().state, Playback.Done)
})

test('eraser pauses without committing and writes only after wiping', () => {
  const h = setup()
  h.board.erasures = () => [{ x: 100, y: 0, width: 200, height: 20, color: 'white' }]
  h.board.lettering = () => [{ x: 100, y: 0, size: 18, color: 'green', text: 'New', advances: [0, 9, 18, 27] }]
  h.player.start(); h.advance(1450); h.player.pause()
  assert.equal(h.frame().tool, DrawingTool.Eraser)
  assert.ok(h.frame().erasures![0].width > 0 && h.frame().erasures![0].width < 200)
  assert.equal(h.frame().lettering!.length, 0)
  const wipes = h.frame().erasures
  h.advance(1000)
  assert.deepEqual(h.frame().erasures, wipes)
  assert.equal(h.commits.length, 0)
  h.player.start(); h.advance(6000)
  assert.deepEqual(h.commits, ['first', 'second'])
})

test('images fade without pen ink and freeze when paused', () => {
  const h = setup()
  const icon = { id: 'icon', src: '/library/icon.svg', x: 40, y: 40, width: 64, height: 64 }
  Object.assign(h.board, { images: () => [icon] })
  h.board.preview = () => [[{ x: 40, y: 40 }]]
  h.player.start(); h.advance(120); h.player.pause()
  const frame = h.frame() as LessonFrame & { images?: { opacity: number }[] }
  assert.ok(frame.images?.length, 'Missing image reveal')
  assert.ok(frame.images[0].opacity > 0 && frame.images[0].opacity < 1)
  assert.equal(frame.pen, null)
  assert.equal(frame.strokes.length, 0)
  h.advance(1000)
  assert.deepEqual((h.frame() as typeof frame).images, frame.images)
  h.player.start(); h.advance(6000)
  assert.deepEqual(h.commits, ['first', 'second'])
})

test('background geometry is revealed before white text starts writing', () => {
  const run = setup()
  run.board.fills = () => [{points:[{x:0,y:0}],color:'#173d30'}]
  run.board.lettering = () => [{x:0,y:0,text:'White text',size:20,color:'#ffffff',advances:[0,10,20,30,40,50,60,70,80,90,100]}]
  run.player.start()
  run.advance(1200)
  assert.equal(run.frame().fills?.[0].color,'#173d30')
})

test('a later contribution starts at the previous pen endpoint', () => {
  const run=setup()
  let frame: LessonFrame | undefined
  const origin={x:300,y:300}
  const player=createLessonPlayer(run.board,[{scene:[],focus:'first',caption:'next',duration:1000}],next=>{frame=next},{request:()=>1,cancel(){}},origin)
  player.start()
  assert.deepEqual(frame?.pen,origin)
  player.dispose()
})
