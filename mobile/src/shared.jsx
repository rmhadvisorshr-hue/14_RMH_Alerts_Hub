export { TABS, whatsappUrl, filterRecords, failText } from './lib/dsc.js'

export const BADGE = {
  Active: 'bg-green-100 text-green-800',
  'Expiring Soon': 'bg-amber-100 text-amber-800',
  Expired: 'bg-red-100 text-red-800',
}
export const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export function Badge({ status, children }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[status] || 'bg-slate-100 text-slate-700'}`}>{children ?? status}</span>
}
