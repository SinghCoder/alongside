import { useEffect, useState, type ReactNode } from 'react'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
export function AccessGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(LOCAL_HOSTS.has(location.hostname))
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('Checking access…')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (LOCAL_HOSTS.has(location.hostname)) { return }
    fetch('/api/auth').then(response => response.json()).then(value => {
      setReady(value.authenticated); setMessage('Enter your demo access code to start a lesson.')
    }).catch(() => setMessage('Could not connect. Please try again.'))
  }, [])
  if (ready) { return children }
  return <main className="flex min-h-screen items-center justify-center bg-[#f6f7f2] p-6">
    <form className="w-full max-w-sm space-y-5" onSubmit={async event => {
      event.preventDefault(); setBusy(true)
      try {
        const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
        const value = await response.json()
        if (!response.ok) { throw new Error(value.error || 'Could not sign in') }
        setReady(true)
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in') }
      finally { setBusy(false) }
    }}>
      <h1 className="text-3xl font-semibold text-[#286749]">Alongside</h1>
      <p className="text-stone-600">A learning partner that draws with you.</p>
      <label className="block text-sm" htmlFor="access-code">Demo access code</label>
      <input id="access-code" type="password" autoComplete="off" required value={code} onChange={event => setCode(event.target.value)} className="w-full rounded-lg border bg-white p-3" />
      <button disabled={busy} className="w-full rounded-lg bg-[#286749] p-3 text-white">{busy ? 'Opening…' : 'Open whiteboard'}</button>
      <p role="status" className="text-sm text-stone-600">{message}</p>
    </form>
  </main>
}
