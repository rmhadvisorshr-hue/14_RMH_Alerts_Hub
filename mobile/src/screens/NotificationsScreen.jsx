import { useCallback, useEffect, useState } from 'react'
import { CheckCheck, RefreshCw } from 'lucide-react'
import { api } from '../api.js'
import { useData } from '../store.jsx'
import { useNav } from '../nav.jsx'
import { ago, fmtDay } from '../lib/format.js'
import { CATEGORY_NAME, MODULE_NAME } from '../lib/target.js'
import { Badge, Chip, Empty, ErrorState, Segmented, Sheet, Spinner } from '../components/ui.jsx'

const PAGE = 25
const STATUS = [['all', 'All'], ['unread', 'Unread'], ['read', 'Read']]
const MOD_TONE = { income_tax: 'blue', gst: 'purple', dsc: 'slate' }

export function NotificationItem({ n, onOpen }) {
  return (
    <button onClick={() => onOpen(n)} className={`relative flex w-full items-start gap-2.5 py-3 pl-5 pr-4 text-left active:bg-slate-50 ${n.is_read ? '' : 'bg-blue-50/40'}`}>
      {n.urgent && <span className="absolute inset-y-0 left-0 w-1 bg-red-500" />}
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-blue-600'}`} aria-label={n.is_read ? 'Read' : 'Unread'} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={MOD_TONE[n.module]}>{MODULE_NAME[n.module] || n.module}</Badge>
          <Badge>{CATEGORY_NAME[n.category] || n.category}</Badge>
          {n.urgent && <Badge tone="red">Urgent</Badge>}
        </span>
        <span className={`mt-1 block text-[14px] text-slate-900 ${n.is_read ? '' : 'font-semibold'}`}>{n.title}</span>
        <span className="block text-[13px] text-slate-600">{n.body}</span>
        <span className="mt-0.5 block text-[11.5px] text-slate-400">{ago(n.created_at)}</span>
      </span>
    </button>
  )
}

export function NotificationDetail({ n, onClose }) {
  return (
    <Sheet title={n.title} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5"><Badge tone={MOD_TONE[n.module]}>{MODULE_NAME[n.module]}</Badge><Badge>{CATEGORY_NAME[n.category]}</Badge>{n.urgent && <Badge tone="red">Urgent</Badge>}</div>
      <p className="mt-3 text-[14px] text-slate-800">{n.body}</p>
      <dl className="mt-3 space-y-1 text-[13px] text-slate-600">
        <div>Received {fmtDay(n.created_at)} ({ago(n.created_at)})</div>
        {n.event_date && <div>Related date {fmtDay(n.event_date)}</div>}
        {n.payload?.client_name && <div>Client {n.payload.client_name}</div>}
        {n.payload?.notice_ref && <div>Notice ID {n.payload.notice_ref}</div>}
      </dl>
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">This record is no longer in the calendar or the DSC list, so there is nothing further to open.</p>
    </Sheet>
  )
}

export default function NotificationsScreen() {
  const { unread, loadUnread, version, refreshAll } = useData()
  const nav = useNav()
  const [f, setF] = useState({ status: 'all', module: '', category: '' })
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, error: '' })
  const [more, setMore] = useState(false)
  const [spin, setSpin] = useState(false)

  const load = useCallback(async (append = false, offset = 0) => {
    try {
      const r = await api.notifications({ ...f, limit: PAGE, offset })
      setState((s) => ({ status: 'ok', items: append ? [...s.items, ...r.items] : r.items, total: r.total, error: '' }))
    } catch (e) { setState((s) => ({ ...s, status: 'error', error: e.message })) }
  }, [f])
  useEffect(() => { setState((s) => ({ ...s, status: 'loading' })); load() }, [load, version])

  function open(n) { // marking it read on the server happens in nav.openNotification
    if (!n.is_read) {
      setState((s) => ({ ...s, items: s.items.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)) }))
    }
    nav.openNotification(n)
  }
  async function readAll() {
    try { await api.markAllRead(); await loadUnread(); await load() } catch (e) { setState((s) => ({ ...s, error: e.message, status: 'error' })) }
  }

  const mods = [['', 'All'], ['income_tax', 'Income Tax'], ['gst', 'GST'], ['dsc', 'DSC']]
  const cats = [['', 'Any type'], ...Object.entries(CATEGORY_NAME)]
  const filtered = f.status !== 'all' || f.module || f.category

  return (
    <div className="pb-6">
      <header className="sticky top-0 z-10 space-y-2 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-[17px] font-bold text-slate-900">Notifications</h1>
          <button onClick={async () => { setSpin(true); await refreshAll(); setSpin(false) }} aria-label="Refresh" className="rounded-lg border border-slate-200 p-2 text-slate-600"><RefreshCw size={16} className={spin ? 'animate-spin' : ''} /></button>
          <button onClick={readAll} disabled={!unread.total} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] font-medium text-slate-700 disabled:opacity-40"><CheckCheck size={15} />Mark all read</button>
        </div>
        <Segmented label="Read state" options={STATUS} value={f.status} onChange={(status) => setF({ ...f, status })} />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {mods.map(([k, l]) => <Chip key={k} on={f.module === k} onClick={() => setF({ ...f, module: k })}>{l}{k && unread.by_module[k] ? ` · ${unread.by_module[k]}` : ''}</Chip>)}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {cats.map(([k, l]) => <Chip key={k} on={f.category === k} onClick={() => setF({ ...f, category: k })}>{l}</Chip>)}
        </div>
      </header>

      {state.status === 'loading' && <Spinner />}
      {state.status === 'error' && <ErrorState message={`Could not load notifications. ${state.error}`} onRetry={() => load()} />}
      {state.status === 'ok' && (state.items.length === 0
        ? <Empty>{filtered ? 'No notifications match these filters.' : 'No notifications yet. Deadline reminders and new notices from every connected module will appear here.'}</Empty>
        : (
          <>
            <div className="divide-y divide-slate-100 bg-white">{state.items.map((n) => <NotificationItem key={n.id} n={n} onOpen={open} />)}</div>
            {state.items.length < state.total && (
              <button disabled={more} onClick={async () => { setMore(true); await load(true, state.items.length); setMore(false) }} className="mx-auto mt-4 block rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700">
                {more ? 'Loading…' : `Load more (${state.total - state.items.length})`}
              </button>
            )}
          </>
        ))}
    </div>
  )
}
