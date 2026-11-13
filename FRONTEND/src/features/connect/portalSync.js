// Sends this phone's live state to the AutoBingwa Portal and runs commands sent from it.
import { Device } from '@capacitor/device'
import { App } from '@capacitor/app'
import { engine } from '../../engine/index.js'
import { isNative, refreshAirtime, learnSignature, ussdServiceEnabled, AutoBingwa } from '../../engine/native.js'
import { applyEdit, checkUssd, normalizeUssd } from '../../engine/offerRules.js'
import { loadConfig, setPortal } from '../../engine/config.js'
import { getAirtimeBalance, commissionThisWeek } from '../../engine/balances.js'
import { payWithAirtime } from '../../engine/tokenPay.js'
import { grantTokens, tokensActive } from '../../engine/tokens.js'
import { parsePhone } from '../quickdial/ussd.js'
import { subscribe, loadTransactions, loadAirtime, loadWallet, loadDeletedKeys } from '../home/dataStore.js'

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
let busySince = 0
let checking = false
let paying = false
let lastSaved = ''
let lastBattery = { level: 0, charging: false }
let worker = null
let appListener = null
let cmdListener = null
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
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await fetch(SERVER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }
  } finally {
    clearTimeout(timeout)
  }
}

// Tells the portal how a command went
async function report(c, auth, ok, msg, data) {
  try {
    const body = { id: c.id, ok: Boolean(ok), msg: String(msg || '').slice(0, 600) }
    if (data !== undefined) body.data = data
    await post('/device/command-result', body, auth)
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

const CATS = ['DATA', 'MINUTES', 'SMS', 'TUNUKIWA', 'BINGWA']
const defTw = () => ({ on: false, from: '06:00', until: '22:00', altId: '', notify: false, msg: '' })
const stamp = () => new Date().toLocaleString()

// The app's own offers list comes first; localStorage is only a fallback
function readOffers() {
  try {
    const list = engine.offers ? engine.offers() : null
    if (Array.isArray(list) && list.length) return list
  } catch (e) { /* fall through */ }
  try {
    const v = JSON.parse(localStorage.getItem('myOffers') || '[]')
    if (Array.isArray(v)) return v
  } catch (e) { /* fall through */ }
  return []
}
const findOffer = (id) => readOffers().find((o) => String(o.id) === String(id))
// App.jsx listens for this and runs its own saveOffer / deleteOffer
const saveOffer = (offer) => window.dispatchEvent(new CustomEvent('ab-offer-cmd', { detail: { op: 'save', offer } }))
const dropOffer = (id) => window.dispatchEvent(new CustomEvent('ab-offer-cmd', { detail: { op: 'delete', id } }))

// The offers shown on the portal's Data plans page: every setting the portal can edit
function offersForPortal() {
  try {
    return readOffers().map((o) => ({
      id: String(o.id),
      name: o.name || '',
      cat: o.category || o.cat || '',
      category: o.category || o.cat || '',
      price: Number(o.price) || 0,
      safPrice: Number(o.safPrice) || 0,
      ussd: o.ussd || '',
      on: o.enabled !== false,
      enabled: o.enabled !== false,
      smart: Boolean(o.smart),
      signature: o.signature || null,
      sig: o.sig || null,
      sigLearned: Boolean(o.sigLearned),
      sigEnabled: Boolean(o.sigEnabled),
      sigAuto: Boolean(o.sigAuto),
      autoRetry: Boolean(o.autoRetry),
      retryCount: Number(o.retryCount) || 1,
      retryPending: Boolean(o.retryPending),
      retryFailed: o.retryFailed !== false,
      autoReschedule: Boolean(o.autoReschedule),
      rescheduleTime: o.rescheduleTime || '06:00',
      notifyOn: Boolean(o.notifyOn),
      notifyMsg: o.notifyMsg || '',
      tw: { ...defTw(), ...(o.tw || {}), altId: o.tw && o.tw.altId ? String(o.tw.altId) : '' },
    }))
  } catch (e) {
    return []
  }
}

// Turns what the portal sent into the phone's offer fields
function fromPortal(p) {
  const o = {}
  ;['name', 'autoRetry', 'retryPending', 'retryFailed', 'autoReschedule', 'rescheduleTime', 'notifyOn', 'notifyMsg'].forEach((k) => {
    if (p[k] !== undefined) o[k] = p[k]
  })
  if (p.name !== undefined) o.name = String(p.name).trim()
  if (p.notifyMsg !== undefined) o.notifyMsg = String(p.notifyMsg).trim()
  if (p.ussd !== undefined) o.ussd = normalizeUssd(p.ussd)
  if (p.price !== undefined) o.price = Number(p.price)
  if (p.safPrice !== undefined) o.safPrice = Number(p.safPrice) || 0
  if (p.retryCount !== undefined) o.retryCount = Math.min(10, Math.max(1, Number(p.retryCount) || 1))
  if (p.tw !== undefined) o.tw = { ...defTw(), ...p.tw, altId: p.tw && p.tw.altId ? String(p.tw.altId) : '' }
  const cat = String(p.category || p.cat || '').toUpperCase()
  if (CATS.includes(cat)) o.category = cat
  if (p.enabled !== undefined) o.enabled = Boolean(p.enabled)
  else if (p.on !== undefined) o.enabled = Boolean(p.on)
  return o
}

// '' when fine, otherwise the message to send back to the portal
function checkOffer(o) {
  if (!o.name) return 'Enter the offer name'
  const bad = checkUssd(o.ussd)
  if (bad) return bad
  if (!(Number(o.price) > 0)) return 'Enter the amount'
  if (o.notifyOn && !o.notifyMsg) return 'Write the SMS message for the customer'
  return ''
}

async function runLearn(ussd) {
  if (!isNative()) throw new Error('Learning only works in the Android app, on a phone with a SIM.')
  if (!(await ussdServiceEnabled())) throw new Error('Turn on the AutoBingwa accessibility service first.')
  const slot = loadConfig().bingwaSim === 'SIM 1' ? 0 : 1
  for (let i = 0; i < 45 && engine.isBusy(); i++) await new Promise((r) => setTimeout(r, 2000))
  engine.hold(true) // no customer payment dials while the steps are being learned
  try {
    return await learnSignature({ ussd, slot })
  } finally {
    engine.hold(false)
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

  // Transactions the app hides (an original that has a fallback). The portal must not keep them.
  const visibleIds = new Set(visible.map((t) => t.id))
  const hidden = txs
    .filter((t) => !visibleIds.has(t.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 300)
    .map((t) => String(t.id))

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
    hidden: [...hidden, ...loadDeletedKeys().slice(-300)],
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

const findTx = (id) => loadTransactions().find((x) => String(x.id) === String(id))

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
  } else if (c.type === 'tx_retry') {
    // Same engine call as the app's Retry button. Only a Failed transaction, so nothing is sold twice.
    const t = findTx(p.txId)
    if (!t) return report(c, auth, false, 'That transaction is no longer on the phone.')
    if (t.status !== 'Failed') return report(c, auth, false, `Only a failed transaction can be retried. This one is ${t.status}.`)
    if (t.hasFallback) return report(c, auth, false, 'A fallback plan was already started for this one, so it cannot be retried.')
    if (!tokensActive()) return report(c, auth, false, 'You have no active token. Buy a token to continue.')
    engine.retry(t.id)
    await report(c, auth, true, 'Retry started on the phone.')
    soon()
  } else if (c.type === 'tx_reschedule') {
    const t = findTx(p.txId)
    if (!t) return report(c, auth, false, 'That transaction is no longer on the phone.')
    if (t.status !== 'Failed' && t.status !== 'Scheduled') return report(c, auth, false, 'Only a failed or scheduled transaction can be rescheduled.')
    const at = Number(p.at)
    if (!(at > Date.now())) return report(c, auth, false, 'The time must be in the future.')
    engine.reschedule(t.id, at)
    await report(c, auth, true, 'Transaction rescheduled.')
    soon()
  } else if (c.type === 'tx_delete') {
    const t = findTx(p.txId)
    if (!t) return report(c, auth, true, 'The transaction was already gone.')
    if (t.status === 'Processing') return report(c, auth, false, 'It is being processed right now. Try again when it finishes.')
    engine.remove(t.id)
    await report(c, auth, true, 'Transaction deleted.')
    soon()
  } else if (c.type === 'offer_add') {
    const src = p.offer || p
    const id = src.id || p.offerId || Date.now()
    if (findOffer(id)) return report(c, auth, true, 'The offer is already on the phone.', { id: String(id) })
    const f = fromPortal(src)
    const bad = checkOffer(f)
    if (bad) return report(c, auth, false, bad)
    saveOffer({
      id, name: '', category: 'DATA', ussd: '', price: 0, safPrice: 0,
      payment: 'Till SIM', execSim: 'SIM 1', notifSim: 'SIM 2', type: 'Advanced',
      autoRetry: false, retryCount: 1, retryPending: false, retryFailed: true,
      autoReschedule: false, rescheduleTime: '06:00', notifyOn: false, notifyMsg: '',
      points: false, enabled: true, tw: defTw(),
      ...f, updated: stamp(),
    })
    await report(c, auth, true, 'Offer added.', { id: String(id) })
    soon()
  } else if (c.type === 'offer_update') {
    const cur = findOffer(p.id || p.offerId)
    if (!cur) return report(c, auth, false, 'That offer is no longer on the phone.')
    const { enabled, tw, ...rest } = fromPortal(p.patch || p.offer || p)
    let next = { ...cur }
    const changed = Object.keys(rest).some((k) => JSON.stringify(rest[k]) !== JSON.stringify(cur[k]))
    if (changed) {
      const bad = checkOffer({ ...cur, ...rest })
      if (bad) return report(c, auth, false, bad)
      next = applyEdit(cur, rest) // same rule as the app: a manual offer's signature is switched off
    }
    if (tw !== undefined) next = { ...next, tw }
    if (enabled !== undefined) next = { ...next, enabled }
    saveOffer({ ...next, updated: stamp() })
    await report(c, auth, true, 'Offer updated.')
    soon()
  } else if (c.type === 'offer_delete') {
    const cur = findOffer(p.id || p.offerId)
    if (!cur) return report(c, auth, true, 'The offer was already gone.')
    readOffers().forEach((o) => {
      if (o.tw && String(o.tw.altId) === String(cur.id)) saveOffer({ ...o, tw: { ...o.tw, on: false, altId: '' } })
    })
    dropOffer(cur.id)
    await report(c, auth, true, 'Offer deleted.')
    soon()
  } else if (c.type === 'sig_learn') {
    const cur = findOffer(p.id || p.offerId)
    if (!cur) return report(c, auth, false, 'That offer is no longer on the phone.')
    const bad = checkUssd(cur.ussd)
    if (bad) return report(c, auth, false, bad)
    const res = await runLearn(cur.ussd)
    await report(c, auth, true, res.signature && res.signature.complete ? 'Signature learned.' : 'Some steps could not be matched.', {
      signature: res.signature,
      screens: res.screens || [],
    })
  } else if (c.type === 'sig_save') {
    const cur = findOffer(p.id || p.offerId)
    if (!cur) return report(c, auth, false, 'That offer is no longer on the phone.')
    const sig = p.signature || p.sig
    if (!sig || !sig.complete) return report(c, auth, false, 'The signature is incomplete, so it was not saved.')
    const smart = Boolean(cur.smart)
    if (smart && cur.sig && cur.sig.complete && !cur.sigAuto) return report(c, auth, false, 'This Smart plan has a built-in signature that cannot be changed.')
    saveOffer({ ...cur, sig, sigLearned: true, sigEnabled: smart ? true : Boolean(p.enabled), updated: stamp() })
    await report(c, auth, true, 'Signature saved.')
    soon()
  }
}
function dispatch(commands, auth, on) {
  for (const c of commands || []) {
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
}
// Runs commands the native service queued while the web view was asleep
async function drainNativeCommands() {
  if (!isNative()) return
  try {
    const id = (localStorage.getItem(ID_KEY) || '').trim()
    const secret = localStorage.getItem(SECRET_KEY + id)
    if (!id || !secret) return
    const { commands } = await AutoBingwa.peekPortalCommands()
    if (!commands || !commands.length) return
    dispatch(commands, { 'X-Connect-Id': id, 'X-Device-Secret': secret }, portalSwitchOn())
    await AutoBingwa.ackPortalCommands({ ids: commands.map((c) => c.id) })
  } catch (e) { /* older native build */ }
}
async function tick() {
  if (busy && Date.now() - busySince < 45000) return
  busy = true
  busySince = Date.now()
  try {
    await drainNativeCommands()
    const id = (localStorage.getItem(ID_KEY) || '').trim()
    const on = portalSwitchOn()
    console.log('portal tick', JSON.stringify({ id, on, hasSecret: !!localStorage.getItem(SECRET_KEY + id) }))
    if (!id) return // no Connect ID yet: generate one on the Autobingwa Connect page

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

    // Give the background service the login details first, so it can keep the phone
    // Connected while the web view sleeps
    const keep = id + '|' + secret + '|' + on
    if (isNative() && keep !== lastSaved) {
      AutoBingwa.savePortal({ id, secret, on })
        .then(() => { lastSaved = keep })
        .catch((e) => console.error('savePortal', e && e.message ? e.message : e))
    }

    const snap = on ? await buildSnapshot() : undefined
    if (isNative()) {
      if (snap) AutoBingwa.savePortalSnapshot({ json: JSON.stringify(snap) }).catch(() => {})
      AutoBingwa.portalBeat().catch(() => {})
    }
    const r = await post('/device/sync', { portalOn: on, snapshot: snap }, auth)
    if (!r.ok) {
      console.error('portal sync failed', r.status, r.j.error)
      if (r.status === 401) localStorage.removeItem(SECRET_KEY + id) // bad credentials: register again next tick
      return
    }
    dispatch(r.j.commands, auth, on)
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

const onVisible = () => { if (!document.hidden) soon() }
const onOnline = () => soon()

// A Worker's timer is throttled much less than the main thread's when the screen is off.
// If workers are blocked, it falls back to a normal setInterval.
function stopTicker() {
  if (worker) {
    worker.terminate()
    worker = null
  }
  clearInterval(timer)
  timer = null
}

function startTicker() {
  stopTicker()
  const fallback = () => {
    if (!timer) timer = setInterval(tick, INTERVAL)
  }
  try {
    const src = 'let t;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}'
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    worker.onmessage = () => tick()
    worker.onerror = () => {
      if (worker) {
        worker.terminate()
        worker = null
      }
      fallback()
    }
    worker.postMessage(INTERVAL)
  } catch (e) {
    fallback()
  }
}

export function startPortalSync() {
  console.log('portal sync started')
  stopPortalSync()
  offData = subscribe(soon)
  window.addEventListener('ab-balances', soon)
  window.addEventListener('ab-connect', soon)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)

  if (isNative()) {
    // Sync right away when the app comes back to the foreground
    App.addListener('appStateChange', (s) => {
      if (s.isActive) {
        drainNativeCommands()
        soon()
      }
    })
      .then((h) => { appListener = h })
      .catch(() => {})

    // Commands the native service fetched while the WebView was asleep
    try {
      AutoBingwa.addListener('portalCommands', () => { drainNativeCommands() })
        .then((h) => { cmdListener = h })
        .catch(() => {})
    } catch (e) { /* native side not added yet */ }
  }

  tick()
  startTicker()
}

export function stopPortalSync() {
  stopTicker()
  clearTimeout(soonTimer)
  soonTimer = null
  if (offData) offData()
  offData = null
  if (appListener) { appListener.remove(); appListener = null }
  if (cmdListener) { cmdListener.remove(); cmdListener = null }
  window.removeEventListener('ab-balances', soon)
  window.removeEventListener('ab-connect', soon)
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onVisible)
}