// The DSC Tracker records view, moved from the DSC-only app: same data (/records), search, filters, Box/Slot, WhatsApp.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, MessageCircle, RefreshCw, Search } from 'lucide-react'
import { api } from '../api.js'
import { Badge, TABS, filterRecords, input, whatsappUrl } from '../shared.jsx'
import { Empty, ErrorState, Spinner, useBackLayer } from '../components/ui.jsx'

export default function DscScreen({ serial, tab: initialTab, onClose }) {
  const [records, setRecords] = useState([])
  const [q, setQ] = useState(serial || '')
  const [tab, setTab] = useState(initialTab || 'all')
  const [state, setState] = useState({ loading: true, error: '' })
  useBackLayer(true, onClose)

  const load = useCallback(async () => {
    setState({ loading: true, error: '' })
    try { setRecords(await api.records()); setState({ loading: false, error: '' }) } catch (e) { setState({ loading: false, error: e.message }) }
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => filterRecords(records, q, tab), [records, q, tab])

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-xl space-y-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <header className="flex items-center gap-2">
          <button onClick={onClose} aria-label="Back" className="rounded-md border border-slate-300 bg-white p-2"><ArrowLeft size={18} /></button>
          <h1 className="flex-1 text-lg font-bold text-slate-800">DSC Tracker <span className="font-normal text-slate-500">· {records.length}</span></h1>
          <button onClick={load} disabled={state.loading} aria-label="Refresh" className="rounded-md border border-slate-300 bg-white p-2"><RefreshCw size={18} className={state.loading ? 'animate-spin' : ''} /></button>
        </header>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input className={input + ' pl-9'} placeholder="Search client, box/slot or serial" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex overflow-x-auto rounded-md border border-slate-300 text-sm">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 whitespace-nowrap px-3 py-2 ${tab === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-700'}`}>{l}</button>
          ))}
        </div>
        {state.error && <ErrorState message={state.error} onRetry={load} />}
        {shown.map((r) => (
          <div key={r.serial_number} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-slate-800">{r.holder_name}</div>
              <Badge status={r.expiry_status} />
            </div>
            <div className="rounded-md bg-blue-50 px-3 py-2 text-center text-xl font-bold text-blue-800">{r.box_slot}</div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Expiry {r.expiry_date} ({r.days_remaining} days)</span><span>{r.status}</span>
            </div>
            {r.notes && <div className="text-sm text-slate-500">{r.notes}</div>}
            {r.client_phone && (
              <a href={whatsappUrl(r)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-md bg-green-600 py-2 text-sm font-semibold text-white">
                <MessageCircle size={18} /> WhatsApp reminder
              </a>
            )}
          </div>
        ))}
        {state.loading && !records.length && <Spinner />}
        {!shown.length && !state.loading && !state.error && <Empty>No records</Empty>}
      </div>
    </div>
  )
}
