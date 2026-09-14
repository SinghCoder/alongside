import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowCounterClockwise, ArrowsOut, Pause, Play, PencilLine } from '@phosphor-icons/react'
import PenOverlay, { type PenOverlayHandle } from '../pen/PenOverlay'
import { Playback } from '../pen/types'
import { createLessonPlayer } from '../experience/player'
import type { LessonBoard, LessonFrame, Shot } from '../experience/types'
import { changeStep, documentInfo, savePage, withSteps, type DocumentOp } from '../board/steps'
import type { BoardDocument } from '../board/document'
import { readPage, type PageContext } from '../page/bridge'
import LessonsPanel from './LessonsPanel'
import ActivityPanel from './ActivityPanel'
import { mergeActivity, type Activity } from './activity'
import { askPartner } from './client'
import { lessonClient, openLesson } from './lessons'
import type { LessonRecord, Reply } from './protocol'

const Board = lazy(() => import('../experience/Board'))
const INITIAL = { state: Playback.Ready, caption: '', step: 0, blocked: false }
const ignoreSelection = () => {}
enum RequestState { Idle, Thinking }

export default function PartnerBoard() {
  const [record, setRecord] = useState<LessonRecord | null>(null)
  const [error, setError] = useState('')
  const loading = useRef<Promise<LessonRecord> | null>(null)
  useEffect(() => {
    let mounted = true
    loading.current ??= openLesson(new URLSearchParams(location.search).get('lesson'))
    loading.current.then(value => {
      if (!mounted) { return }
      const url = new URL(location.href); url.searchParams.set('lesson', value.id)
      window.history.replaceState(null, '', url); setRecord(value)
    }).catch(reason => { if (mounted) { setError(String(reason)) } })
    return () => { mounted = false }
  }, [])
  if (error) { return <p role="alert" className="p-8">{error}</p> }
  if (!record) { return <p className="p-8">Opening your lesson…</p> }
  return <Lesson key={record.id} record={record} />
}

