import { CLOUD, KEYS } from './config.js'
import { failText } from './lib/dsc.js'

export const store = {
  get: (k = KEYS.token) => { try { return localStorage.getItem(k) || '' } catch { return '' } },
  set: (v, k = KEYS.token) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* storage blocked */ } },
}
export const netMsg = (e) => (e.message === 'Failed to fetch' ? 'No internet connection' : e.message)

let authFailed = () => {}
export const onAuthFailure = (fn) => { authFailed = fn }
let ending = false // several calls can fail at once; end the session once

// All calls to the Alerts Hub API. A 401/403 on an authenticated call ends the session (token expired or revoked).
export async function cloud(path, { method = 'GET', body, token = store.get() } = {}) {
  let res
  try {
    res = await fetch(CLOUD + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) } })
  } catch (e) { throw new Error(netMsg(e)) }
  if (!res.ok) {
    const err = Object.assign(new Error(await failText(res)), { status: res.status })
    if ((res.status === 401 || res.status === 403) && token && !ending) { ending = true; authFailed(); setTimeout(() => { ending = false }, 1000) }
    throw err
  }
  return res.json()
}

export const api = {
  login: (email, password) => cloud('/auth/login', { method: 'POST', body: { email, password }, token: '' }),
  me: () => cloud('/auth/me'),
  records: () => cloud('/records'),
  events: () => cloud('/calendar/events'),
  modules: () => cloud('/modules'),
  notifications: (p) => cloud('/notifications?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null))),
  unread: () => cloud('/notifications/unread-count'),
  markRead: (id) => cloud(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: (module) => cloud('/notifications/read-all' + (module ? `?module=${module}` : ''), { method: 'POST' }),
  refreshNotifications: () => cloud('/notifications/refresh', { method: 'POST' }),
  prefs: () => cloud('/preferences'),
  savePrefs: (patch) => cloud('/preferences', { method: 'PUT', body: patch }),
  devices: () => cloud('/devices'),
  removeDevice: (id) => cloud(`/devices/${id}`, { method: 'DELETE' }),
  testPush: () => cloud('/notifications/test', { method: 'POST' }),
}
