// The one place for environment-specific configuration (see vite.config.js for the production guard).
export const CLOUD = (import.meta.env.VITE_CLOUD_API_URL || '').replace(/\/$/, '')
export const APP_VERSION = __APP_VERSION__ // injected by vite.config.js
// Storage keys kept from the DSC-only app so an update does not log anyone out.
export const KEYS = { token: 'dsc_token', fcm: 'dsc_fcm', deviceId: 'rmh_device_id' }
