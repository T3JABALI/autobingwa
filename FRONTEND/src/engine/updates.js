import { App } from '@capacitor/app'
import { AutoBingwa, isNative } from './native.js'

export const UPDATE_URL = 'https://YOUR-DOMAIN/autobingwa/version.json'
const CACHE_KEY = 'update:last'

// The version installed on this phone. "build" is the Android versionCode.
export async function getCurrentVersion() {
  if (!isNative()) return { name: 'web preview', code: 0 }
  try {
    const i = await App.getInfo()
    return { name: i.version, code: Number(i.build) || 0 }
  } catch (e) {
    console.error('AB version', e)
    return { name: 'unknown', code: 0 }
  }
}

export async function checkForUpdate() {
  const current = await getCurrentVersion()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  let data
  try {
    const res = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) throw new Error(`The update server answered ${res.status}`)
    data = await res.json()
  } catch (e) {
    throw new Error(
      e && e.name === 'AbortError'
        ? 'The update server did not answer. Check your internet connection.'
        : `Could not check for updates: ${e && e.message ? e.message : e}`
    )
  } finally {
    clearTimeout(timer)
  }

  const code = Number(data.versionCode)
  const sha = String(data.sha256 || '').toLowerCase().replace(/\s/g, '')
  if (!Number.isFinite(code) || !/^https:\/\//.test(String(data.apkUrl || '')) || !/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error('The update information is not valid.')
  }
  const latest = {
    code,
    name: String(data.versionName || code),
    apkUrl: String(data.apkUrl),
    sha256: sha,
    notes: Array.isArray(data.notes) ? data.notes.map(String) : data.notes ? [String(data.notes)] : [],
    mandatory: Boolean(data.mandatory),
  }
  const result = { current, latest, available: code > current.code, checkedAt: Date.now() }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)) } catch (e) { /* storage full */ }
  return result
}

// Downloads the APK (checked against the hash), then opens the Android installer
export async function installUpdate(latest, onProgress = () => {}) {
  if (!isNative()) throw new Error('Installing updates only works inside the Android app.')
  const handle = await AutoBingwa.addListener('updateProgress', (e) => onProgress(Number(e.percent) || 0))
  try {
    await AutoBingwa.downloadApk({ url: latest.apkUrl, sha256: latest.sha256 })
  } finally {
    if (handle && handle.remove) handle.remove()
  }
  await AutoBingwa.installApk()
}

// Same as installUpdate, but returns { ok, message } instead of throwing
export async function runInstall(latest, onProgress) {
  try {
    await installUpdate(latest, onProgress)
    return { ok: true, message: 'The Android installer is open. Tap Install there to finish updating.' }
  } catch (e) {
    const m = String(e && e.message ? e.message : e)
    if (m === 'needs_permission') {
      return { ok: false, message: 'Allow AutoBingwa to install apps in the settings screen that just opened, then press Install again.' }
    }
    return { ok: false, message: m }
  }
}