// Calendar look-up and filter rules. PORTED from the web app so both calendars agree:
//   11_Notice_Alert_System/frontend/src/components/calendarUi.js  (filters, urgency, daysText)
//   11_Notice_Alert_System/frontend/src/components/CalendarPage.jsx (colourOf, SHORT, search fields)
// Deliberate differences, all additive: a DSC module + `expiry` deadline type (certificate expiry is a deadline), and
// no urgency filter / dots helper (the phone layout does not use them). Keep the shared parts identical when the web app changes.
export const MODULE_LABEL = { GST: 'GST Notice', IT: 'Income Tax', SUB: 'GST Submission', DSC: 'DSC Tracker' }
// The module FILTER offers just All / Income Tax / GST / DSC; a GST submission belongs to GST.
export const inModule = (e, m) => (m === 'GST' ? e.module === 'GST' || e.module === 'SUB' : e.module === m)
export const MODULES = [['all', 'All'], ['IT', 'Income Tax'], ['GST', 'GST'], ['DSC', 'DSC']]

export const TYPES = [
  ['issue', 'Issue Date'],
  ['response_due', 'Due Date'],
  ['hearing', 'Hearing'],
  ['limitation', 'Limitation Date'],
  ['submission', 'Submission Date'],
  ['expiry', 'Certificate Expiry'],
]
export const STATUSES = ['Pending', 'Overdue', 'Completed'] // Cancelled events are never shown (the API hides them)
// Events that can be late. Issue dates are information only (same set as DEADLINES in Notice Alert's calendar_service.py).
export const DEADLINE_TYPES = ['response_due', 'hearing', 'limitation', 'expiry']
export const SHORT = { issue: 'Issued', response_due: 'Due', hearing: 'Hearing', limitation: 'Limit', submission: 'Filed', expiry: 'Expires' }

export const NO_FILTERS = { module: 'all', types: [], statuses: [], client: '', from: '', to: '', q: '' }

// Colours: module (Income Tax blue, GST purple, DSC slate); Pending deadline due within a week -> amber; Overdue red; Completed green.
// Colour is never the only cue: every row starts with its type, and issue dates are drawn dashed.
export const COLOURS = { blue: '#2563eb', purple: '#7c3aed', teal: '#0d9488', amber: '#d97706', red: '#dc2626', green: '#16a34a', slate: '#334155' }
export function colourOf(e) {
  if (e.module === 'SUB') return COLOURS.teal // a submission is a completed action: its own colour, never red/amber/green
  if (e.status === 'Overdue') return COLOURS.red
  if (e.status === 'Completed') return COLOURS.green
  if (DEADLINE_TYPES.includes(e.event_type) && e.days_left >= 0 && e.days_left <= 7) return COLOURS.amber
  return e.module === 'GST' ? COLOURS.purple : e.module === 'DSC' ? COLOURS.slate : COLOURS.blue
}
export const LEGEND = [[COLOURS.blue, 'Income Tax'], [COLOURS.purple, 'GST Notice'], [COLOURS.teal, 'GST Submission'], [COLOURS.slate, 'DSC'],
  [COLOURS.amber, 'Due within 7 days'], [COLOURS.red, 'Overdue'], [COLOURS.green, 'Completed']]

const SEARCH_FIELDS = ['title', 'customer_name', 'notice_ref', 'arn', 'identifier', 'box_slot']
// AND between dimensions, OR inside a multi-select (empty selection = no restriction).
export function applyFilters(events, f) {
  const needle = (f.q || '').trim().toLowerCase()
  return events.filter((e) =>
    (f.module === 'all' || inModule(e, f.module)) &&
    (!f.types.length || f.types.includes(e.event_type)) &&
    (!f.statuses.length || f.statuses.includes(e.status)) &&
    (!f.client || e.customer_name === f.client) &&
    (!f.from || e.event_date >= f.from) && (!f.to || e.event_date <= f.to) &&
    (!needle || SEARCH_FIELDS.some((k) => String(e[k] || '').toLowerCase().includes(needle))))
}
export const activeCount = (f) => (f.q.trim() ? 1 : 0) + (f.client ? 1 : 0) + (f.module !== 'all' ? 1 : 0) + f.types.length + f.statuses.length + (f.from ? 1 : 0) + (f.to ? 1 : 0)

// "Upcoming": open deadlines still ahead (pending, not issue dates).
export const upcoming = (events) => events.filter((e) => DEADLINE_TYPES.includes(e.event_type) && e.status === 'Pending').sort(byDate)
export const byDate = (a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title)

export const statusText = (e) => e.status_label || e.status // a DSC past its expiry reads "Expired", not "Overdue"

export function daysText(e) {
  if (e.event_type === 'issue' || e.event_type === 'submission') return null
  if (e.status === 'Completed' || e.status === 'Cancelled') return null
  const n = e.days_left
  if (e.event_type === 'expiry') {
    if (n < 0) return `Expired ${-n} day${n === -1 ? '' : 's'} ago`
    if (n === 0) return 'Expires today'
    return n === 1 ? 'Expires tomorrow' : `Expires in ${n} days`
  }
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`
  if (n === 0) return 'Due today'
  return n === 1 ? 'Due tomorrow' : `In ${n} days`
}

// Counts for the home screen: deadlines only (issue dates are information, GST submissions are completed actions).
export function summarize(events, today) {
  const deadlines = events.filter((e) => DEADLINE_TYPES.includes(e.event_type))
  const count = (list) => ({
    overdue: list.filter((e) => e.status === 'Overdue').length,
    pending: list.filter((e) => e.status === 'Pending').length,
    completed: list.filter((e) => e.status === 'Completed').length,
  })
  const by = {}
  for (const [k] of MODULES.slice(1)) by[k] = count(deadlines.filter((e) => inModule(e, k)))
  return {
    ...count(deadlines),
    today: deadlines.filter((e) => e.status === 'Pending' && e.event_date === today).sort(byDate),
    overdueList: deadlines.filter((e) => e.status === 'Overdue').sort((a, b) => b.event_date.localeCompare(a.event_date)),
    next: deadlines.filter((e) => e.status === 'Pending' && e.event_date > today).sort(byDate),
    by,
  }
}
