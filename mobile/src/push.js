// Firebase push on the phone. Safe no-ops in a plain browser. The FCM token is registered with the Hub, tied to the login.
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { cloud, store } from './api.js'
import { KEYS } from './config.js'

const label = () => 'Android ' + (navigator.userAgent.match(/Android [\d.]+; ([^)]+)\)/)?.[1] || '')
export const isNative = () => Capacitor.isNativePlatform()

// 'granted' | 'denied' | 'prompt' | 'unsupported'
export async function pushPermission() {
  if (!isNative()) return 'unsupported'
  try { return (await PushNotifications.checkPermissions()).receive } catch { return 'unsupported' }
}

// Ask for permission (Android 13+ shows the system dialog once; after a refusal only the system settings can change it).
export async function requestPermission() {
  if (!isNative()) return 'unsupported'
  const r = await PushNotifications.requestPermissions()
  if (r.receive === 'granted') await PushNotifications.register()
  return r.receive
}

// onTap(data): the data the Hub put in the push (notification_id, module, record_type, record_id).
export async function enablePush({ onTap, onForeground }) {
  if (!isNative()) return
  await PushNotifications.removeAllListeners()
  await PushNotifications.addListener('registration', async ({ value }) => {
    try {
      const r = await cloud('/devices/register', { method: 'POST', body: { fcm_token: value, device_label: label() } })
      store.set(value, KEYS.fcm); store.set(String(r.id), KEYS.deviceId)
    } catch { /* retried on next app start */ }
  })
  await PushNotifications.addListener('registrationError', (e) => console.warn('FCM registration failed', e))
  await PushNotifications.addListener('pushNotificationReceived', (n) => onForeground(n)) // app open
  await PushNotifications.addListener('pushNotificationActionPerformed', (a) => onTap(a.notification.data || {})) // tapped
  if ((await pushPermission()) === 'granted') await PushNotifications.register()
  else await requestPermission()
}

// Session expired on the server: nothing to tell it, just forget the local registration.
export function forgetDevice() { store.set('', KEYS.fcm); store.set('', KEYS.deviceId) }

// Logout: tell the Hub to stop sending to this phone.
export function unregisterThisDevice() {
  const f = store.get(KEYS.fcm)
  if (f) cloud('/devices/unregister', { method: 'POST', body: { fcm_token: f } }).catch(() => {})
  store.set('', KEYS.fcm); store.set('', KEYS.deviceId)
}
