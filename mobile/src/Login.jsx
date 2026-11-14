import { useState } from 'react'
import { input } from './shared.jsx'

// onSubmit(email, password) must throw Error(message) on failure.
export default function Login({ onSubmit }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await onSubmit(email.trim(), password) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4 p-4">
      <h1 className="text-2xl font-bold text-slate-800">RMH Advisors <span className="font-normal text-slate-500">· Internal</span></h1>
      <form onSubmit={go} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <input className={input} type="email" placeholder="Email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" placeholder="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">{err}</p>}
        <button disabled={busy} className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? 'Logging in… (server may take up to a minute to wake)' : 'Log in'}
        </button>
      </form>
    </div>
  )
}
