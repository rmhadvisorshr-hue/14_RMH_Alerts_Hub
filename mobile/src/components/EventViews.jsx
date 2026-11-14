import { Copy, ExternalLink, MessageCircle } from 'lucide-react'
import { MODULE_LABEL, SHORT, colourOf, daysText, statusText } from '../lib/calendarUi.js'
import { fmtDay } from '../lib/format.js'
import { whatsappUrl } from '../lib/dsc.js'
import { Badge, STATUS_TONE, Sheet } from './ui.jsx'
import { useNav } from '../nav.jsx'

// One event as a list row: colour bar (dashed for issue dates), who/what, and when.
export function EventRow({ e, onClick }) {
  const ref = e.notice_ref || e.arn || (e.module === 'DSC' ? e.box_slot : '')
  const issue = e.event_type === 'issue'
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-slate-50">
      <span className="w-1 self-stretch rounded" style={issue ? { border: `1.5px dashed ${colourOf(e)}`, width: 4 } : { background: colourOf(e) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-slate-900">{e.customer_name || e.title}</span>
        <span className="block truncate text-[12px] text-slate-500">{SHORT[e.event_type] || e.type_label} · {MODULE_LABEL[e.module]}{ref ? ` · ${ref}` : ''}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-semibold text-slate-800">{fmtDay(e.event_date, false)}</span>
        <span className={`block text-[11.5px] ${e.status === 'Overdue' ? 'font-medium text-red-600' : 'text-slate-500'}`}>{daysText(e) || statusText(e)}</span>
      </span>
    </button>
  )
}

function Field({ label, children }) {
  if (!children) return null
  return (
    <div className="py-1.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-[14px] text-slate-900">{children}</dd>
    </div>
  )
}
const Copyable = ({ value }) => (
  <span className="inline-flex items-center gap-2 font-mono text-[13px]">{value}
    <button type="button" aria-label={`Copy ${value}`} onClick={() => navigator.clipboard?.writeText(value).catch(() => {})} className="text-slate-400"><Copy size={14} /></button>
  </span>
)

// Event details, in a sheet so the calendar stays visible behind it.
export function EventSheet({ event: e, onClose }) {
  const nav = useNav()
  const dsc = e.module === 'DSC'
  const note = daysText(e)
  return (
    <Sheet title={e.title} onClose={onClose}
      footer={dsc && (
        <div className="flex gap-2">
          <button onClick={() => { onClose(); nav.openDsc(e.serial_number) }} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white"><ExternalLink size={16} />Open DSC record</button>
          {e.client_phone && <a href={whatsappUrl({ ...e, holder_name: e.customer_name, expiry_date: e.event_date, days_remaining: e.days_left })} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white"><MessageCircle size={16} />WhatsApp</a>}
        </div>
      )}>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={STATUS_TONE[e.status]}>{statusText(e)}</Badge>
        <Badge>{MODULE_LABEL[e.module]}</Badge>
        <Badge>{e.type_label}</Badge>
        {e.priority && e.priority !== 'Normal' && <Badge tone="amber">{e.priority} priority</Badge>}
      </div>
      {dsc && <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-center text-xl font-bold text-blue-800">{e.box_slot}</div>}
      <dl className="mt-2 divide-y divide-slate-100">
        <Field label={dsc ? 'Expiry date' : 'Event date'}>{fmtDay(e.event_date)}{note && <span className={`ml-1 ${e.status === 'Overdue' ? 'text-red-600' : 'text-slate-500'}`}>· {note}</span>}</Field>
        <Field label={dsc ? 'Certificate holder' : e.module === 'GST' || e.module === 'SUB' ? 'Customer' : 'Assessee'}>{e.customer_name}</Field>
        <Field label={e.identifier_label}>{e.identifier && <Copyable value={e.identifier} />}</Field>
        <Field label="Notice ID">{e.notice_ref && <Copyable value={e.notice_ref} />}</Field>
        <Field label="ARN">{e.arn && <Copyable value={e.arn} />}</Field>
        <Field label={e.module === 'SUB' ? 'Form' : 'Notice type'}>{e.notice_type}</Field>
        <Field label="Section">{e.notice_section}</Field>
        <Field label="Notice status">{e.notice_status && e.notice_status.replace('_', ' ')}</Field>
        <Field label="Record status">{dsc && e.record_status}</Field>
      </dl>
      {e.description && <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">{e.description}</p>}
      {(e.date_history || []).length > 0 && (
        <div className="mt-3 space-y-1 text-[12px] text-slate-500">
          <div className="font-semibold uppercase tracking-wide text-slate-400">History</div>
          {e.date_history.map((h, i) => (
            <p key={i}>{fmtDay(h.at.slice(0, 10))} · {h.change === 'date' ? `date changed from ${fmtDay(h.from)} to ${fmtDay(h.to)}` : h.change === 'cancelled' ? `cancelled (${fmtDay(h.date)} is no longer on the notice)` : 'reinstated'}</p>
          ))}
        </div>
      )}
      {!dsc && <p className="mt-3 text-[12px] text-slate-400">Notice documents and full notice details are in the Notice Alert web app.</p>}
    </Sheet>
  )
}
