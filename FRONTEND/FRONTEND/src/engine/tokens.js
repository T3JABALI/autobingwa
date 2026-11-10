import { loadWallet } from '../features/home/dataStore.js'
import { supabase } from '../lib/supabase'

const WALLET_KEY = 'tokens:wallet'
const HISTORY_KEY = 'tokens:history'
const DAY = 86400000

// Only these two plans earn the referrer a gift day
const REFERRAL_PLANS = ['d7', 'd30']
const REFQ_KEY = 'ab:refq'
const API = (import.meta.env.VITE_TOKEN_API || '').replace(/\/+$/, '')

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

// ---------- Referral reports (kept in a small queue so nothing is lost while offline) ----------
function readRefQueue() {
  try {
    const v = JSON.parse(localStorage.getItem(REFQ_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}
function writeRefQueue(list) {
  try {
    localStorage.setItem(REFQ_KEY, JSON.stringify(list.slice(0, 50)))
  } catch (e) {
    console.error('referral queue: could not save', e)
  }
}

let flushing = false
export async function flushReferralQueue() {
  if (flushing) return
  flushing = true
  try {
    const queue = readRefQueue()
    if (!queue.length) return
    const { data } = await supabase.auth.getSession()
    const token = data && data.session && data.session.access_token
    if (!token) return // not logged in yet: try again later
    const left = []
    for (const item of queue) {
      if (Date.now() - (item.at || 0) > 7 * DAY) continue // too old, give up
      try {
        const r = await fetch(API + '/referral/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ planId: item.planId, via: item.via, ref: item.ref }),
        })
        if (!r.ok) left.push(item) // server busy or login expired: keep it
      } catch (e) {
        left.push(item) // no network: keep it
      }
    }
    writeRefQueue(left)
  } finally {
    flushing = false
  }
}

// plan: { id, label, price, units }  (limited)  or  { id, label, price, days }  (unlimited, runs on time)
// via: 'airtime' | 'mpesa' | 'gift'.  ref: a unique payment reference, so one payment can never be credited twice.
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

  // A bought Unlimited Weekly or Monthly token earns the referrer a free day (airtime or M-Pesa)
  if ((via === 'airtime' || via === 'mpesa') && REFERRAL_PLANS.includes(plan.id)) {
    writeRefQueue([...readRefQueue(), { planId: plan.id, via, ref: ref || entry.id, at: Date.now() }])
    flushReferralQueue()
  }
  return entry
}

// Send anything that was waiting: shortly after the app opens, and whenever the network comes back
setTimeout(flushReferralQueue, 5000)
if (typeof window !== 'undefined') window.addEventListener('online', flushReferralQueue)