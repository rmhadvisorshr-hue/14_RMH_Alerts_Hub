// DSC Tracker list rules, moved unchanged from shared.jsx so they can be tested without a bundler.
export const TABS = [['all', 'All'], ['expiring', 'Expiring Soon'], ['expired', 'Expired'], ['in_office', 'In Office']]

export function whatsappUrl(r) {
  let p = (r.client_phone || '').replace(/\D/g, '')
  if (p.length === 10) p = '91' + p
  const when = r.days_remaining < 0 ? `expired on ${r.expiry_date}` : `expires on ${r.expiry_date}`
  const text = `Dear ${r.holder_name}, your Digital Signature Certificate (DSC) ${when}. Please contact RMH Advisors to renew it. Thank you.`
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export function filterRecords(records, q, tab) {
  const s = q.toLowerCase().trim()
  return records.filter((r) =>
    (!s || [r.holder_name, r.box_slot, r.serial_number].some((v) => (v || '').toLowerCase().includes(s))) &&
    (tab === 'all' ||
      (tab === 'expiring' && r.expiry_status === 'Expiring Soon') ||
      (tab === 'expired' && r.expiry_status === 'Expired') ||
      (tab === 'in_office' && r.status === 'In Office')))
}

// FastAPI error body -> readable message
export async function failText(res) {
  const d = (await res.json().catch(() => ({}))).detail
  return Array.isArray(d) ? d.map((e) => e.msg).join('; ') : d || res.statusText
}
