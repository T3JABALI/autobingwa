// Shared settings helpers. Used by the Settings page, the engine and the native bridge.
export const PROFILE_KEY = 'settings:profile'
export const CONFIG_KEY = 'settings:config'
export const CLIENTS_KEY = 'clients:list'

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
  keyDelayMs: 80, // pause before typing each option
  gapMs: 1000, // pause between two transactions
  retryAfterSec: 15, // wait before retrying a failed attempt
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