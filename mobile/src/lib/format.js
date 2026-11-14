const pad2 = (n) => String(n).padStart(2, '0')

// DD/MM/YYYY, same as the web app. A plain "YYYY-MM-DD" is rearranged (no timezone shift); a timestamp is shown in local time.
export function fmtDMY(v) {
  if (!v) return ''
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}
export const fmtDay = (iso, withYear = true) => { const f = fmtDMY(iso); return withYear ? f : f.slice(0, 5) }

// Calendar-date arithmetic on YYYY-MM-DD strings (UTC maths, so there are no daylight-saving or timezone surprises).
const toUtc = (iso) => new Date(`${iso}T00:00:00Z`)
export const isoOf = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
export const addDays = (iso, n) => { const d = toUtc(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d) }
export const addMonths = (iso, n) => {
  const d = toUtc(iso)
  const day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return isoOf(d)
}
export const monthRange = (iso) => [iso.slice(0, 8) + '01', isoOf(new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)))]
export const weekRange = (iso) => { const s = addDays(iso, -toUtc(iso).getUTCDay()); return [s, addDays(s, 6)] } // Sunday-first, like FullCalendar's default
export const todayLocalIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}` }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const monthTitle = (iso) => `${LONG[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
export const dayTitle = (iso) => `${DAYS[toUtc(iso).getUTCDay()]}, ${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
export function weekTitle(iso) {
  const [a, b] = weekRange(iso)
  const m = (x) => MONTHS[+x.slice(5, 7) - 1]
  return a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)} – ${+b.slice(8)} ${m(a)} ${a.slice(0, 4)}` : `${+a.slice(8)} ${m(a)} – ${+b.slice(8)} ${m(b)} ${b.slice(0, 4)}`
}

// "just now", "5 min ago", "3 h ago", "yesterday", otherwise the date.
export function ago(isoTime, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(isoTime).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`
  if (mins < 60 * 48) return 'yesterday'
  return fmtDMY(isoTime)
}
export const badgeText = (n) => (n > 99 ? '99+' : String(n))
