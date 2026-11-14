// USSD Settings: how Express and Advanced mode dial on this phone.
const KEY = 'autobingwa:ussdSettings'

export const USSD_PROFILES = {
  quick: {
    expressTimeoutSec: 20, advancedTimeoutSec: 30, stepTimeoutMs: 100, betweenMs: 250,
    executionDelayMs: 0, keyInputDelayMs: 50, initialDialDelayMs: 0,
    okButtonDelayMs: 10, failureCheckDelayMs: 50, screenStabilityMs: 150,
    cleanupDelayMs: 100, inputRetries: 2, checkIntervalMs: 30, inputSearchMs: 200, rootNodeMs: 0,
  },
  average: {
    expressTimeoutSec: 30, advancedTimeoutSec: 30, stepTimeoutMs: 200, betweenMs: 2000,
    executionDelayMs: 0, keyInputDelayMs: 80, initialDialDelayMs: 100,
    okButtonDelayMs: 30, failureCheckDelayMs: 100, screenStabilityMs: 250,
    cleanupDelayMs: 150, inputRetries: 3, checkIntervalMs: 200, inputSearchMs: 300, rootNodeMs: 400,
  },
}

export const USSD_DEFAULTS = { autoRetry: false, fasten: false, ...USSD_PROFILES.quick }

export function loadUssd() {
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (e) { saved = {} }
  const out = { ...USSD_DEFAULTS }
  Object.keys(USSD_DEFAULTS).forEach((k) => {
    if (!(k in saved)) return
    if (typeof USSD_DEFAULTS[k] === 'boolean') out[k] = Boolean(saved[k])
    else if (Number.isFinite(Number(saved[k]))) out[k] = Number(saved[k])
  })
  return out
}

export function saveUssd(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true } catch (e) { return false }
}

// 'quick', 'average', or null when the values were edited by hand
export function activeProfile(s) {
  for (const [id, p] of Object.entries(USSD_PROFILES)) {
    if (Object.keys(p).every((k) => s[k] === p[k])) return id
  }
  return null
}