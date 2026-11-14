import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_FILTERS, applyFilters, activeCount, colourOf, COLOURS, daysText, summarize, upcoming, statusText } from '../src/lib/calendarUi.js'
import { addDays, addMonths, monthRange, weekRange, weekTitle, fmtDMY, ago } from '../src/lib/format.js'
import { resolveTarget } from '../src/lib/target.js'
import { filterRecords, whatsappUrl } from '../src/lib/dsc.js'

const ev = (o) => ({ id: 'x', module: 'IT', event_type: 'response_due', event_date: '2026-11-20', title: 'T', status: 'Pending', days_left: 10, customer_name: 'Asha', ...o })
const F = (o) => ({ ...NO_FILTERS, ...o })

test('colours follow the web calendar: overdue red, completed green, due within 7 days amber, else module', () => {
  assert.equal(colourOf(ev({ status: 'Overdue', days_left: -2 })), COLOURS.red)
  assert.equal(colourOf(ev({ status: 'Completed' })), COLOURS.green)
  assert.equal(colourOf(ev({ days_left: 7 })), COLOURS.amber)
  assert.equal(colourOf(ev({ module: 'GST' })), COLOURS.purple)
  assert.equal(colourOf(ev({ module: 'IT' })), COLOURS.blue)
  assert.equal(colourOf(ev({ module: 'SUB', status: 'Completed' })), COLOURS.teal)
  assert.equal(colourOf(ev({ module: 'DSC', event_type: 'expiry', days_left: 40 })), COLOURS.slate)
  assert.equal(colourOf(ev({ module: 'DSC', event_type: 'expiry', days_left: 3 })), COLOURS.amber)
  assert.equal(colourOf(ev({ event_type: 'issue', days_left: 3 })), COLOURS.blue) // issue dates are never "due soon"
})

test('GST filter includes GST submissions; DSC is its own module', () => {
  const list = [ev({ module: 'GST' }), ev({ module: 'SUB' }), ev({ module: 'IT' }), ev({ module: 'DSC', event_type: 'expiry' })]
  assert.deepEqual(applyFilters(list, F({ module: 'GST' })).map((e) => e.module), ['GST', 'SUB'])
  assert.deepEqual(applyFilters(list, F({ module: 'DSC' })).map((e) => e.module), ['DSC'])
})

test('filters AND across dimensions, OR inside a multi-select, and Clear restores everything', () => {
  const list = [ev({ id: 'a' }), ev({ id: 'b', event_type: 'issue', status: 'Completed' }), ev({ id: 'c', event_type: 'hearing', customer_name: 'Ravi' })]
  assert.deepEqual(applyFilters(list, F({ types: ['issue', 'hearing'] })).map((e) => e.id), ['b', 'c'])
  assert.deepEqual(applyFilters(list, F({ types: ['issue', 'hearing'], client: 'Ravi' })).map((e) => e.id), ['c'])
  assert.deepEqual(applyFilters(list, F({ statuses: ['Completed'] })).map((e) => e.id), ['b'])
  assert.equal(applyFilters(list, NO_FILTERS).length, 3)
  assert.equal(activeCount(NO_FILTERS), 0)
  assert.equal(activeCount(F({ q: 'x', client: 'Ravi', module: 'IT', types: ['issue'], from: '2026-01-01' })), 5)
})

test('date range and search by client, notice reference, ARN, identifier, box/slot', () => {
  const list = [ev({ id: 'a', event_date: '2026-11-01', notice_ref: 'AB-123' }), ev({ id: 'b', event_date: '2026-12-01', identifier: '27ABCDE1234F1Z5' }),
    ev({ id: 'c', event_date: '2026-12-05', module: 'DSC', box_slot: 'B2-S4' })]
  assert.deepEqual(applyFilters(list, F({ from: '2026-11-15', to: '2026-12-02' })).map((e) => e.id), ['b'])
  assert.deepEqual(applyFilters(list, F({ q: 'ab-123' })).map((e) => e.id), ['a'])
  assert.deepEqual(applyFilters(list, F({ q: '1234f1z5' })).map((e) => e.id), ['b'])
  assert.deepEqual(applyFilters(list, F({ q: 'b2-s4' })).map((e) => e.id), ['c'])
})

test('daysText and statusText', () => {
  assert.equal(daysText(ev({ days_left: -1, status: 'Overdue' })), '1 day overdue')
  assert.equal(daysText(ev({ days_left: 0 })), 'Due today')
  assert.equal(daysText(ev({ days_left: 1 })), 'Due tomorrow')
  assert.equal(daysText(ev({ event_type: 'issue' })), null)
  assert.equal(daysText(ev({ event_type: 'expiry', days_left: 1 })), 'Expires tomorrow')
  assert.equal(daysText(ev({ event_type: 'expiry', days_left: -3, status: 'Overdue' })), 'Expired 3 days ago')
  assert.equal(statusText(ev({ status: 'Overdue', status_label: 'Expired' })), 'Expired')
})

