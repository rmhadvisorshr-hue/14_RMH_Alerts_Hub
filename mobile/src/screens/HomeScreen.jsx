import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarDays, ChevronRight, KeyRound } from 'lucide-react'
import { useData } from '../store.jsx'
import { useNav } from '../nav.jsx'
import { api } from '../api.js'
import { summarize } from '../lib/calendarUi.js'
import { ago, fmtDay } from '../lib/format.js'
import { CATEGORY_NAME, MODULE_NAME } from '../lib/target.js'
import { Banner, Badge, Empty, ErrorState, Section, Spinner } from '../components/ui.jsx'
import { EventRow } from '../components/EventViews.jsx'

const MODS = [['IT', 'Income Tax'], ['GST', 'GST'], ['DSC', 'DSC Tracker']]
const SOURCE_NAME = { income_tax: 'Income Tax', gst: 'GST' }

function Stat({ n, label, tone, onClick }) {
  return (
    <button onClick={onClick} className="flex-1 py-3 text-center active:bg-slate-50">
      <div className={`text-[22px] font-bold leading-none ${tone}`}>{n}</div>
      <div className="mt-1 text-[11px] font-medium text-slate-500">{label}</div>
    </button>
  )
}

export default function HomeScreen() {
  const { cal, unread, version, loadEvents } = useData()
  const nav = useNav()
  const [recent, setRecent] = useState({ status: 'loading', items: [] })
  useEffect(() => {
    let live = true
    api.notifications({ limit: 3 }).then((r) => live && setRecent({ status: 'ok', items: r.items })).catch(() => live && setRecent({ status: 'error', items: [] }))
    return () => { live = false }
  }, [version])

  const s = useMemo(() => summarize(cal.events, cal.today), [cal.events, cal.today])
  const down = Object.entries(cal.sources || {}).filter(([, v]) => v.status !== 'ok')
  const attention = [...s.overdueList.slice(0, 4), ...s.today]
  const open = nav.openEvent

  if (cal.status === 'loading') return <Spinner />
  if (cal.status === 'error') return <ErrorState message={`Could not load your deadlines. ${cal.error}`} onRetry={loadEvents} />

  return (
    <div className="pb-6">
      <header className="px-4 pb-1 pt-4">
        <h1 className="text-[20px] font-bold text-slate-900">RMH Advisors</h1>
        <p className="text-[13px] text-slate-500">{fmtDay(cal.today)} · Internal compliance hub</p>
      </header>

      {down.length > 0 && (
        <div className="mt-2"><Banner tone="amber">
          <b>{down.map(([m]) => SOURCE_NAME[m] || m).join(' and ')}</b> data is unavailable ({down[0][1].status === 'not_configured' ? 'Notice Alert is not connected to the Hub yet' : down[0][1].message}). Totals below cover the connected modules only.
        </Banner></div>
      )}

      <div className="mx-4 mt-3 flex divide-x divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <Stat n={s.overdue} label="Overdue" tone={s.overdue ? 'text-red-600' : 'text-slate-900'} onClick={() => nav.openCalendar({ statuses: ['Overdue'] })} />
        <Stat n={s.today.length} label="Due today" tone={s.today.length ? 'text-amber-600' : 'text-slate-900'} onClick={() => nav.openCalendar({ date: cal.today })} />
        <Stat n={s.pending} label="Pending" tone="text-slate-900" onClick={() => nav.openCalendar({})} />
        <Stat n={s.completed} label="Completed" tone="text-green-600" onClick={() => nav.openCalendar({ statuses: ['Completed'] })} />
      </div>

      <Section title="Needs attention" action={<button onClick={() => nav.openCalendar({})} className="flex items-center gap-1 text-[12px] font-medium text-blue-600"><CalendarDays size={13} />Calendar</button>}>
        <div className="mx-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {attention.length ? <div className="divide-y divide-slate-100">{attention.map((e) => <EventRow key={e.id} e={e} onClick={() => open(e)} />)}</div>
            : <Empty>Nothing overdue or due today.</Empty>}
        </div>
        {s.overdue > 4 && <p className="px-4 pt-1.5 text-[12px] text-slate-500">Showing the 4 most recent of {s.overdue} overdue items.</p>}
      </Section>

      <Section title="Upcoming deadlines">
        <div className="mx-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {s.next.length ? <div className="divide-y divide-slate-100">{s.next.slice(0, 5).map((e) => <EventRow key={e.id} e={e} onClick={() => open(e)} />)}</div>
            : <Empty>No upcoming deadlines.</Empty>}
        </div>
      </Section>

      <Section title="Modules">
        <div className="mx-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {MODS.map(([k, label]) => {
            const c = s.by[k]
            return (
              <div key={k} className="flex items-center">
                <button onClick={() => nav.openCalendar({ module: k })} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                  <span className="flex-1 text-[14px] font-semibold text-slate-900">{label}</span>
                  <span className="text-[12px] text-slate-500"><b className={c.overdue ? 'text-red-600' : ''}>{c.overdue}</b> overdue · <b>{c.pending}</b> pending · <b>{c.completed}</b> done</span>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
                {k === 'DSC' && <button onClick={() => nav.openDsc()} aria-label="Open DSC records" className="border-l border-slate-100 px-4 py-3 text-blue-600"><KeyRound size={18} /></button>}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Recent notifications" action={<button onClick={() => nav.goTab('notifications')} className="flex items-center gap-1 text-[12px] font-medium text-blue-600"><Bell size={13} />{unread.total ? `${unread.total} unread` : 'All'}</button>}>
        <div className="mx-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {recent.status === 'loading' ? <Spinner /> : recent.status === 'error' ? <Empty>Could not load notifications.</Empty>
            : recent.items.length === 0 ? <Empty>No notifications yet.</Empty>
            : <div className="divide-y divide-slate-100">{recent.items.map((n) => (
              <button key={n.id} onClick={() => nav.openNotification(n)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left active:bg-slate-50">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-blue-600'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><span className={`truncate text-[14px] text-slate-900 ${n.is_read ? '' : 'font-semibold'}`}>{n.title}</span>{n.urgent && <Badge tone="red">Urgent</Badge>}</span>
                  <span className="block truncate text-[12px] text-slate-500">{MODULE_NAME[n.module]} · {CATEGORY_NAME[n.category]} · {ago(n.created_at)}</span>
                </span>
              </button>))}</div>}
        </div>
      </Section>
    </div>
  )
}
