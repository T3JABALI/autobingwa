import { engine } from './index.js'
import { AutoBingwa, isNative, refreshAirtime } from './native.js'
import { loadConfig } from './config.js'
import { grantTokens } from './tokens.js'
import { parsePhone } from '../features/quickdial/ussd.js'

export const AIRTIME_NUMBER = '0143926894'
// Your Render server address, no slash at the end
export const TOKEN_API = 'https://autobingwa-payments.onrender.com'

const PENDING = 'tokens:pending'
const MPESA_PENDING = 'tokens:mpesaPending'
const EXPIRE_MS = 10 * 60000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null }
}
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch (e) { console.error(e) } }
const clear = (key) => { try { localStorage.removeItem(key) } catch (e) { /* ignore */ } }

// ---------------- Airtime ----------------
export function pendingAirtimePayment() {
  const p = read(PENDING)
  if (!p) return null
  if (Date.now() - p.startedAt > EXPIRE_MS) { clear(PENDING); engine.hold(false); return null }
  return p
}

async function waitIdle() {
  const end = Date.now() + 120000
  while (engine.isBusy()) {
    if (Date.now() > end) throw new Error('A transaction is still running. Try again in a minute.')
    await sleep(1000)
  }
}

// Confirms that the airtime really left the SIM, then (and only then) adds the token
export async function verifyAirtimePayment({ onStatus = () => {} } = {}) {
  const p = pendingAirtimePayment()
  if (!p) throw new Error('There is no payment waiting to be confirmed.')
  if (p.status !== 'paid') {
    onStatus('Confirming the airtime left your SIM...')
    const after = await refreshAirtime(p.slot)
    if (!(p.before - after >= p.amount - 0.01)) {
      return {
        status: 'unconfirmed',
        message: `Your airtime did not drop (KES ${p.before} before, KES ${after} now), so no token was added.`,
      }
    }
    write(PENDING, { ...p, status: 'paid' })
  }
  grantTokens(p.plan, 'airtime', p.id)
  clear(PENDING)
  engine.hold(false)
  return { status: 'paid', message: `Payment confirmed. ${p.plan.label} added.` }
}

export function cancelAirtimePayment() {
  clear(PENDING)
  engine.hold(false)
}

// Dials *140*amount*0143926894# silently, checks the balance dropped, then adds the token
export async function payWithAirtime(plan, { onStatus = () => {}, slot: pickedSlot } = {}) {
  if (!isNative()) throw new Error('Paying with airtime only works inside the Android app.')
  if (pendingAirtimePayment()) throw new Error('A payment is still being confirmed. Confirm or cancel it first.')
  const amount = Math.round(Number(plan.price))
  if (!(amount > 0)) throw new Error('This plan has no price.')
  const cfgSlot = /2/.test(String(loadConfig().bingwaSim || '')) ? 1 : 0
  const slot = pickedSlot === 0 || pickedSlot === 1 ? pickedSlot : cfgSlot

  engine.hold(true) // no customer transaction may use the SIM or the airtime meanwhile
  let keepHold = false
  try {
    onStatus('Waiting for running transactions to finish...')
    await waitIdle()
    onStatus('Checking your airtime balance...')
    const before = await refreshAirtime(slot)
    if (before < amount) throw new Error(`Not enough airtime. You have KES ${before} and need KES ${amount}.`)

    // Saved BEFORE dialing, so a crash can never dial twice
    write(PENDING, { id: 'ap-' + Date.now(), plan, amount, slot, before, startedAt: Date.now(), status: 'dialed' })
    onStatus('Sending airtime...')
    try {
      await AutoBingwa.runUssd({ code: `*140*${amount}*${AIRTIME_NUMBER}#`, slot, express: true })
    } catch (e) {
      console.error('AB airtime dial', e) // the balance check below decides what really happened
    }
    await sleep(6000)
    try {
      const r = await verifyAirtimePayment({ onStatus })
      if (r.status === 'unconfirmed') keepHold = true
      return r
    } catch (e) {
      keepHold = true
      return { status: 'unconfirmed', message: `Could not confirm the payment: ${e && e.message ? e.message : e}` }
    }
  } finally {
    if (!keepHold) engine.hold(false)
  }
}

// ---------------- M-Pesa (needs the payment server) ----------------
// Exported so the contact sync can identify this phone to the server
export function deviceId() {
  let id = localStorage.getItem('device:id')
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('device:id', id) }
  return id
}

