import { useEffect } from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'

// Android's back button walks the WebView history: each open sheet/page pushes one entry and closes when it is popped.
export function useBackLayer(active, close) {
  useEffect(() => {
    if (!active) return undefined
    let popped = false
    history.pushState({ layer: true }, '')
    const onPop = () => { popped = true; close() }
    window.addEventListener('popstate', onPop)
    return () => { window.removeEventListener('popstate', onPop); if (!popped) history.back() }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{label}</div>
}
export function ErrorState({ message, onRetry }) {
  return (
    <div className="mx-4 my-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800" role="alert">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="font-semibold underline">Retry</button>}
    </div>
  )
}
export const Empty = ({ children }) => <p className="px-4 py-8 text-center text-sm text-slate-400">{children}</p>

export function Banner({ tone = 'amber', children }) {
  const t = { amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-800', blue: 'border-blue-200 bg-blue-50 text-blue-900' }[tone]
  return <div className={`mx-4 rounded-lg border px-3 py-2 text-[13px] ${t}`}>{children}</div>
}

export function Badge({ tone = 'slate', children }) {
  const t = { slate: 'bg-slate-100 text-slate-700', red: 'bg-red-100 text-red-700', green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700', purple: 'bg-violet-100 text-violet-700' }[tone]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>
}
export const STATUS_TONE = { Pending: 'blue', Overdue: 'red', Completed: 'green', Cancelled: 'slate' }

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-[13px]">
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`flex-1 whitespace-nowrap px-3 py-2 font-medium ${value === k ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}>{l}</button>
      ))}
    </div>
  )
}

export function Chip({ on, onClick, children, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium disabled:opacity-40 ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{children}</button>
  )
}

export function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

// Bottom sheet. Closing = backdrop, the X, or the Android back button.
export function Sheet({ title, onClose, children, footer }) {
  useBackLayer(true, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex-1 truncate text-[15px] font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export const Section = ({ title, action, children }) => (
  <section className="mt-5">
    <div className="mb-2 flex items-center justify-between px-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {action}
    </div>
    {children}
  </section>
)
