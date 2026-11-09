// Keeps a copy of the app's data inside the Android service, so the service can use it
// without the web view. Part 1: the copy only. Nothing is processed from it yet.
import { isNative, AutoBingwa } from './native.js'
import { loadConfig, readJson, CLIENTS_KEY, last9 } from './config.js'
import { loadFallback } from './fallbackStore.js'
import { loadWallet } from '../features/home/dataStore.js'

export function buildSnapshot() {
  const offers = readJson('myOffers', [])
  const blacklist = readJson(CLIENTS_KEY, [])
    .filter((c) => c && c.blacklisted)
    .map((c) => last9(c.phone))
    .filter((k) => k.length === 9)
  return {
    v: 1,
    offers: Array.isArray(offers) ? offers : [],
    config: loadConfig(),
    blacklist,
    wallet: loadWallet(),
    fallback: loadFallback(),
  }
}

// What the app itself holds, to compare with what the service received
export function localCounts() {
  const s = buildSnapshot()
  return {
    offers: s.offers.length,
    blacklist: s.blacklist.length,
    fallbackMappings: (s.fallback.mappings || []).length,
    units: Number(s.wallet.units) || 0,
  }
}

let last = ''

// Sends the copy when it has changed (or always, with force)
export async function syncNow(force = false) {
  if (!isNative()) return
  try {
    const json = JSON.stringify(buildSnapshot())
    if (!force && json === last) return
    await AutoBingwa.syncSnapshot({ json })
    last = json
  } catch (e) {
    console.error('AB sync', e)
  }
}

export async function engineStatus() {
  if (!isNative()) return null
  try {
    return await AutoBingwa.engineStatus()
  } catch (e) {
    console.error('AB engine status', e)
    return null
  }
}

export function startNativeSync() {
  if (!isNative()) return
  syncNow(true)
  const again = () => syncNow()
  window.addEventListener('autobingwa-data', again)
  window.addEventListener('storage', again)
  window.addEventListener('ab-tokens', again)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) again() })
  // Some pages save without announcing it, so also check every 5 seconds (only sends if something changed)
  setInterval(again, 5000)
}
// Turns the background engine on or off. Sends the newest copy of the app's data first.
export async function setNativeEngine(on) {
  await syncNow(true)
  const r = await AutoBingwa.setNativeEngine({ on })
  if (r && r.ok && on) await AutoBingwa.setNativeRunning({ on: localStorage.getItem('ab-auto-run') === '1' })
  return r
}

// Keeps the background engine's Start/Stop in step with the app's
export async function setNativeRunning(on) {
  if (!isNative()) return
  try {
    await AutoBingwa.setNativeRunning({ on: Boolean(on) })
  } catch (e) {
    console.error('AB native running', e)
  }
}