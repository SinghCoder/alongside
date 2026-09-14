import { useEffect, useRef, useState } from 'react'
import { Code, X, Check, SpinnerGap, WarningCircle } from '@phosphor-icons/react'
import { activityLabel, type Activity } from './activity'

const json = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const FOLLOW_GAP = 40
const prose = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)
export default function ActivityPanel({ items, close }: { items: Activity[]; close: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = items.find(item => item.id === selectedId)
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useEffect(() => { if (selectedId) { dialog.current?.showModal() } }, [selectedId])
  useEffect(() => { if (following.current && list.current) { list.current.scrollTop = list.current.scrollHeight } }, [items])
  return <aside aria-label="Agent activity" className="absolute inset-y-0 right-0 z-30 flex w-[390px] max-w-full flex-col border-l border-stone-200 bg-[#fafbf8] shadow-xl">
    <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4"><h2 className="text-sm font-semibold">Agent activity</h2><button aria-label="Close activity" className="control" onClick={close}><X size={16} /></button></header>
    <div ref={list} onScroll={() => { const node = list.current!; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_GAP }} className="min-h-0 flex-1 overflow-y-auto p-4" role="log" aria-live="polite">
      {!items.length && <p className="text-sm text-stone-500">Ask a question to see calls, results and available reasoning summaries.</p>}
      {items.map(item => <article key={item.id} className="mb-3 rounded-xl border border-stone-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs text-stone-500">
          {item.status === 'running' ? <SpinnerGap className="animate-spin" size={15} /> : item.status === 'error' ? <WarningCircle className="text-red-600" size={15} /> : <Check size={15} />}
          <span className="flex-1 font-medium text-stone-700">{activityLabel(item)}</span>
          {item.recovered && <span className="text-stone-400">Recovered</span>}
          {item.durationMs !== undefined && <span>{(item.durationMs / 1000).toFixed(1)}s</span>}
          {(item.input !== undefined || item.output !== undefined) && <button aria-label={`Inspect ${activityLabel(item)} input and output`} title="Input / output" onClick={() => setSelectedId(item.id)} className="rounded p-1 hover:bg-stone-100"><Code size={16} /></button>}
        </div>
        {item.text && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-600">{prose(item.text)}</p>}
        {item.input != null && <p className="mt-2 truncate font-mono text-xs text-stone-500">{json(item.input)}</p>}
        {item.output !== undefined && <details className="mt-2 text-xs text-stone-600"><summary className="cursor-pointer">{item.status === 'error' ? 'Error' : 'Result'}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-stone-50 p-2">{json(item.output)}</pre></details>}
      </article>)}
    </div>
    <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-400">Saved lesson activity. Summaries appear when the model provides them.{items.some(item => item.recovered) ? ' Recovered calls may be incomplete after conversation compaction; original timings are unavailable.' : ''}</p>
    <dialog ref={dialog} onClose={() => setSelectedId(null)} className="m-auto w-[760px] max-w-[95vw] rounded-2xl border border-stone-200 p-0 text-stone-700 shadow-2xl backdrop:bg-black/30">
      {selected && <><header className="flex items-center justify-between border-b p-4"><h3 className="font-semibold">{activityLabel(selected)}</h3><button className="control" aria-label="Close input and output" onClick={() => dialog.current?.close()}><X size={18} /></button></header><div className="max-h-[75vh] overflow-auto p-5">{[['Input', selected.input], ['Output', selected.output]].map(([label, value]) => <section key={String(label)} className="mb-5"><h4 className="mb-2 text-xs font-semibold uppercase text-stone-500">{String(label)}</h4><pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-100 p-4 text-xs">{value === undefined ? 'Pending' : json(value)}</pre></section>)}</div></>}
    </dialog>
  </aside>
}
