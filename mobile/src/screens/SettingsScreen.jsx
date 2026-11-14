import { useCallback, useEffect, useState } from 'react'
import { BellRing, LogOut, Smartphone, Trash2 } from 'lucide-react'
import { api, store } from '../api.js'
import { APP_VERSION, CLOUD, KEYS } from '../config.js'
import { isNative, pushPermission, requestPermission } from '../push.js'
import { ago } from '../lib/format.js'
import { Badge, Banner, Chip, ErrorState, Section, Spinner, Switch } from '../components/ui.jsx'

const DAYS = [30, 15, 10, 7, 5, 1, 0]
const dayLabel = (d) => (d === 0 ? 'On due date' : d === 1 ? '1 day' : `${d} days`)
const SOURCE_TONE = { ok: 'green', not_configured: 'amber', unauthorized: 'red', unreachable: 'red', error: 'red' }
const SOURCE_TEXT = { ok: 'Connected', not_configured: 'Not connected yet', unauthorized: 'Sign-in rejected', unreachable: 'Unreachable', error: 'Error' }
const card = 'mx-4 overflow-hidden rounded-xl border border-slate-200 bg-white'

function Row({ label, children }) {
  return <div className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]"><span className="text-slate-500">{label}</span><span className="min-w-0 truncate text-right font-medium text-slate-900">{children}</span></div>
}

