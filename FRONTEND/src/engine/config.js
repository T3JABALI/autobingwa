// Shared settings helpers. Used by the Settings page, the engine and the native bridge.
export const PROFILE_KEY = 'settings:profile'
export const CONFIG_KEY = 'settings:config'
export const CLIENTS_KEY = 'clients:list'

// Bump this number to push new speed defaults to phones that already saved the old ones
const SPEED_V = 2

export const DEFAULT_CONFIG = {
  bingwaSim: 'SIM 2', // receives payments, runs USSD, airtime balance and commission messages
  replySim: 'SIM 1', // sends auto-replies and any other SMS
  // kept so older screens that read these lists keep working
  receiveSims: ['SIM 2'],
  ussdSims: ['SIM 2'],
  replySims: ['SIM 1'],
  processMpesa: true,
  processTill: true,
  processPaybill: true,
  processSitelink: true,
  autoSave: true,
  saveSuffix: 'AutoBingwa',
  portal: false,
  mode: 'Advanced',
  // USSD speed settings
  stepTimeoutSec: 20, // wait for each next dialog
  totalTimeoutSec: 90, // whole Advanced run
  keyDelayMs: 40, // pause before typing each option
  gapMs: 400, // pause between two transactions
  retryAfterSec: 8, // wait before retrying a failed attempt
  confirmWaitSec: 45, // wait for Safaricom's SMS if the last screen is unclear
}

export function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v === null ? fallback : v
  } catch (e) {
    console.error('Could not read ' + key, e)
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.error('Could not save ' + key, e)
    return false
  }
}

export function loadConfig() {
  const saved = readJson(CONFIG_KEY, {})
  // One-time upgrade of the saved speed numbers. Nothing else in the saved settings is changed.
  if (saved.speedV !== SPEED_V) {
    const upgraded = {
      ...saved,
      keyDelayMs: DEFAULT_CONFIG.keyDelayMs,
      gapMs: DEFAULT_CONFIG.gapMs,
      retryAfterSec: DEFAULT_CONFIG.retryAfterSec,
      speedV: SPEED_V,
    }
    writeJson(CONFIG_KEY, upgraded)
    Object.assign(saved, upgraded)
  }
  const cfg = { ...DEFAULT_CONFIG, ...saved }
  // Older saves had separate SIM lists. Use their first entry.
  if (!saved.bingwaSim) cfg.bingwaSim = (saved.ussdSims && saved.ussdSims[0]) || DEFAULT_CONFIG.bingwaSim
  if (!saved.replySim) cfg.replySim = (saved.replySims && saved.replySims[0]) || DEFAULT_CONFIG.replySim
  cfg.receiveSims = [cfg.bingwaSim]
  cfg.ussdSims = [cfg.bingwaSim]
  cfg.replySims = [cfg.replySim]
  return cfg
}

function titleCase(name) {
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
}

// "CYPRIAN MUKAMO" becomes "Cyprian Mukamo AutoBingwa"
export function savedContactName(name, config = loadConfig()) {
  let clean = String(name || '').replace(/\s+/g, ' ').trim()
  if (clean && !/[a-z]/.test(clean)) clean = titleCase(clean)
  const suffix = String(config.saveSuffix || '').trim()
  return config.autoSave && suffix ? `${clean} ${suffix}`.trim() : clean
}

export const last9 = (phone) => String(phone || '').replace(/\D/g, '').slice(-9)

export function isBlacklisted(phone) {
  const key = last9(phone)
  if (key.length < 9) return false
  return readJson(CLIENTS_KEY, []).some((c) => c.blacklisted && last9(c.phone) === key)
}
// The one AutoBingwa Portal switch. Settings, Connect page and the portal all use this.
export function setPortal(on) {
  writeJson(CONFIG_KEY, { ...readJson(CONFIG_KEY, {}), portal: Boolean(on) })
  try { window.dispatchEvent(new Event('ab-connect')) } catch (e) { /* no window */ }
}
// Switches AutoBingwa Portal on or off and saves it in the settings
export function setPortal(on) {
  const cfg = readJson(CONFIG_KEY, {})
  writeJson(CONFIG_KEY, { ...cfg, portal: Boolean(on) })
  try { window.dispatchEvent(new Event('autobingwa-data')) } catch (e) { /* ignore */ }
  return Boolean(on)
}