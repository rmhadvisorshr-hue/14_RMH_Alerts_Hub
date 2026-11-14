import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CalendarDays, Home, Settings } from 'lucide-react'
import Login from './Login.jsx'
import { api, onAuthFailure, store } from './api.js'
import { enablePush, forgetDevice, unregisterThisDevice } from './push.js'
import { DataProvider, useData } from './store.jsx'
import { NavProvider } from './nav.jsx'
import { resolveTarget } from './lib/target.js'
import { badgeText } from './lib/format.js'
import { EventSheet } from './components/EventViews.jsx'
import { Banner } from './components/ui.jsx'
import HomeScreen from './screens/HomeScreen.jsx'
import CalendarScreen from './screens/CalendarScreen.jsx'
import NotificationsScreen, { NotificationDetail } from './screens/NotificationsScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'
import DscScreen from './screens/DscScreen.jsx'

const TABS = [['home', 'Home', Home], ['calendar', 'Calendar', CalendarDays], ['notifications', 'Notifications', Bell], ['settings', 'Settings', Settings]]

function Shell({ onLogout }) {
  const { cal, unread, loadUnread, refreshAll } = useData()
  const [tab, setTab] = useState('home')
  const [visited, setVisited] = useState({ home: true })
  const [intent, setIntent] = useState(null)
  const [event, setEvent] = useState(null)
  const [dsc, setDsc] = useState(null) // { serial?, tab? }
  const [detail, setDetail] = useState(null)
  const [banner, setBanner] = useState(null)
  const events = useRef([])
  events.current = cal.events

  const goTab = useCallback((t) => { setTab(t); setVisited((v) => ({ ...v, [t]: true })) }, [])
  const openCalendar = useCallback((i = {}) => { setIntent({ ...i, nonce: Date.now() }); goTab('calendar') }, [goTab])

  // Open what a notification is about: a DSC record, a notice's calendar event, or its own detail. Opening marks it read.
  const openNotification = useCallback((n) => {
    if (n.is_read === false) api.markRead(n.id).then(loadUnread).catch(() => {})
    const t = resolveTarget(n, events.current)
    if (t.kind === 'event') setEvent(t.event)
    else if (t.kind === 'dsc') setDsc({ serial: t.serial })
    else setDetail(n)
  }, [loadUnread])

  // A tapped push carries only ids: load fresh data, then route like an in-app tap.
  const onPushTap = useCallback(async (d) => {
    if (d.module === 'dsc' && !d.record_type) { setDsc({ tab: 'expiring' }); return } // push from an app version before the Hub
    try {
      if (d.notification_id) api.markRead(d.notification_id).then(loadUnread).catch(() => {})
      const fresh = (await api.events()).events
      const t = resolveTarget({ record_type: d.record_type, record_id: d.record_id }, fresh)
      if (t.kind === 'event') setEvent(t.event)
      else if (t.kind === 'dsc') setDsc({ serial: t.serial })
      else goTab('notifications')
    } catch { goTab('notifications') }
  }, [goTab, loadUnread])

  useEffect(() => {
    enablePush({ onTap: onPushTap, onForeground: (n) => { setBanner(`${n.title}\n${n.body}`); refreshAll() } }).catch((e) => console.warn('push setup failed', e))
  }, [onPushTap, refreshAll])
  useEffect(() => { if (banner) { const t = setTimeout(() => setBanner(null), 8000); return () => clearTimeout(t) } }, [banner])

  const nav = { goTab, openCalendar, openNotification, openEvent: setEvent, openDsc: (serial) => setDsc({ serial }) }

  return (
    <NavProvider value={nav}>
      <div className="mx-auto min-h-screen max-w-xl bg-slate-50 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
        {banner && <div className="fixed inset-x-0 top-[env(safe-area-inset-top)] z-50 mx-auto max-w-xl pt-2"><button onClick={() => { setBanner(null); goTab('notifications') }} className="block w-full whitespace-pre-line text-left"><Banner tone="amber">{banner}</Banner></button></div>}
        {tab === 'home' && <HomeScreen />}
        {visited.calendar && <div className={tab === 'calendar' ? '' : 'hidden'}><CalendarScreen intent={intent} /></div>}
        {tab === 'notifications' && <NotificationsScreen />}
        {tab === 'settings' && <SettingsScreen onLogout={onLogout} />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-xl">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} onClick={() => goTab(k)} aria-current={tab === k ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${tab === k ? 'text-blue-600' : 'text-slate-500'}`}>
              <Icon size={21} strokeWidth={tab === k ? 2.4 : 1.8} />
              {label}
              {k === 'notifications' && unread.total > 0 && (
                <span className="absolute left-1/2 top-1 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{badgeText(unread.total)}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {event && <EventSheet event={event} onClose={() => setEvent(null)} />}
      {detail && <NotificationDetail n={detail} onClose={() => setDetail(null)} />}
      {dsc && <DscScreen serial={dsc.serial} tab={dsc.tab} onClose={() => setDsc(null)} />}
    </NavProvider>
  )
}

export default function App() {
  const [token, setToken] = useState(store.get())
  const end = useCallback(() => { store.set(''); setToken('') }, [])
  useEffect(() => { onAuthFailure(() => { forgetDevice(); end() }) }, [end])

  if (!token) {
    return <Login onSubmit={async (email, password) => {
      const r = await api.login(email, password)
      store.set(r.token); setToken(r.token)
    }} />
  }
  return <DataProvider><Shell onLogout={() => { unregisterThisDevice(); end() }} /></DataProvider>
}
