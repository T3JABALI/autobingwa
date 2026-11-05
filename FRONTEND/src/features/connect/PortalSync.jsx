// Sends this phone's live state to the AutoBingwa Portal and runs commands sent from it.
import { Device } from '@capacitor/device'
import { engine } from '../../engine/index.js'
import { isNative, refreshAirtime } from '../../engine/native.js'
import { loadConfig, setPortal } from '../../engine/config.js'
import { getAirtimeBalance, commissionThisWeek } from '../../engine/balances.js'
import { payWithAirtime } from '../../engine/tokenPay.js'
import { grantTokens } from '../../engine/tokens.js'
import { parsePhone } from '../quickdial/ussd.js'
import { subscribe, loadTransactions, loadAirtime, loadWallet } from '../home/dataStore.js'
import { useEffect } from 'react'

const SERVER = 'https://autobingwa-payments.onrender.com'
const ID_KEY = 'connect:id'
const SECRET_KEY = 'connect:portal-key:'
const INTERVAL = 8000

// Same packages as TokensPage.jsx. The app's own list decides the price and what is credited,
// the portal only names the pack. If you change a package in TokensPage.jsx, change it here too.
const PACKS = {
  u1000: { id: 'u1000', label: '1,000 units', price: 90, units: 1000 },
  u600: { id: 'u600', label: '600 units', price: 50, units: 600 },
  u250: { id: 'u250', label: '250 units', price: 25, units: 250 },
  u100: { id: 'u100', label: '100 units', price: 15, units: 100 },
  d1: { id: 'd1', label: '1 day unlimited', price: 30, days: 1 },
  d7: { id: 'd7', label: '7 days unlimited', price: 200, days: 7 },
  d30: { id: 'd30', label: '30 days unlimited', price: 550, days: 30 },
}

let timer = null
let soonTimer = null
let offData = null
let busy = false
let checking = false
let paying = false
let lastBattery = { level: 0, charging: false }
const inflight = new Set() // command ids being handled, so a resent command never runs twice

const pad = (n) => String(n).padStart(2, '0')
const dateOnly = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Settings > AutoBingwa Portal switch (the one switch for everything)
const portalSwitchOn = () => {
  try {
    return Boolean(loadConfig().portal)
  } catch (e) {
    return false
  }
}

async function post(path, body, headers = {}) {
  const r = await fetch(SERVER + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }
}

// Tells the portal how a command went
async function report(c, auth, ok, msg) {
  try {
    await post('/device/command-result', { id: c.id, ok: Boolean(ok), msg: String(msg || '').slice(0, 600) }, auth)
  } catch (e) {
    console.error('portal report', e && e.message ? e.message : e)
  }
}

// Same rule as the Home screen: an original that has a fallback is hidden, only the fallback shows
function visibleTxs(txs) {
  const hidden = new Set()
  txs.forEach((t) => {
    if (!t.isFallback || !t.fallbackFromId) return
    if (t.status === 'Skipped') {
      const orig = txs.find((x) => x.id === t.fallbackFromId)
      if (orig && orig.status === 'Completed') hidden.add(t.id)
    } else {
      hidden.add(t.fallbackFromId)
    }
  })
  return txs.filter((t) => !hidden.has(t.id))
}

const responseText = (t) =>
  t.responses && t.responses.length
    ? t.responses.map((r, i) => `--- Screen ${i + 1} (input: ${r.input}) ---\n${r.text}`).join('\n\n')
    : 'No response recorded yet.'

// The offers the portal's Quick Dial can choose from
function offersForPortal() {
  try {
    return (engine.offers ? engine.offers() : []).map((o) => ({
      id: String(o.id),
      name: o.name || '',
      cat: o.category || o.cat || '',
      price: Number(o.price) || 0,
      ussd: o.ussd || '',
      on: o.enabled !== false,
    }))
  } catch (e) {
    return []
  }
}

async function buildSnapshot() {
  const now = Date.now()
  const txs = loadTransactions()
  const visible = visibleTxs(txs)
  const d0 = new Date(now)
  d0.setHours(0, 0, 0, 0)
  const todayStart = d0.getTime()
  const todays = visible.filter((t) => t.createdAt >= todayStart)

  const wallet = loadWallet()
  const bal = getAirtimeBalance()
  const airBal = bal && Number.isFinite(Number(bal.value)) ? Number(bal.value) : loadAirtime()
  const airUsed = txs
    .filter((t) => t.status === 'Completed' && (t.completedAt || t.createdAt) >= todayStart)
    .reduce((sum, t) => sum + (Number(t.cost) || 0), 0)

  try {
    const b = await Device.getBatteryInfo()
    if (typeof b.batteryLevel === 'number') lastBattery = { level: Math.round(b.batteryLevel * 100), charging: !!b.isCharging }
  } catch (e) { /* keep the last known battery */ }

  const recent = [...visible]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map((t) => ({
      id: t.id,
      name: t.name || t.phone || '',
      phone: t.phone || '',
      amt: Number(t.amount) || 0,
      offer: t.offerName || '',
      st: t.status,
      ts: new Date(t.createdAt).toISOString(),
      msg: t.rawMessage || '',
      ussd: t.ussd || '',
      resp: responseText(t),
    }))

  return {
    ok: todays.filter((t) => t.status === 'Completed').length,
    failed: todays.filter((t) => t.status === 'Failed').length,
    tokens: Number(wallet.units) || 0,
    unlimitedUntil: wallet.unlimitedUntil > now ? dateOnly(wallet.unlimitedUntil) : '',
    airUsed,
    airBal,
    battery: lastBattery.level,
    charging: lastBattery.charging,
    commission: commissionThisWeek(now),
    running: engine.isRunning(),
    offers: offersForPortal(),
    recent,
  }
}

