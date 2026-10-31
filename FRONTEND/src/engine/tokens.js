import { loadWallet } from '../features/home/dataStore.js'

const WALLET_KEY = 'tokens:wallet'
const HISTORY_KEY = 'tokens:history'
const DAY = 86400000

// True when there is an unlimited plan running, or at least one limited token left
export function tokensActive(at = Date.now()) {
  const w = loadWallet()
  return Number(w.unlimitedUntil) > at || Number(w.units) > 0
}

export function loadHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

// plan: { id, label, price, units }  (limited)  or  { id, label, price, days }  (unlimited, runs on time)
// via: 'airtime' | 'mpesa'.  ref: a unique payment reference, so one payment can never be credited twice.
export function grantTokens(plan, via, ref) {
  const history = loadHistory()
  if (ref && history.some((h) => h.ref === ref)) return null // already credited
  const w = loadWallet()
  if (Number(plan.days) > 0) {
    const base = Math.max(Date.now(), Number(w.unlimitedUntil) || 0) // buying again extends the time
    w.unlimitedUntil = base + Number(plan.days) * DAY
  } else {
    w.units = (Number(w.units) || 0) + (Number(plan.units) || 0)
  }
  const entry = { id: 'tk-' + Date.now(), at: Date.now(), label: plan.label, price: plan.price, via, ref: ref || '' }
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(w))
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...history].slice(0, 200)))
  } catch (e) {
    console.error('tokens: could not save', e)
  }
  window.dispatchEvent(new Event('autobingwa-data')) // the Tokens card and Home refresh
  window.dispatchEvent(new Event('ab-tokens')) // lets the engine continue waiting transactions
  return entry
}