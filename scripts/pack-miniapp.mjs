// Packs miniapp/ into dist/<appId>-<version>.asar (docs/design.md #5) and prints its sha256.
// version_code is the local build time, YYMMDDHHmmss, written into miniapp.json and package.json.
import { createPackage } from '@electron/asar'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const path = (relative) => fileURLToPath(new URL(relative, root))
const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const versionCode = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].map(pad).join('')

const stamp = async (file) => {
  const json = JSON.parse(await readFile(path(file), 'utf8'))
  json.version_code = versionCode
  await writeFile(path(file), `${JSON.stringify(json, null, 2)}\n`)
  return json
}

const manifest = await stamp('miniapp/miniapp.json')
await stamp('package.json')
if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(manifest.appId)) throw new Error(`appId must be lowercase reverse-domain: ${manifest.appId}`)
const entry = manifest.entry ?? 'index.html'
await stat(path(`miniapp/${entry}`)).catch(() => { throw new Error(`entry ${entry} is not in miniapp/`) })

const staging = path('dist/miniapp')
await rm(staging, { recursive: true, force: true })
await mkdir(path('dist'), { recursive: true })
await cp(path('miniapp'), staging, { recursive: true })
const out = path(`dist/${manifest.appId}-${manifest.version}.asar`)
await createPackage(staging, out)
const sha256 = createHash('sha256').update(await readFile(out)).digest('hex')
console.log(`${out}\nversion_code ${versionCode}\nsha256 ${sha256}`)