export default function SettingsScreen({ onLogout }) {
  const [data, setData] = useState({ status: 'loading', error: '' })
  const [me, setMe] = useState('')
  const [prefs, setPrefs] = useState(null)
  const [mods, setMods] = useState([])
  const [devices, setDevices] = useState([])
  const [perm, setPerm] = useState('unsupported')
  const [msg, setMsg] = useState('')
  const thisDevice = store.get(KEYS.deviceId)

  const load = useCallback(async () => {
    try {
      const [m, p, mo, d] = await Promise.all([api.me(), api.prefs(), api.modules(), api.devices()])
      setMe(m.email); setPrefs(p); setMods(mo.modules); setDevices(d)
      setPerm(await pushPermission())
      setData({ status: 'ok', error: '' })
    } catch (e) { setData({ status: 'error', error: e.message }) }
  }, [])
  useEffect(() => { load() }, [load])

  // Saved on the Hub for this login the moment it changes; the UI follows the server's answer, never its own guess.
  async function save(patch) {
    setMsg('')
    const before = prefs
    setPrefs({ ...prefs, modules: { ...prefs.modules, ...patch.modules }, reminder_days: { ...prefs.reminder_days, ...patch.reminder_days } })
    try { setPrefs(await api.savePrefs(patch)) } catch (e) { setPrefs(before); setMsg(`Could not save: ${e.message}`) }
  }
  const toggleDay = (m, d) => {
    const cur = prefs.reminder_days[m]
    save({ reminder_days: { [m]: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d] } })
  }
  async function remove(d) {
    if (!window.confirm(`Stop notifications to "${d.label}"?`)) return
    try { await api.removeDevice(d.id); setDevices(await api.devices()) } catch (e) { setMsg(e.message) }
  }
  async function allow() { setPerm(await requestPermission()) }
  async function test() {
    setMsg('')
    try { const r = await api.testPush(); setMsg(r.devices ? `Test sent to ${r.sent} of ${r.devices} device(s).` : 'No registered device to send to.') } catch (e) { setMsg(`Test failed: ${e.message}`) }
  }

  if (data.status === 'loading') return <Spinner />
  if (data.status === 'error') return <ErrorState message={`Could not load settings. ${data.error}`} onRetry={load} />

  return (
    <div className="pb-8">
      <header className="px-4 pb-1 pt-4"><h1 className="text-[20px] font-bold text-slate-900">Settings</h1></header>
      {msg && <div className="mt-2"><Banner tone="blue">{msg}</Banner></div>}

      <Section title="Account"><div className={`${card} divide-y divide-slate-100`}><Row label="Signed in as">{me}</Row></div></Section>

      <Section title="Notification preferences">
        <div className={`${card} divide-y divide-slate-100`}>
          <div className="px-4 py-3 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-900">Android notifications</span>
              <Badge tone={perm === 'granted' ? 'green' : perm === 'denied' ? 'red' : 'amber'}>{perm === 'granted' ? 'Allowed' : perm === 'denied' ? 'Blocked' : perm === 'unsupported' ? 'Not on this device' : 'Not asked yet'}</Badge>
            </div>
            {perm === 'prompt' && <button onClick={allow} className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white">Allow notifications</button>}
            {perm === 'denied' && <p className="mt-1.5 text-slate-500">Notifications are blocked for this app. Turn them on in Android Settings → Apps → RMH Advisors → Notifications. Until then nothing below can reach this phone.</p>}
            {perm === 'unsupported' && !isNative() && <p className="mt-1.5 text-slate-500">Push notifications only work in the installed Android app.</p>}
          </div>
          {mods.map((m) => {
            const on = prefs.modules[m.id]
            const supported = prefs.supported_reminder_days[m.id]
            return (
              <div key={m.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold text-slate-900">{m.label}</div><div className="text-[12px] text-slate-500">Push notifications from {m.source}</div></div>
                  <Switch on={on} label={`${m.label} notifications`} onChange={(v) => save({ modules: { [m.id]: v } })} />
                </div>
                <div className={`mt-2.5 ${on ? '' : 'opacity-50'}`}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Remind me</div>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((d) => <Chip key={d} on={prefs.reminder_days[m.id].includes(d)} disabled={!on || !supported.includes(d)} onClick={() => toggleDay(m.id, d)}>{dayLabel(d)}</Chip>)}
                  </div>
                  {supported.length < DAYS.length && <p className="mt-1.5 text-[11.5px] text-slate-400">{m.source} sends reminders at {supported.slice().sort((a, b) => b - a).join(', ')} days before; other intervals are not available for {m.label}.</p>}
                </div>
              </div>
            )
          })}
          <div className="px-4 py-3 text-[12px] text-slate-500">Turning a module off stops its push notifications only. Its events stay on the calendar and its notifications stay in your history.</div>
        </div>
      </Section>

      <Section title="Connected modules">
        <div className={`${card} divide-y divide-slate-100`}>
          {mods.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold text-slate-900">{m.label}</div>
                <div className="text-[12px] text-slate-500">via {m.source}{m.connection.status !== 'ok' && m.connection.message ? ` — ${m.connection.message}` : ''}</div></div>
              <Badge tone={SOURCE_TONE[m.connection.status]}>{SOURCE_TEXT[m.connection.status] || m.connection.status}</Badge>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Registered devices">
        <div className={`${card} divide-y divide-slate-100`}>
          {devices.length === 0 && <p className="px-4 py-4 text-[13px] text-slate-500">No device is registered for notifications.</p>}
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <Smartphone size={18} className="shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium text-slate-900">{d.label}{String(d.id) === thisDevice && <span className="ml-1.5 text-[11px] font-semibold text-blue-600">This device</span>}</div>
                <div className="text-[12px] text-slate-500">Last active {ago(d.last_seen)}</div></div>
              {String(d.id) !== thisDevice && <button onClick={() => remove(d)} aria-label={`Remove ${d.label}`} className="p-2 text-slate-400"><Trash2 size={16} /></button>}
            </div>
          ))}
          <div className="px-4 py-2.5"><button onClick={test} className="flex items-center gap-2 text-[13px] font-semibold text-blue-600"><BellRing size={15} />Send a test notification</button></div>
        </div>
      </Section>

      <Section title="App information">
        <div className={`${card} divide-y divide-slate-100`}>
          <Row label="Application">RMH Advisors – Internal</Row>
          <Row label="Version">{APP_VERSION}</Row>
          <Row label="Server">{CLOUD.replace(/^https?:\/\//, '')}</Row>
        </div>
      </Section>

      <div className="mt-6 px-4">
        <button onClick={onLogout} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-3 text-sm font-semibold text-red-600"><LogOut size={16} />Log out</button>
      </div>
    </div>
  )
}
