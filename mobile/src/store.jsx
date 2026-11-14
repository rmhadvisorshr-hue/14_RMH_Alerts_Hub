import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { todayLocalIso } from './lib/format.js'

// App-wide data every tab needs: calendar events (one fetch shared by Home and Calendar) and the unread count.
const Ctx = createContext(null)
export const useData = () => useContext(Ctx)

export function DataProvider({ children }) {
  const [cal, setCal] = useState({ status: 'loading', events: [], sources: {}, today: todayLocalIso(), error: '' })
  const [unread, setUnread] = useState({ total: 0, by_module: {} })
  const [version, setVersion] = useState(0) // bumped when notifications change, so lists reload
  const busy = useRef(false)

  const loadEvents = useCallback(async () => {
    try {
      const r = await api.events()
      setCal({ status: 'ok', events: r.events, sources: r.sources, today: r.today, error: '' })
    } catch (e) {
      const outdated = e.status === 404 // the server answered but has no /calendar/events: it is running a pre-Hub build
      setCal((c) => ({ ...c, status: 'error', error: outdated ? 'The Alerts Hub server is running an older version without the unified calendar. Deploy the updated cloud_api, then retry.' : e.message }))
    }
  }, [])
  const loadUnread = useCallback(async () => { try { setUnread(await api.unread()) } catch { /* the badge just stays as it was */ } }, [])
  // Pull Notice Alert's newest notifications into the Hub, then reload what the screens show.
  const refreshAll = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      await api.refreshNotifications().catch(() => {})
      await Promise.all([loadEvents(), loadUnread()])
      setVersion((v) => v + 1)
    } finally { busy.current = false }
  }, [loadEvents, loadUnread])

  useEffect(() => {
    refreshAll()
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshAll])

  const value = useMemo(() => ({ cal, unread, version, loadEvents, loadUnread, refreshAll }), [cal, unread, version, loadEvents, loadUnread, refreshAll])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