function Lesson({ record }: { record: LessonRecord }) {
  const binding = useMemo(() => new URLSearchParams(location.search).get('source'), [])
  const [source, setSource] = useState<PageContext | null>(null)
  const [sourceError, setSourceError] = useState('')
  const refreshSource = useCallback(async () => {
    if (!binding) { return undefined }
    try { const context = await readPage(binding, { type: 'snapshot' }) as PageContext; setSource(context); setSourceError(''); return context }
    catch (error) { const message = String(error); setSourceError(message); throw error }
  }, [binding])
  useEffect(() => { void refreshSource().catch(() => {}) }, [refreshSource])
  const [activity, setActivity] = useState<Activity[]>(record.activity ?? [])
  const [lessons, setLessons] = useState(false)
  const [debug, setDebug] = useState(Boolean(binding))
  useEffect(() => {
    if (!binding) { return }
    const openActivity = (event: MessageEvent) => {
      if (event.source === window.parent && event.data?.type === 'alongside:open-activity') { setDebug(true) }
    }
    window.addEventListener('message', openActivity)
    return () => window.removeEventListener('message', openActivity)
  }, [binding])
  const [board, setBoard] = useState<LessonBoard | null>(null)
  const [status, setStatus] = useState(INITIAL)
  const [question, setQuestion] = useState(binding ? 'Explain this part of the page.' : 'Explain how a browser loads a website.')
  const [answer, setAnswer] = useState(record.answer || 'Ask a question. We’ll work it out on the board.')
  const [error, setError] = useState(record.interrupted ? 'The previous question stopped. Your saved board is restored; ask a follow-up to continue.' : '')
  const document = useRef(withSteps(record.document))
  const [steps, setSteps] = useState(() => documentInfo(document.current))
  const saved = useMemo(() => lessonClient(record, setError), [record])
  const changed = useCallback((page: BoardDocument) => {
    document.current = savePage(document.current, page)
    saved.changed(document.current)
  }, [saved])
  function capture() {
    if (board?.save) { document.current = savePage(document.current, board.save()) }
    return document.current
  }
  async function editSteps(operation: DocumentOp) {
    if (!board?.load) { throw new Error('Board is not ready') }
    const next = changeStep(capture(), operation)
    const switched = next.steps!.activeId !== document.current.steps!.activeId
    await saved.flush(next)
    document.current = next
    if (switched) { board.load(next); setStatus(INITIAL) }
    const info = documentInfo(next, operation.action === 'read' ? operation.id : undefined)
    setSteps(info)
    return info
  }
  async function selectStep(id: string) {
    if (pending.current || switching.current) { return }
    switching.current = true; setNavigating(true)
    try { player.current?.dispose(); await editSteps({ action: 'open', id }) } catch (error) { setError(String(error)) }
    finally { switching.current = false; setNavigating(false) }
  }
  const switching = useRef(false)
  const [navigating, setNavigating] = useState(false)
  const [request, setRequest] = useState(RequestState.Idle)
  const pending = useRef<AbortController | null>(null)
  const overlay = useRef<PenOverlayHandle>(null)
  const player = useRef<ReturnType<typeof createLessonPlayer> | null>(null)

  useEffect(() => {
    const pause = () => player.current?.pause()
    window.addEventListener('blur', pause)
    return () => { pending.current?.abort(); player.current?.dispose(); saved.close(); window.removeEventListener('blur', pause) }
  }, [saved])

  const penOrigin = useRef<{x:number;y:number} | null>(null)
  function play(shot: Shot, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let last = ''
      const stop = () => { current.dispose(); reject(new Error('Stopped')) }
      const current = createLessonPlayer(board!, [shot], (frame: LessonFrame) => {
        overlay.current?.show(frame)
        const key = `${frame.state}/${frame.step}/${frame.blocked}`
        if (key !== last) {
          last = key
          setStatus({ state: frame.state, step: frame.step, caption: frame.caption, blocked: frame.blocked })
        }
        if (frame.state === Playback.Done) {
          signal.removeEventListener('abort', stop)
          queueMicrotask(() => { penOrigin.current = current.endpoint(); current.dispose(); resolve() })
        }
      }, undefined, penOrigin.current)
      player.current = current
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) { stop(); return }
      current.start()
    })
  }

  async function ask() {
    if (!board || pending.current || switching.current || !question.trim()) { return }
    const controller = new AbortController()
    pending.current = controller
    setRequest(RequestState.Thinking); setError(''); setStatus(INITIAL)
    const reply = async (status: Reply['status'], scene = board.snapshot().scene) => {
      const stored = await saved.flush(capture())
      return { ...board.snapshot(), status, bounds: board.measure?.(scene) ?? [], documentRevision: stored.revision }
    }
    try {
      const stored = await saved.flush(capture())
      const pageContext = await refreshSource()
      const input = { pageContext, lessonId: record.id, turnId: crypto.randomUUID(), revision: stored.revision, question }
      await askPartner(input, controller.signal, async event => {
        if (event.type === 'activity') { setActivity(items => mergeActivity(items, event.item)); return }
        if (event.type === 'done') {
          setAnswer(event.answer); setQuestion('')
          return
        }
        if (event.type === 'page') {
          if (!binding) { return { ...await reply('ok'), pageError: 'No Chrome source page is connected.' } }
          try { return { ...await reply('ok'), pageResult: await readPage(binding, event.operation) } }
          catch (error) { return { ...await reply('ok'), pageError: String(error) } }
        }
        if (event.type === 'document') {
          if (JSON.stringify(board.snapshot().scene) !== JSON.stringify(event.before)) { return reply('stale') }
          const info = await editSteps(event.operation)
          return { ...await reply('ok'), document: info }
        }
        if (event.type === 'viewport') { board.scrollToContent?.(event.scene, event.options); return reply('ok') }
        if (event.type === 'inspect') { return reply('ok', event.scene) }
        if (event.type === 'capture') {
          const stale = () => JSON.stringify(board.snapshot().scene) !== JSON.stringify(event.before)
          if (stale()) { return reply('stale') }
          await board.prepare?.(event.scene, controller.signal)
          if (stale()) { return reply('stale') }
          const image = await board.capture?.(event.scene)
          controller.signal.throwIfAborted()
          if (stale()) { return reply('stale') }
          return { ...await reply('ok', event.scene), image }
        }
        if (event.type !== 'present') { return }
        const stale = () => JSON.stringify(board.snapshot().scene) !== JSON.stringify(event.before)
        if (stale()) { return reply('stale') }
        await board.prepare?.(event.shot.scene, controller.signal)
        if (stale()) { return reply('stale') }
        await play(event.shot, controller.signal)
        return reply('ok')
      })
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'The request failed.') }
      controller.abort()
    } finally {
      if (pending.current === controller) { pending.current = null; setActivity(items => items.map(item => item.status === 'running' ? { ...item, status: 'error', output: item.output ?? 'Run ended before completion.' } : item)); setRequest(RequestState.Idle); setStatus(value => ({ ...value, state: Playback.Done })) }
    }
  }
  async function navigate(id: string | null) {
    if (pending.current || switching.current) { return }
    try {
      await saved.flush(capture())
      const next = await openLesson(id)
      const url = new URL(location.href); url.searchParams.set('lesson', next.id)
      location.assign(url)
    } catch (error) { setError(String(error)) }
  }
  async function reset() {
    if (switching.current) { return }
    pending.current?.abort(); player.current?.dispose()
    try {
      await saved.flush(capture())
      const next = await openLesson(null)
      const url = new URL(location.href); url.searchParams.set('lesson', next.id)
      location.assign(url)
    } catch (error) { setError(String(error)) }
  }
  const pause = () => player.current?.pause()
  const drawing = status.state === Playback.Drawing
  const paused = status.state === Playback.Paused
  const thinking = request === RequestState.Thinking
  const finished = status.state === Playback.Done || status.state === Playback.Ready

  return <main className="flex h-dvh flex-col bg-[#f7f8f5] text-[#242a26]">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-6 py-4">
      <div className="flex items-center gap-3"><PencilLine size={24} className="text-[#286749]" /><h1 className="font-semibold">Alongside</h1><span className="hidden border-l border-stone-300 pl-3 text-sm text-stone-500 sm:block">Think it through</span></div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button className="control" disabled={!board} onClick={() => { pause(); board?.fit() }}><ArrowsOut size={15} /> Fit</button>
        <button className="control" aria-expanded={lessons} onClick={() => setLessons(value => !value)}>Lessons</button>
        <button className="control" aria-expanded={debug} onClick={() => setDebug(value => !value)}>Activity</button>
        <button className="control" onClick={() => void reset()}><ArrowCounterClockwise size={15} /> New lesson</button></div>
    </header>
    {binding && <div className="flex shrink-0 items-center gap-3 border-b px-5 py-2 text-xs" aria-label="Source page">
      <span className="min-w-0 flex-1 truncate">{source ? `${source.title}${source.video?.currentTime != null ? ` · ${Math.floor(source.video.currentTime)}s` : ''}` : 'Connecting to Chrome…'}</span>
      <button className="control" disabled={thinking} onClick={() => void refreshSource().catch(() => {})}>Refresh context</button>
      {sourceError && <span role="alert" className="text-red-700">{sourceError}</span>}
      {source?.video?.notice && <span className="text-amber-800">{source.video.notice}</span>}
    </div>}
    <nav aria-label="Lesson steps" className="flex shrink-0 gap-2 overflow-x-auto border-b px-5 py-2">
      {steps.pages.map((page, index) => <button key={page.id} className="control shrink-0" disabled={thinking || navigating} aria-current={steps.activeId === page.id ? 'step' : undefined} onClick={() => void selectStep(page.id)} style={steps.activeId === page.id ? { borderColor: '#286749', color: '#286749' } : undefined}>{index + 1}. {page.title}</button>)}
    </nav>
    <div className="relative min-h-0 flex-1">
    <section className="absolute inset-0 bg-white" aria-label="Shared explanation board" onPointerDownCapture={pause} onWheelCapture={pause} onKeyDownCapture={pause}>
      <Suspense fallback={<p className="p-8 text-sm">Loading the whiteboard…</p>}><Board initial={record.document} onChange={changed} onReady={setBoard} onSelect={ignoreSelection} /></Suspense>
      {board && <PenOverlay ref={overlay} board={board} />}
    </section>
    {lessons && <LessonsPanel current={record.id} busy={thinking} open={id => void navigate(id)} close={() => setLessons(false)} />}
    {debug && <ActivityPanel items={activity} close={() => setDebug(false)} />}
    </div>
    <footer className="shrink-0 border-t border-[#dfe5da] px-5 py-3">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <p className="min-w-0 max-h-[18dvh] flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-[#3b5040]" aria-label="Explanation" aria-live="polite">{!finished ? status.caption : thinking ? 'Thinking through the next step…' : answer}</p>
          {thinking && <button className="control" onClick={() => { pending.current?.abort() }}>Stop</button>}
          {(drawing || paused) && <button className="control" disabled={status.blocked} onClick={() => { if (drawing) { pause() } else { player.current?.start() } }}>
            {drawing ? <Pause size={16} /> : <Play size={16} />}{drawing ? 'Pause' : 'Resume'}</button>}
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        {status.blocked && <p className="text-sm text-amber-800">Undo the deletion of an explanation object to resume.</p>}
        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void ask() }}>
          <input aria-label="Question" className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#286749]" placeholder="Ask a question or follow-up…" maxLength={1500} value={question} onChange={(event) => setQuestion(event.target.value)} />
          <button className="flex items-center gap-2 rounded-lg bg-[#286749] px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!board || thinking || navigating || !finished || !question.trim()}><ArrowRight size={16} />{thinking ? 'Thinking…' : 'Ask'}</button>
        </form>
        <p className="mt-2 text-xs text-stone-400">Touch the board to pause. Resume when you’re ready to continue.</p>
      </div>
    </footer>
  </main>
}