// The portal's refresh icon: the same *144# check the Home screen runs
async function runAirtimeCheck() {
  if (!isNative()) throw new Error('Airtime can only be checked inside the Android app')
  const last = getAirtimeBalance()
  const slot = last && Number.isInteger(last.slot) ? last.slot : 0
  for (let i = 0; i < 45 && engine.isBusy(); i++) await new Promise((r) => setTimeout(r, 2000))
  engine.hold(true) // no new transaction starts while the check is dialing
  try {
    await refreshAirtime(slot)
  } finally {
    engine.hold(false)
  }
}

async function handleCommand(c, auth) {
  const p = c.payload || {}

  if (c.type === 'airtime_check') {
    if (checking) return
    checking = true
    try {
      await runAirtimeCheck()
    } finally {
      checking = false
    }
    soon()
  } else if (c.type === 'start' || c.type === 'stop') {
    // App.jsx listens for this and runs the same code as the Start / Stop button
    window.dispatchEvent(new CustomEvent('ab-remote', { detail: { type: c.type } }))
    setTimeout(soon, 3000)
  } else if (c.type === 'portal_on' || c.type === 'portal_off') {
    setPortal(c.type === 'portal_on') // the portal flipped the switch; Settings follows
    soon()
  } else if (c.type === 'quickdial') {
    // txId is the portal's transaction id, so the portal and the app show ONE transaction
    const phone = parsePhone(String(p.phone || ''))
    if (!phone || !p.offerId || !p.txId) {
      await report(c, auth, false, 'The Quick Dial request was incomplete.')
      return
    }
    const r = await engine.quickDial({ offerId: p.offerId, phone, id: p.txId })
    soon()
    // Duplicate: already running from an earlier copy. Pending: still running, the next sync shows the result.
    if (r.status === 'Duplicate' || r.status === 'Pending') return
    await report(c, auth, r.ok, r.text)
  } else if (c.type === 'buy_tokens') {
    // Airtime payment started from the portal. Tokens are added only after the transfer is confirmed.
    const plan = PACKS[p.packId]
    if (!plan) return report(c, auth, false, 'Unknown token pack.')
    if (Number(p.amount) !== plan.price) return report(c, auth, false, 'The price did not match the app. Nothing was sent.')
    if (paying) return report(c, auth, false, 'Another token payment is already in progress.')
    paying = true
    try {
      const r = await payWithAirtime(plan)
      await report(c, auth, r.status === 'paid', r.message)
    } catch (e) {
      await report(c, auth, false, e && e.message ? e.message : String(e))
    } finally {
      paying = false
    }
    soon()
  } else if (c.type === 'credit_tokens') {
    // The server queues this only after M-Pesa confirmed the money. The payment id stops a double credit.
    const plan = PACKS[p.packId]
    if (!plan || !p.paymentId) return report(c, auth, false, 'Unknown token pack or payment.')
    grantTokens(plan, 'mpesa', String(p.paymentId)) // returns null if this payment was already credited
    await report(c, auth, true, `${plan.label} added.`)
    soon()
  }
}

async function tick() {
  if (busy) return
  busy = true
  try {
    const id = (localStorage.getItem(ID_KEY) || '').trim()
    if (!id) return // no Connect ID yet: generate one on the Autobingwa Connect page
    const on = portalSwitchOn()

    let secret = localStorage.getItem(SECRET_KEY + id)
    if (!secret) {
      if (!on) return // never registered and switched off: nothing to tell the server
      const r = await post('/device/register', { connectId: id })
      if (!r.ok) {
        console.error('portal register failed', r.status, r.j.error)
        return
      }
      secret = r.j.secret
      localStorage.setItem(SECRET_KEY + id, secret)
    }

    const auth = { 'X-Connect-Id': id, 'X-Device-Secret': secret }
    const r = await post(
      '/device/sync',
      { portalOn: on, snapshot: on ? await buildSnapshot() : undefined },
      auth
    )
    if (!r.ok) {
      console.error('portal sync failed', r.status, r.j.error)
      return
    }
    for (const c of r.j.commands || []) {
      const switchCmd = c.type === 'portal_on' || c.type === 'portal_off'
      if (!on && !switchCmd) continue // while off, only the switch commands are obeyed
      if (inflight.has(c.id)) continue // the server resends credit_tokens until we report; handle each once
      inflight.add(c.id)
      handleCommand(c, auth)
        .catch((e) => {
          console.error('portal command', c.type, e && e.message ? e.message : e)
          return report(c, auth, false, e && e.message ? e.message : 'The command failed.')
        })
        .finally(() => setTimeout(() => inflight.delete(c.id), 60000))
    }
  } catch (e) {
    console.error('portal sync', e && e.message ? e.message : e)
  } finally {
    busy = false
  }
}

// Send again shortly after something changes, so the portal follows the phone within seconds
function soon() {
  clearTimeout(soonTimer)
  soonTimer = setTimeout(tick, 1500)
}

export function startPortalSync() {
  stopPortalSync()
  offData = subscribe(soon)
  window.addEventListener('ab-balances', soon)
  window.addEventListener('ab-connect', soon)
  tick()
  timer = setInterval(tick, INTERVAL)
}

export function stopPortalSync() {
  clearInterval(timer)
  clearTimeout(soonTimer)
  timer = null
  if (offData) offData()
  offData = null
  window.removeEventListener('ab-balances', soon)
  window.removeEventListener('ab-connect', soon)
}
// App.jsx renders this once. It shows nothing and keeps the portal sync running.
export default function PortalSync() {
  useEffect(() => {
    startPortalSync()
    return () => stopPortalSync()
  }, [])
  return null
}