test('home summary counts deadlines only, per module', () => {
  const today = '2026-11-14'
  const list = [
    ev({ id: 'od', status: 'Overdue', event_date: '2026-11-10', days_left: -4 }),
    ev({ id: 'td', event_date: today, days_left: 0 }),
    ev({ id: 'nx', event_date: '2026-11-20', module: 'GST' }),
    ev({ id: 'done', status: 'Completed', module: 'GST' }),
    ev({ id: 'iss', event_type: 'issue', status: 'Completed' }),
    ev({ id: 'sub', module: 'SUB', event_type: 'submission', status: 'Completed' }),
    ev({ id: 'dsc', module: 'DSC', event_type: 'expiry', event_date: '2026-12-01' }),
  ]
  const s = summarize(list, today)
  assert.deepEqual([s.overdue, s.pending, s.completed], [1, 3, 1])
  assert.deepEqual(s.today.map((e) => e.id), ['td'])
  assert.deepEqual(s.next.map((e) => e.id), ['nx', 'dsc'])
  assert.deepEqual(s.by.GST, { overdue: 0, pending: 1, completed: 1 })
  assert.deepEqual(s.by.DSC, { overdue: 0, pending: 1, completed: 0 })
  assert.deepEqual(upcoming(list).map((e) => e.id), ['td', 'nx', 'dsc'])
})

test('date maths', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15')
  assert.deepEqual(monthRange('2026-02-10'), ['2026-02-01', '2026-02-28'])
  assert.deepEqual(weekRange('2026-11-14'), ['2026-11-08', '2026-11-14']) // Sunday-first; 14 Nov 2026 is a Saturday
  assert.equal(weekTitle('2026-11-14'), '8 – 14 Nov 2026')
  assert.equal(weekTitle('2026-12-30'), '27 Dec – 2 Jan 2027')
  assert.equal(fmtDMY('2026-11-05'), '05/11/2026')
  assert.equal(ago('2026-11-14T10:00:00Z', Date.parse('2026-11-14T10:05:00Z')), '5 min ago')
})

test('notification targets: DSC record, notice event, or its own detail - never a dead link', () => {
  const events = [ev({ id: 'e1', notice_id: 'n1', event_date: '2026-12-01' }), ev({ id: 'e0', notice_id: 'n1', event_type: 'issue', event_date: '2026-10-01' }),
    ev({ id: 'e2', notice_id: 'n1', event_type: 'hearing', event_date: '2026-12-10' })]
  assert.deepEqual(resolveTarget({ record_type: 'dsc', record_id: 'S1', record_available: true }, events), { kind: 'dsc', serial: 'S1' })
  assert.deepEqual(resolveTarget({ record_type: 'dsc', record_id: 'S1', record_available: false }, events), { kind: 'detail' })
  assert.equal(resolveTarget({ record_type: 'notice', record_id: 'n1', event_date: '2026-12-01' }, events).event.id, 'e1')
  assert.equal(resolveTarget({ record_type: 'notice', record_id: 'n1', event_date: '2026-12-05' }, events).event.id, 'e1') // next open deadline
  assert.deepEqual(resolveTarget({ record_type: 'notice', record_id: 'gone' }, events), { kind: 'detail' })
  assert.deepEqual(resolveTarget({ record_type: '', record_id: '' }, events), { kind: 'detail' })
})

test('existing DSC list behaviour is unchanged', () => {
  const recs = [{ holder_name: 'Asha', box_slot: 'B1-S1', serial_number: 'S1', expiry_status: 'Expiring Soon', status: 'In Office' },
    { holder_name: 'Ravi', box_slot: 'B2-S2', serial_number: 'S2', expiry_status: 'Expired', status: 'Handed to Client' }]
  assert.deepEqual(filterRecords(recs, 'asha', 'all').map((r) => r.serial_number), ['S1'])
  assert.deepEqual(filterRecords(recs, '', 'expired').map((r) => r.serial_number), ['S2'])
  assert.deepEqual(filterRecords(recs, '', 'in_office').map((r) => r.serial_number), ['S1'])
  assert.match(whatsappUrl({ client_phone: '98765 43210', holder_name: 'Asha', days_remaining: 3, expiry_date: '2026-11-17' }), /^https:\/\/wa\.me\/919876543210\?text=/)
})
