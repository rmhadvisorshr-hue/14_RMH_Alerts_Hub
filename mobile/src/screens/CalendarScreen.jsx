import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { CalendarClock, ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { useData } from '../store.jsx'
import { useNav } from '../nav.jsx'
import { LEGEND, MODULES, NO_FILTERS, STATUSES, TYPES, activeCount, applyFilters, byDate, colourOf, upcoming } from '../lib/calendarUi.js'
import { addDays, addMonths, dayTitle, fmtDay, monthRange, monthTitle, weekRange, weekTitle } from '../lib/format.js'
import { Banner, Chip, Empty, ErrorState, Segmented, Sheet, Spinner } from '../components/ui.jsx'
import { EventRow } from '../components/EventViews.jsx'

const VIEWS = [['month', 'Month'], ['week', 'Week'], ['day', 'Day'], ['agenda', 'Agenda']]
const SHOW_ORDER = ['response_due', 'hearing', 'limitation', 'expiry', 'issue', 'submission'] // what needs action first
const MAX_DOTS = 3
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const SOURCE_TEXT = { not_configured: 'is not connected to the Hub yet', unauthorized: 'rejected the Hub’s sign-in', unreachable: 'could not be reached', error: 'returned an error' }

function step(view, cursor, dir) {
  return view === 'month' || view === 'agenda' ? addMonths(cursor, dir) : addDays(cursor, view === 'week' ? 7 * dir : dir)
}
const titleOf = (view, cursor) => (view === 'week' ? weekTitle(cursor) : view === 'day' ? dayTitle(cursor) : monthTitle(cursor))

// Month and week are FullCalendar grids (the web calendar's engine) drawn compactly: one dot per event, coloured and
// dashed exactly like the web calendar. Tapping a date lists its events underneath, so nothing is squeezed into a cell.
function DotGrid({ view, cursor, byDay, selected, onSelect }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.getApi().gotoDate(cursor) }, [cursor])
  const events = useMemo(() => Object.entries(byDay).flatMap(([day, list]) =>
    [...list].sort((a, b) => SHOW_ORDER.indexOf(a.event_type) - SHOW_ORDER.indexOf(b.event_type)).slice(0, MAX_DOTS)
      .map((e) => ({ id: e.id, start: day, allDay: true, extendedProps: { e } }))), [byDay])
  return (
    <FullCalendar
      ref={ref}
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView={view === 'week' ? 'dayGridWeek' : 'dayGridMonth'}
      initialDate={cursor}
      headerToolbar={false}
      height="auto"
      fixedWeekCount={false}
      dayMaxEvents={false}
      events={events}
      dayHeaderFormat={{ weekday: 'short' }}
      dateClick={(i) => onSelect(i.dateStr)}
      eventClick={(i) => onSelect(localIso(i.event.start))}
      dayCellClassNames={(a) => (localIso(a.date) === selected ? ['is-selected'] : [])}
      dayCellContent={(a) => {
        const more = (byDay[localIso(a.date)]?.length || 0) - MAX_DOTS
        return <span className="dnum">{a.date.getDate()}{more > 0 && <b>+{more}</b>}</span>
      }}
      eventContent={(a) => <span className={`dot${a.event.extendedProps.e.event_type === 'issue' ? ' dot-issue' : ''}`} style={{ '--c': colourOf(a.event.extendedProps.e) }} />}
    />
  )
}

