// Fails the build if development settings leaked into a production artifact.
// Usage: node scripts/check-prod.mjs dist | android
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]
const root = target === 'android' ? '../android/app/src/main/assets' : target
const BAD = /localhost:5173|10\.0\.2\.2|192\.168\.\d+\.\d+|"cleartext"\s*:\s*true|"server"\s*:\s*\{[^}]*"url"/
const bad = []
const walk = (d) => readdirSync(d).forEach((n) => {
  const p = join(d, n)
  if (statSync(p).isDirectory()) return walk(p)
  if (/\.(js|html|json|css)$/.test(n) && BAD.test(readFileSync(p, 'utf8'))) bad.push(p)
})
if (!existsSync(root)) { console.error(`check-prod: ${root} not found`); process.exit(1) }
walk(root)
if (bad.length) { console.error('check-prod FAILED - dev/live-reload settings found in:\n  ' + bad.join('\n  ')); process.exit(1) }
console.log(`check-prod OK (${target})`)