async function api(path, options) {
  const res = await fetch(TOKEN_API + path, { ...options, headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`The payment server answered ${res.status}`)
  return res.json()
}

// An M-Pesa payment that was started but not yet confirmed (null when none, or older than 15 minutes)
export function pendingMpesaPayment() {
  const p = read(MPESA_PENDING)
  if (!p) return null
  if (Date.now() - p.startedAt > 15 * 60000) { clear(MPESA_PENDING); return null }
  return p
}

export function cancelMpesaPayment() {
  clear(MPESA_PENDING)
}

// Sends the M-Pesa prompt to the customer's phone. Returns the payment id.
export async function startMpesaPayment(plan, phoneText) {
  const phone = parsePhone(String(phoneText || ''))
  if (!phone) throw new Error('Enter a valid phone number.')
  const data = await api('/tokens/mpesa/start', {
    method: 'POST',
    body: JSON.stringify({ phone: '254' + phone.slice(1), planId: plan.id, amount: plan.price, deviceId: deviceId() }),
  })
  if (!data.paymentId) throw new Error(data.error || 'The payment could not be started.')
  write(MPESA_PENDING, { paymentId: data.paymentId, plan, startedAt: Date.now() })
  return data.paymentId
}

// Waits for the server to say the money was received, then adds the token
export async function waitForMpesaPayment({ onStatus = () => {}, timeoutMs = 120000 } = {}) {
  const p = read(MPESA_PENDING)
  if (!p) throw new Error('There is no M-Pesa payment waiting.')
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const d = await api(`/tokens/mpesa/status/${encodeURIComponent(p.paymentId)}?deviceId=${deviceId()}`)
    if (d.status === 'paid') {
      if (d.planId !== p.plan.id) {
        throw new Error('The payment does not match the plan. Contact support.')
      }
      grantTokens({ ...p.plan, price: Number(d.amount) || p.plan.price }, 'mpesa', d.receipt || p.paymentId)
      clear(MPESA_PENDING)
      return { status: 'paid', message: `Payment received. ${p.plan.label} added.` }
    }
    if (d.status === 'failed' || d.status === 'cancelled') {
      clear(MPESA_PENDING)
      return { status: 'failed', message: d.message || 'The payment was cancelled or failed. No token was added.' }
    }
    onStatus('Waiting for you to enter your M-Pesa PIN...')
    await sleep(3000)
  }
  return { status: 'pending', message: 'No answer yet. If you paid, press Check payment in a moment.' }
}

// Called when the app opens: finishes anything that was interrupted
export function recoverTokenPayments() {
  const p = read(PENDING)
  if (p && p.status === 'paid') {
    grantTokens(p.plan, 'airtime', p.id)
    clear(PENDING)
  } else if (pendingAirtimePayment()) {
    engine.hold(true) // keep customer transactions away from the SIM until it is confirmed or cancelled
  }
}
// ---------------- Live token plans and coupons (set by the admin) ----------------
const PLANS_CACHE = 'tokens:plans'

// The last token list the server gave us (null if there is none yet)
export function cachedTokenPlans() {
  const v = read(PLANS_CACHE)
  return Array.isArray(v) ? v : null
}

// The live token list from the admin. Saved on the phone so it still shows offline.
export async function fetchTokenPlans() {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const res = await fetch(TOKEN_API + '/tokens/plans', { signal: ctl.signal })
    if (!res.ok) throw new Error(`The server answered ${res.status}`)
    const d = await res.json()
    if (!Array.isArray(d.plans)) throw new Error('Unexpected answer from the server')
    write(PLANS_CACHE, d.plans)
    return d.plans
  } finally {
    clearTimeout(timer)
  }
}

// Sends a coupon code to the server. If it is valid, the gift is added to the wallet.
export async function redeemCoupon(codeText) {
  const code = String(codeText || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 8) throw new Error('A coupon code has 8 letters and numbers.')
  let res
  try {
    res = await fetch(TOKEN_API + '/tokens/coupon/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceId: deviceId() }),
    })
  } catch (e) {
    throw new Error('Could not reach the server. Check your internet and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new Error(data.error || `The server answered ${res.status}`)
  const amount = Number(data.amount) || 0
  const plan = {
    id: 'coupon-' + code, label: data.label || 'Gift', price: 0,
    ...(data.kind === 'days' ? { days: amount } : { units: amount }),
  }
  const entry = grantTokens(plan, 'coupon', data.receipt || 'COUPON-' + code)
  return entry || { label: plan.label }
}