function FilterSheet({ filters, set, clients, onClose, total, shown }) {
  const toggle = (k, v) => set({ [k]: filters[k].includes(v) ? filters[k].filter((x) => x !== v) : [...filters[k], v] })
  const lab = 'mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500'
  const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm'
  return (
    <Sheet title="Filters" onClose={onClose} footer={
      <div className="flex gap-2">
        <button onClick={() => set({ ...NO_FILTERS, q: filters.q })} disabled={activeCount({ ...filters, q: '' }) === 0} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40">Clear filters</button>
        <button onClick={onClose} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white">Show {shown} of {total}</button>
      </div>}>
      <div className="-mt-4">
        <div className={lab}>Module</div>
        <Segmented label="Module" options={MODULES} value={filters.module} onChange={(v) => set({ module: v })} />
        <div className={lab}>Client</div>
        <select className={field} value={filters.client} onChange={(e) => set({ client: e.target.value })} aria-label="Client">
          <option value="">All clients</option>{clients.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className={lab}>Date type</div>
        <div className="flex flex-wrap gap-2">{TYPES.map(([k, l]) => <Chip key={k} on={filters.types.includes(k)} onClick={() => toggle('types', k)}>{l}</Chip>)}</div>
        <div className={lab}>Status</div>
        <div className="flex flex-wrap gap-2">{STATUSES.map((s) => <Chip key={s} on={filters.statuses.includes(s)} onClick={() => toggle('statuses', s)}>{s}</Chip>)}</div>
        <div className={lab}>Date range</div>
        <div className="flex gap-2">
          <label className="flex-1 text-[12px] text-slate-500">From<input type="date" className={field} value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="flex-1 text-[12px] text-slate-500">To<input type="date" className={field} value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
        </div>
        <p className="mt-4 text-[12px] text-slate-400">These filters only change what this calendar shows. Which modules send you notifications is set separately in Settings.</p>
      </div>
    </Sheet>
  )
}

export default function CalendarScreen({ intent }) {
  const { cal, loadEvents } = useData()
  const nav = useNav()
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(cal.today)
  const [selected, setSelected] = useState(null)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [spin, setSpin] = useState(false)
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))

  // "Open in calendar" from Home or a notification: jump to the date and/or module.
  useEffect(() => {
    if (!intent) return
    setFilters({ ...NO_FILTERS, module: intent.module || 'all', statuses: intent.statuses || [] })
    if (intent.date) { setCursor(intent.date); setSelected(intent.date) }
  }, [intent])

  const shown = useMemo(() => applyFilters(cal.events, filters), [cal.events, filters])
  const clients = useMemo(() => [...new Set(cal.events.map((e) => e.customer_name).filter(Boolean))].sort(), [cal.events])
  const byDay = useMemo(() => { const m = {}; for (const e of shown) (m[e.event_date] ||= []).push(e); return m }, [shown])
  const down = Object.entries(cal.sources || {}).filter(([, s]) => s.status !== 'ok')
  const active = activeCount(filters)

  async function reload() { setSpin(true); await loadEvents(); setSpin(false) }
  const move = (dir) => { setCursor((c) => step(view, c, dir)); if (view === 'month' || view === 'week') setSelected(null) }
  const goToday = () => { setCursor(cal.today); setSelected(view === 'day' ? null : cal.today) }
  const pickDay = (d) => { setSelected(d); setCursor(d) }

  const open = nav.openEvent
  const rows = (list) => <div className="divide-y divide-slate-100">{list.map((e) => <EventRow key={e.id} e={e} onClick={() => open(e)} />)}</div>
  const nothing = (txt) => <Empty>{txt}{shown.length !== cal.events.length ? ' with the current filters' : ''}.</Empty>

  let below
  if (view === 'day') {
    below = (byDay[cursor] || []).length ? rows([...byDay[cursor]].sort(byDate)) : nothing('No events on this date')
  } else if (view === 'agenda') {
    const [a, b] = monthRange(cursor)
    const days = Object.keys(byDay).filter((d) => d >= a && d <= b).sort()
    below = days.length ? days.map((d) => (
      <div key={d}><div className="sticky top-0 bg-slate-50 px-4 py-1.5 text-[12px] font-semibold text-slate-500">{dayTitle(d)}</div>{rows(byDay[d])}</div>
    )) : nothing('No events in this month')
  } else {
    const list = selected ? byDay[selected] || [] : []
    const [wa, wb] = weekRange(cursor)
    const thisWeek = view === 'week' && !selected
    const up = thisWeek ? shown.filter((e) => e.event_date >= wa && e.event_date <= wb).sort(byDate) : upcoming(shown).slice(0, 8)
    below = (
      <>
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-slate-500"><CalendarClock size={14} />{selected ? dayTitle(selected) : thisWeek ? 'This week' : 'Upcoming deadlines'}</h3>
          {selected && <button onClick={() => setSelected(null)} className="text-[12px] font-medium text-blue-600">Clear</button>}
        </div>
        {selected ? (list.length ? rows([...list].sort(byDate)) : nothing('No events on this date'))
          : up.length ? rows(up) : <Empty>{thisWeek ? 'No events this week' : 'No pending deadlines'}{active ? ' match the filters' : ''}.</Empty>}
      </>
    )
  }

  return (
    <div className="pb-6">
      <header className="sticky top-0 z-10 space-y-2 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-[17px] font-bold text-slate-900">Compliance Calendar</h1>
          <button onClick={reload} aria-label="Reload calendar" className="rounded-lg border border-slate-200 p-2 text-slate-600"><RefreshCw size={16} className={spin ? 'animate-spin' : ''} /></button>
          <button onClick={() => setFilterOpen(true)} aria-label="Filters" className="relative rounded-lg border border-slate-200 p-2 text-slate-600">
            <SlidersHorizontal size={16} />
            {active > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">{active}</span>}
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <Search size={15} className="text-slate-400" />
          <input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search client, notice reference or ID" aria-label="Search events"
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          {filters.q && <button onClick={() => set({ q: '' })} aria-label="Clear search"><X size={15} className="text-slate-400" /></button>}
        </label>
        <Segmented label="Calendar view" options={VIEWS} value={view} onChange={(v) => { setView(v); if (v === 'day' && selected) setCursor(selected); if (v !== 'day') setSelected(null) }} />
        <div className="flex items-center gap-1">
          <button onClick={() => move(-1)} aria-label="Previous" className="rounded-lg p-2 text-slate-600"><ChevronLeft size={20} /></button>
          <div className="flex-1 text-center text-[15px] font-semibold text-slate-900">{titleOf(view, cursor)}</div>
          <button onClick={() => move(1)} aria-label="Next" className="rounded-lg p-2 text-slate-600"><ChevronRight size={20} /></button>
          <button onClick={goToday} className="ml-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-700">Today</button>
        </div>
      </header>

      {cal.status === 'loading' && <Spinner label="Loading calendar…" />}
      {cal.status === 'error' && <ErrorState message={`Could not load the calendar. ${cal.error}`} onRetry={reload} />}
      {cal.status === 'ok' && (
        <>
          {down.length > 0 && (
            <div className="mt-3"><Banner tone="amber">
              {[...new Set(down.map(([, s]) => s.status))].map((st) => (
                <p key={st}><b>{down.filter(([, s]) => s.status === st).map(([m]) => (m === 'income_tax' ? 'Income Tax' : m === 'gst' ? 'GST' : m.toUpperCase())).join(' and ')}</b> {SOURCE_TEXT[st] || 'is unavailable'}; those events are not shown. {down.find(([, s]) => s.status === st)[1].message}</p>
              ))}
            </Banner></div>
          )}
          {(view === 'month' || view === 'week') && (
            <div className="cal-mobile mx-3 mt-3 rounded-xl border border-slate-200 bg-white p-1.5">
              <DotGrid key={view} view={view} cursor={cursor} byDay={byDay} selected={selected} onSelect={pickDay} />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 px-2 pb-1 pt-2 text-[11px] text-slate-500">
                {LEGEND.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}
                <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full border border-dashed border-slate-500 bg-white" />Issue date (dashed)</span>
              </div>
            </div>
          )}
          <div className={view === 'month' || view === 'week' ? '' : 'mt-3'}>{below}</div>
        </>
      )}

      {filterOpen && <FilterSheet filters={filters} set={set} clients={clients} total={cal.events.length} shown={shown.length} onClose={() => setFilterOpen(false)} />}
    </div>
  )
}
