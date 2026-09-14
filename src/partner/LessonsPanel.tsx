import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { listLessons } from './lessons'
import type { LessonSummary } from './protocol'

export default function LessonsPanel({ current, busy, open, close }: {
  current: string; busy: boolean; open: (id: string) => void; close: () => void
}) {
  const [items, setItems] = useState<LessonSummary[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void listLessons().then(setItems).catch(reason => setError(String(reason))) }, [])
  return <aside aria-label="Past lessons" className="absolute inset-y-0 left-0 z-30 flex w-72 max-w-full flex-col border-r border-stone-200 bg-[#fafbf8] shadow-lg">
    <header className="flex items-center justify-between border-b px-4 py-3"><h2 className="text-sm font-semibold">Lessons</h2><button className="control" aria-label="Close lessons" onClick={close}><X size={16} /></button></header>
    <div className="overflow-auto p-3">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {busy && <p className="mb-3 text-xs text-stone-500">Finish or stop the current question to switch.</p>}
      {items.map(item => <button key={item.id} disabled={busy} aria-current={item.id === current ? 'page' : undefined} onClick={() => open(item.id)} className={`mb-2 w-full rounded-lg border p-3 text-left disabled:opacity-50 ${item.id === current ? 'border-[#286749] bg-white' : 'border-transparent hover:bg-white'}`}>
        <span className="block text-sm">{item.title}</span><span className="mt-1 block text-xs text-stone-500">{new Date(item.updatedAt).toLocaleString()}{item.interrupted ? ' · Interrupted' : ''}</span>
      </button>)}
    </div>
  </aside>
}
