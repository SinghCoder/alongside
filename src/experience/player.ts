import type { FrameClock } from '../pen/player.ts'
import { Part, Playback, type Point, type Stroke, type LetterLine, type EraseArea, DrawingTool } from '../pen/types.ts'
import { drawMotion, movePen, travelTime, writeMotion, eraseMotion } from './motion.ts'
import type { LessonBoard, LessonFrame, Shot } from './types.ts'

const READ_PAUSE_MS = 650
const SETTLE_MS = 120
const FADE_MS = 200
const IMAGE_FADE_MS = 250
const clock: FrameClock = { request: (fn) => requestAnimationFrame(fn), cancel: (id) => cancelAnimationFrame(id) }
enum Phase { Draw, Settle, Erase, Write, Read, Travel }

export function createLessonPlayer(board: LessonBoard, shots: readonly Shot[], publish: (frame: LessonFrame) => void, frames = clock, origin: Point | null = null) {
  let index = 0
  let elapsed = 0
  let state = Playback.Ready
  let phase = origin ? Phase.Travel : Phase.Draw
  let endpoint: Point | null = origin
  let wipes: readonly EraseArea[] = []
  let letters: readonly LetterLine[] = []
  let finished: readonly Stroke[] = []
  let previous: number | null = null
  let ticket = 0
  let disposed = false

  function duration(paths: readonly Stroke[]) {
    const shot = shots[index]
    if (!shot.speed) { return shot.duration }
    return paths.reduce((sum,path) => sum + path.slice(1).reduce((length,point,i) => length + Math.hypot(point.x-path[i].x,point.y-path[i].y),0),0) / shot.speed
  }

  function emit() {
    const shot = shots[index]
    const paths = board.preview(shot)
    const motion = drawMotion(paths ?? [], duration(paths ?? []), elapsed)
    let pen = phase === Phase.Draw ? motion.pen : endpoint
    let strokes = phase === Phase.Draw ? motion.strokes : phase === Phase.Settle ? finished : []
    let lettering: readonly LetterLine[] = []
    let erasures: readonly EraseArea[] = []
    if (phase === Phase.Erase && endpoint) {
      const erasing = eraseMotion(wipes, endpoint, elapsed)
      pen = erasing.pen; erasures = erasing.erasures; strokes = finished
    }
    if (phase === Phase.Write && endpoint) {
      const writing = writeMotion(letters, endpoint, elapsed)
      pen = writing.pen; lettering = writing.lettering; strokes = finished; erasures = wipes
    }
    const placing = board.images?.(shot) ?? []
    const imageOpacity = phase === Phase.Draw ? Math.min(1, elapsed / IMAGE_FADE_MS) : 1
    const images = [Phase.Draw, Phase.Settle, Phase.Erase, Phase.Write].includes(phase) && state !== Playback.Ready && state !== Playback.Done
      ? placing.map(item => ({ ...item, opacity: imageOpacity })) : []
    if (placing.length && phase === Phase.Draw && paths?.every(path => path.length === 1)) {
      pen = null; strokes = []
    }
    let penOpacity = 1
    if (phase === Phase.Travel && endpoint && paths?.[0]) {
      pen = movePen(endpoint, paths[0][0], elapsed / travelTime(endpoint, paths[0][0]))
    }
    if (phase === Phase.Read && index === shots.length - 1) {
      penOpacity = Math.min(1, Math.max(0, 1 - elapsed / FADE_MS))
    }
    if (state === Playback.Ready || state === Playback.Done) { pen = null; strokes = [] }
    publish({ state, blocked: paths === null, part: Part.Note, step: index, caption: shot.caption,
      fills: [Phase.Settle, Phase.Erase, Phase.Write].includes(phase) && state !== Playback.Done ? board.fills?.(shot) : [],
      images, strokes, pen, penOpacity, lettering, erasures, tool: phase === Phase.Erase ? DrawingTool.Eraser : DrawingTool.Pen })
  }

  function tick(time: number) {
    if (disposed) { return }
    const delta = previous === null ? 0 : time - previous
    previous = time
    if (state === Playback.Drawing) {
      const paths = board.preview(shots[index])
      if (paths === null) {
        state = Playback.Paused
      } else {
        elapsed += delta
        if (phase === Phase.Draw) {
          const motion = drawMotion(paths, duration(paths), elapsed)
          if (motion.complete) {
            endpoint = motion.pen; finished = motion.strokes
            phase = Phase.Settle; elapsed = 0
          }
        } else if (phase === Phase.Settle && elapsed >= SETTLE_MS) {
          letters = board.lettering(shots[index])
          wipes = board.erasures(shots[index])

          if (wipes.length) { phase = Phase.Erase; elapsed = 0 }
          else if (letters.length) { phase = Phase.Write; elapsed = 0 }
          else { board.commit(shots[index]); phase = Phase.Read; elapsed = 0 }
        } else if (phase === Phase.Erase && endpoint) {
          const erasing = eraseMotion(wipes, endpoint, elapsed)
          if (erasing.complete) {
            endpoint = erasing.pen; elapsed = 0
            if (letters.length) { phase = Phase.Write }
            else { board.commit(shots[index]); phase = Phase.Read }
          }
        } else if (phase === Phase.Write && endpoint) {
          const writing = writeMotion(letters, endpoint, elapsed)
          if (writing.complete) {
            endpoint = writing.pen
            board.commit(shots[index]); phase = Phase.Read; elapsed = 0
          }
        } else if (phase === Phase.Read && elapsed >= (index === shots.length - 1 ? FADE_MS : READ_PAUSE_MS)) {
          if (index === shots.length - 1) { state = Playback.Done }
          else { index++; phase = Phase.Travel; elapsed = 0 }
        } else if (phase === Phase.Travel && endpoint && paths[0] && elapsed >= travelTime(endpoint, paths[0][0])) {
          phase = Phase.Draw; elapsed = 0
        }
      }
    }
    emit()
    if (state !== Playback.Done) { ticket = frames.request(tick) }
  }

  function start() {
    if (disposed || state === Playback.Done || board.preview(shots[index]) === null) { return }
    state = Playback.Drawing
    previous = null
    emit()
  }
  function pause() {
    if (state !== Playback.Drawing) { return }
    state = Playback.Paused
    emit()
  }
  ticket = frames.request(tick)
  return { start, pause, endpoint: () => endpoint, dispose() { disposed = true; frames.cancel(ticket) } }
}
