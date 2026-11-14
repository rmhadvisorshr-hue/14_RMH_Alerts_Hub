import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_CLOUD_API_URL
  if (!url) throw new Error(`VITE_CLOUD_API_URL is not set. Copy .env.example to .env.${mode} and fill it in.`)
  // Production must never point at a local/LAN server (the live-reload URL is injected by `cap run -l`, not by this file).
  if (mode === 'production' && /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|^http:/.test(url))
    throw new Error(`Production VITE_CLOUD_API_URL must be an https:// public URL, got ${url}`)
  const version = JSON.parse(readFileSync('./package.json', 'utf8')).version // only the version goes into the bundle, not the dev scripts
  return { base: './', plugins: [react(), tailwindcss()], define: { __APP_VERSION__: JSON.stringify(version) }, server: { port: 5173, strictPort: true } }
})
