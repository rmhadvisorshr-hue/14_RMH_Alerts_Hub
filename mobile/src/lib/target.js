// Where does a notification lead? Pure, so it can be tested without a phone.
//   dsc notification   -> the DSC record (if it still exists)
//   notice notification -> the calendar event of that notice (the deadline the notification is about), if the calendar has one
//   anything else      -> the notification's own detail (never a dead link)
import { DEADLINE_TYPES } from './calendarUi.js'

export function resolveTarget(n, events) {
  if (n.record_type === 'dsc') return n.record_available === false ? { kind: 'detail' } : { kind: 'dsc', serial: n.record_id }
  if (n.record_type === 'notice' && n.record_id) {
    const mine = events.filter((e) => e.notice_id === n.record_id)
    // the deadline the notification names, else the next open deadline, else any event of the notice
    const pick = mine.find((e) => DEADLINE_TYPES.includes(e.event_type) && e.event_date === n.event_date)
      || mine.filter((e) => DEADLINE_TYPES.includes(e.event_type)).sort((a, b) => a.event_date.localeCompare(b.event_date))[0]
      || mine[0]
    if (pick) return { kind: 'event', event: pick }
  }
  return { kind: 'detail' }
}

export const MODULE_NAME = { income_tax: 'Income Tax', gst: 'GST', dsc: 'DSC' }
export const CATEGORY_NAME = { reminder: 'Reminder', new_notice: 'New notice', due_changed: 'Date changed', expired: 'Expired' }
