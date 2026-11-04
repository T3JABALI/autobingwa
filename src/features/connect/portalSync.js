// Sends this phone's live state to the AutoBingwa Portal and runs commands sent from it.
import { Device } from '@capacitor/device'
import { engine } from '../../engine/index.js'
import { isNative, refreshAirtime } from '../../engine/native.js'
import { loadConfig } from '../../engine/config.js'
import { getAirtimeBalance, commissionThisWeek } from '../../engine/balances.js'
import { subscribe, loadTransactions, loadAirtime, loadWallet } from '../home/dataStore.js'

const SERVER = 'https://autobingwa-payments.onrender.com'
const ID_KEY = 'connect:id'
const SECRET_KEY = 'connect:portal-key:'
const INTERVAL = 8000

let timer = null
let soonTimer = null
let offData = null
let busy = false
let checking = false
let lastBattery = { level: 0, charging: false }

const pad = (n) => String(n).padStart(2, '0')
const dateOnly = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Settings > AutoBingwa Portal switch
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
    .slice(0, 5)
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

async function handleCommand(c) {
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

    const r = await post(
      '/device/sync',
      { portalOn: on, snapshot: on ? await buildSnapshot() : undefined },
      { 'X-Connect-Id': id, 'X-Device-Secret': secret }
    )
    if (!r.ok) {
      console.error('portal sync failed', r.status, r.j.error)
      return
    }
    if (on) {
      for (const c of r.j.commands || []) {
        handleCommand(c).catch((e) => console.error('portal command', c.type, e && e.message ? e.message : e))
      }
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