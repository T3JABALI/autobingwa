// Auto renew: when tokens run out, buy the last plan again with airtime.
import { tokensActive, loadHistory } from './tokens.js'
import {
  payWithAirtime, pendingAirtimePayment, pendingMpesaPayment, fetchTokenPlans, cachedTokenPlans,
} from './tokenPay.js'
import { reportAirtime } from './incomeReport.js'
import { isNative, phoneAlert } from './native.js'
import { notify } from '../features/notify/notify.js'
import { subscribe } from '../features/home/dataStore.js'

const ON_KEY = 'tokens:autorenew'
const LAST_PLAN_KEY = 'tokens:lastPlan' // saved by tokens.js after every paid purchase
const STATE_KEY = 'tokens:autorenew:state'
const COOLDOWN_MS = 30 * 60000 // after a failed attempt, wait this long
const MAX_PER_DAY = 5

const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null }
}
const write = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch (e) { console.error('autorenew: could not save', e) }
}

const fromServer = (p) => ({
  id: p.id,
  label: p.label,
  price: Number(p.price),
  ...(p.kind === 'days' ? { days: Number(p.amount) } : { units: Number(p.amount) }),
})

// The plan to buy again: the last one paid for. Older purchases are matched by name.
function getLastPlan(plans) {
  const stored = read(LAST_PLAN_KEY)
  if (stored && stored.id) return stored
  if (plans) {
    for (const h of loadHistory()) {
      if (h.via !== 'airtime' && h.via !== 'mpesa') continue
      const p = plans.find((x) => x.label === h.label)
      if (p) return fromServer(p)
    }
  }
  return null
}

export const autoRenewOn = () => localStorage.getItem(ON_KEY) === '1'

export function setAutoRenew(on) {
  try { localStorage.setItem(ON_KEY, on ? '1' : '0') } catch (e) { /* ignore */ }
  window.dispatchEvent(new Event('autobingwa-data'))
  if (on) checkAutoRenew()
}

// What the Tokens page shows
export function describeAutoRenew() {
  const plans = cachedTokenPlans()
  const last = getLastPlan(plans)
  let plan = last ? { label: last.label, price: last.price } : null
  if (last && plans) {
    const live = plans.find((p) => p.id === last.id)
    if (live) plan = { label: live.label, price: Number(live.price) }
  }
  const st = read(STATE_KEY)
  return { on: autoRenewOn(), plan, state: st && !st.pending ? st : null }
}

let running = false

function finish(ok, message, count, today) {
  write(STATE_KEY, { at: Date.now(), day: today, count, ok, message })
  if (ok) {
    notify(message, 'success', 'Auto renew')
  } else {
    notify(message, 'error', 'Auto renew')
    phoneAlert('failed', 'Auto renew failed', message)
    window.dispatchEvent(new Event('ab-need-tokens')) // show the "no active token" pop-up
  }
  window.dispatchEvent(new Event('autobingwa-data'))
}

export async function checkAutoRenew() {
  if (running) return
  if (!isNative() || !autoRenewOn() || tokensActive()) return
  if (pendingAirtimePayment() || pendingMpesaPayment()) return // a payment is already waiting

  const st = read(STATE_KEY) || {}
  const now = Date.now()
  if (st.ok === false && st.at && now - st.at < COOLDOWN_MS) return // a recent attempt failed
  const today = new Date().toDateString()
  const count = st.day === today ? Number(st.count) || 0 : 0
  if (count >= MAX_PER_DAY) return

  running = true
  const used = count + 1
  // Saved BEFORE anything is paid, so a crash can never lead to a repeat purchase loop
  write(STATE_KEY, { at: now, day: today, count: used, ok: false, pending: true, message: 'Renewing...' })
  try {
    let plans = null
    try { plans = await fetchTokenPlans() } catch (e) { plans = cachedTokenPlans() }
    const last = getLastPlan(plans)
    if (!last) return finish(false, 'There is no earlier purchase to repeat. Buy a token once, then auto renew can repeat it.', used, today)

    let plan = last
    if (plans) {
      const live = plans.find((p) => p.id === last.id)
      if (!live) return finish(false, `${last.label} is no longer available, so it was not renewed.`, used, today)
      plan = fromServer(live) // the price may have changed
    }
    if (tokensActive()) return finish(true, 'Tokens were already added.', used, today)

    const slot = Number(localStorage.getItem('tokens:paySim')) === 1 ? 1 : 0
    const r = await payWithAirtime(plan, { slot })
    if (r.status === 'paid') {
      reportAirtime(plan.id)
      return finish(true, `${plan.label} was renewed automatically.`, used, today)
    }
    return finish(false, `Auto renew could not confirm the payment. Open Tokens to check it. ${r.message || ''}`.trim(), used, today)
  } catch (e) {
    return finish(false, e && e.message ? e.message : String(e), used, today)
  } finally {
    running = false
  }
}

// Starts the watcher. Returns a function that stops it.
export function startAutoRenew() {
  const off = subscribe(() => { checkAutoRenew() }) // runs when the token balance changes
  const timer = setInterval(checkAutoRenew, 30000)
  const first = setTimeout(checkAutoRenew, 8000)
  return () => { off(); clearInterval(timer); clearTimeout(first) }
}