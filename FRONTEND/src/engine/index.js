import {
  askPermissions,
  startSmsBridge,
  runFlow,
  sendSms,
  isNative,
  AutoBingwa,
  requestNotifications,
  phoneAlert,
  ussdServiceEnabled,
  saveContact,
} from './native.js'

import { loadConfig, savedContactName } from './config.js'
import { createEngine } from './engine.js'
import { fillTemplate as fillTpl } from './offerRules.js'
import { findAutoReply, fillTemplate as fillReply } from './autoRepliesStore.js'
import { recordClientPurchase } from './clientsStore.js'
import { addContact } from './contactsStore.js'
import { tokensActive } from './tokens.js'
import { startContactSync } from './contactSync.js'
import {
  loadTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  chargeToken,
  removeDemoData,
  applyNativeCharges,
} from '../features/home/dataStore.js'
import { startNativeSync } from './nativeSync.js'
function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

// Transactions the background engine is working on are hidden from the app's engine,
// so the two engines can never dial the same payment. A retry or release hands one to the app.
const NATIVE_BUSY = ['Pending', 'Processing', 'Scheduled']
function releaseNative(id) {
  if (!isNative()) return
  const t = loadTransactions().find((x) => x.id === id)
  if (t && t.engine === 'native') AutoBingwa.nativeRelease({ id }).catch(() => {})
}

const store = {
  list: () => loadTransactions().filter((t) => !(t.engine === 'native' && NATIVE_BUSY.includes(t.status))),
  add: addTransaction,
  update: (id, patch) => {
    if (patch && patch.status === 'Pending') releaseNative(id)
    const p = patch && patch.status === 'Pending' ? { ...patch, engine: 'js' } : patch
    updateTransaction(id, p)
    return loadTransactions().find((t) => t.id === id)
  },
  remove: deleteTransaction,
}


// A saved signature is used only when it is complete and switched on (smart plans are always on)
const sigOf = (offer) =>
  offer && offer.sig && offer.sig.complete && (offer.smart || offer.sigEnabled) ? offer.sig : null

const slotOf = (simName) => (simName === 'SIM 1' ? 0 : 1)

// Browser simulation for testing
const simulatedBridge = {
  async runUssd({ ussd, mode }) {
    await new Promise((r) =>
      setTimeout(r, mode === 'Express' ? 1500 : 3500)
    )

    const ok = Math.random() > 0.2

    return {
      ok,
      responses: [
        {
          input: ussd,
          text: ok
            ? 'Your request is being processed. You will receive an SMS shortly.'
            : 'Request failed. Please try again later.',
        },
      ],
    }
  },
  async sendSms({ to, text }) {
    console.log('AB (simulated) SMS to', to, text)
  },
}

// Real Android phone bridge
const realBridge = {
  async runUssd({ ussd, phone, mode: engineMode, offer }) {
    const cfg = loadConfig()
    // The offer's own mode wins. Nothing saved uses the mode from the app settings.
    const mode = offer && (offer.type === 'Express' || offer.type === 'Advanced') ? offer.type : engineMode
    // The offer's own SIM choice wins. "Default" (or nothing saved) uses the SIM from the app settings.
    const simName = offer && (offer.execSim === 'SIM 1' || offer.execSim === 'SIM 2') ? offer.execSim : cfg.bingwaSim
    const slot = slotOf(simName)
    const timeouts = {
      stepTimeoutMs: (Number(cfg.stepTimeoutSec) || 20) * 1000,
      keyDelayMs: Number(cfg.keyDelayMs) || 80,
      totalTimeoutMs: (Number(cfg.totalTimeoutSec) || 90) * 1000,
    }

    // SIGNATURE: dial step by step and pick each option by what it says, not by its number
    const sig = sigOf(offer)
    if (sig) {
      return runFlow({ ussd, phone, slot, express: false, sig: sig.steps, ...timeouts })
    }

    // EXPRESS MODE: One silent USSD request
    if (mode === 'Express') {
      const code = String(ussd).replace(/\bab\b/gi, phone)

      try {
        const res = await AutoBingwa.runUssd({
          code,
          slot,
          express: true,
        })

        return {
          ok: true,
          status: 'complete',
          responses: [
            {
              input: code,
              text: res.text || '',
            },
          ],
        }
      } catch (err) {
        const msg = String(err && err.message ? err.message : err)
        // The phone refused the silent request (code -1 or -2): try once more, then use the dialer window
        if (/USSD failed, code -[12]\b/.test(msg) || /USSD error/.test(msg)) {
          try {
            await new Promise((r) => setTimeout(r, 1500))
            const again = await AutoBingwa.runUssd({ code, slot, express: true })
            return { ok: true, status: 'complete', responses: [{ input: code, text: again.text || '' }] }
          } catch (err2) {
            console.error('AB express retry', err2)
          }
          if (await ussdServiceEnabled()) {
            return runFlow({ ussd, phone, slot, express: false, ...timeouts })
          }
        }
        // A timeout means the request went out but no answer came back. The plan may have sold,
        // so report "no reply" (unknown) instead of a definite failure. That blocks retries and fallbacks.
        if (/timed out/i.test(msg)) {
          return {
            ok: false,
            status: 'no_reply',
            message: 'The request was sent but no answer came back. Check the customer before retrying.',
            responses: [],
          }
        }
        throw err
      }
    }

    // ADVANCED MODE: Interactive USSD flow
    return runFlow({ ussd, phone, slot, express: false, ...timeouts })
  },

  // Customer messages go out on the reply SIM
  async sendSms({ to, text }) {
    const cfg = loadConfig()
    return sendSms({ to, text, slot: slotOf(cfg.replySim) })
  },
}

const bridge = isNative() ? realBridge : simulatedBridge

// Create engine
export const engine = createEngine({
  store,
  bridge,
  getOffers: () => readJson('myOffers', []),
  getMode: () => loadConfig().mode,
  hasToken: tokensActive,
  chargeToken,
})

// Sends each buyer's name and number to the admin Contacts page (queued while offline)
startContactSync(engine)
startNativeSync()
removeDemoData() // one-time: clears the old sample transactions
engine.recover()

// A bought token releases anything that was waiting for one
window.addEventListener('ab-tokens', () => engine.pump())

// Real-time phone notifications
engine.on((event, tx) => {
  if (!tx) return

  if (event === 'processing') {
    phoneAlert(
      'processing',
      'Processing',
      `KES ${tx.amount} · ${tx.phone}`
    )
  } else if (event === 'completed') {
    phoneAlert('idle', '', '')
  } else if (event === 'failed') {
    // A backup plan was queued for this one, so it is not a lost sale. No failure alert.
    if (loadTransactions().some((t) => t.fallbackFromId === tx.id)) {
      phoneAlert('idle', '', '')
      return
    }
    const last = (tx.responses || []).slice(-1)[0]

    phoneAlert(
      'failed',
      `Failed: KES ${tx.amount} · ${tx.phone}`,
      (last && last.text) || 'The transaction failed'
    )
  }
})

// ---------- Auto replies ----------
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())

function replyVars(tx) {
  const words = String(tx.name || '').trim().split(/\s+/).filter(Boolean).map(titleCase)
  return {
    firstName: words[0] || 'Customer',
    surname: words.length > 1 ? words[words.length - 1] : '',
    mpesaCode: tx.mpesaId || '',
    amount: tx.amount,
    offerName: tx.offerName,
    offerPrice: tx.cost,
  }
}

// Sends the saved reply for this trigger, once per transaction, on the reply SIM
function sendAutoReply(tx, trigger) {
  try {
    if (!tx || !tx.phone || tx.messageType === 'direct') return // Quick Dial and renewals are not customer payments
    const cur = loadTransactions().find((t) => t.id === tx.id) || tx
    const sent = cur.repliesSent || []
    if (sent.includes(trigger)) return
    // A fallback with "notify client" already sends its own message
    if (cur.isFallback && cur.fallbackNotify && trigger === 'success') return
    const rule = findAutoReply(trigger, cur.amount)
    if (!rule) return
    const text = fillReply(rule.message, replyVars(cur))
    updateTransaction(cur.id, { repliesSent: [...sent, trigger] })
    const log = (input) => {
      const now = loadTransactions().find((t) => t.id === cur.id)
      if (now) updateTransaction(cur.id, { responses: [...(now.responses || []), { input, text }] })
    }
    Promise.resolve()
      .then(() => bridge.sendSms({ to: cur.phone, text }))
      .then(() => log('Auto reply sent'))
      .catch((err) => { console.error('AB auto reply', err); log('Auto reply failed') })
  } catch (e) {
    console.error('AB auto reply', e)
  }
}

// What happens after a transaction changes: client records, contacts, auto replies.
// Used for the app's own transactions and for ones imported from the background engine.
function onTxEvent(event, tx) {
  try {
    if (!tx) return

    if (event === 'added') {
      if (tx.status === 'Skipped' && tx.blacklisted) sendAutoReply(tx, 'blacklisted')
      else if (tx.status === 'Unmatched' && tx.phone) sendAutoReply(tx, 'unavailable')
      else if (tx.status === 'Paused') sendAutoReply(tx, 'paused')
      return
    }

    if (event === 'completed') {
      // Every completed purchase feeds Clients and Contacts
      recordClientPurchase(tx.phone, tx.amount, tx.name)
      addContact(tx.phone, tx.name ? titleCase(tx.name) : '', tx.source === 'sitelink' ? 'sitelink' : 'local')
      sendAutoReply(tx, 'success')
      return
    }

    if (event === 'failed') {
      // The customer is about to get a backup plan, so no failure message
      if (tx.hasFallback) return
      if (loadTransactions().some((t) => t.fallbackFromId === tx.id)) return
      const text = (tx.responses || []).map((r) => r.text).join(' ')
      if (/already\s+been\s+recommended/i.test(text)) return sendAutoReply(tx, 'recommended')
      // Unknown result (the plan may have sold): never tell the customer it failed
      if (/no reply came back|no success message|check the customer before retrying/i.test(text)) return
      sendAutoReply(tx, 'failed')
    }
  } catch (e) {
    console.error('AB listener', e)
  }
}
engine.on(onTxEvent)

// ---------- Background engine: bring its results into the app ----------
// SMS to the customer after a purchase the background engine made (the offer's own message and the time-window message)
function notifyNative(tx) {
  try {
    const cur = loadTransactions().find((t) => t.id === tx.id)
    if (!cur || cur.notifySent || !cur.phone) return
    const offers = readJson('myOffers', [])
    const offer = offers.find((o) => String(o.id) === String(cur.offerId))
    if (!offer) return
    const first = String(cur.name || '').trim().split(/\s+/)[0] || ''
    const vars = {
      name: first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '',
      phone: cur.phone, offer: offer.name, amount: cur.amount, price: cur.amount,
    }
    const texts = []
    if (cur.isFallback && cur.fallbackNotify) {
      texts.push(
        fillTpl('Hi {name}, {first} could not be given, so we sent you {offer} instead. Thank you for buying!',
          { ...vars, first: cur.fallbackFromName || 'your offer' }).replace(/^Hi ,/, 'Hi,')
      )
    } else if (offer.notifyOn && offer.notifyMsg) texts.push(fillTpl(offer.notifyMsg, vars))
    const primary = cur.fallbackOf != null ? offers.find((o) => String(o.id) === String(cur.fallbackOf)) : null
    if (primary && primary.tw && primary.tw.notify && primary.tw.msg) texts.push(fillTpl(primary.tw.msg, vars))
    if (!texts.length) return
    updateTransaction(cur.id, { notifySent: true })
    texts.forEach((text) => {
      const log = (input) => {
        const now = loadTransactions().find((t) => t.id === cur.id)
        if (now) updateTransaction(cur.id, { responses: [...(now.responses || []), { input, text }] })
      }
      Promise.resolve()
        .then(() => bridge.sendSms({ to: cur.phone, text }))
        .then(() => log('SMS sent'))
        .catch((err) => { console.error('AB notify', err); log('SMS failed') })
    })
  } catch (e) {
    console.error('AB notify native', e)
  }
}

function fireFinished(status, tx) {
  if (status === 'Completed') {
    onTxEvent('completed', tx)
    notifyNative(tx)
  } else if (status === 'Failed') {
    onTxEvent('failed', tx)
  }
}

let importing = false

// Copies the background engine's transactions into the app, applies the tokens it used,
// and fires the same follow-ups as for the app's own transactions. Safe to call any time.
export async function importNative() {
  if (!isNative() || importing) return 0
  importing = true
  let changed = 0
  try {
    const st = await AutoBingwa.nativeState()
    applyNativeCharges(st.chargesTotal)
    const list = (st.transactions || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    for (const nt of list) {
      const local = loadTransactions().find((t) => t.id === nt.id)
      if (!local) {
        addTransaction({ ...nt })
        changed++
        const added = loadTransactions().find((t) => t.id === nt.id)
        onTxEvent('added', added)
        const cfg = loadConfig()
        if (cfg.autoSave && nt.phone && !nt.blacklisted) saveContact(savedContactName(nt.name || nt.phone, cfg), nt.phone)
        fireFinished(nt.status, added)
        continue
      }
      // The app took this one over (a retry, a release, a due schedule), or the copy is already current
      if (local.engine === 'js' || (Number(local.rev) || 0) >= (Number(nt.rev) || 0)) continue
      updateTransaction(nt.id, nt)
      changed++
      if (local.status !== nt.status) fireFinished(nt.status, loadTransactions().find((t) => t.id === nt.id))
    }
  } catch (e) {
    console.error('AB import native', e)
  } finally {
    importing = false
  }
  return changed
}

const importTimer = setInterval(importNative, 3000)
setTimeout(importNative, 1500)
const onShow = () => { if (!document.hidden) importNative() }
document.addEventListener('visibilitychange', onShow)

// Starts scheduled transactions every 30 seconds
const timer = setInterval(() => engine.tick(), 30000)

// Also right after the app opens and each time it comes back to the foreground,
// so renewals and delayed fallbacks are picked up straight away
setTimeout(() => engine.tick(), 2000)
const onVisible = () => {
  if (!document.hidden) engine.tick()
}
document.addEventListener('visibilitychange', onVisible)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(timer)
    clearInterval(importTimer)
    document.removeEventListener('visibilitychange', onVisible)
    document.removeEventListener('visibilitychange', onShow)
  })
}

// Testing helper (development only)
if (import.meta.env.DEV) {
  window.fakeSms = (
    amount = 19,
    phone = '0712345678',
    name = 'TEST CUSTOMER'
  ) => {
    const code = (
      'TST' + Math.random().toString(36).slice(2, 9).toUpperCase()
    ).padEnd(10, 'X')

    return engine.ingest(
      `${code} Confirmed. on 28/10/26 at 10:00 AM Ksh${amount}.00 received from 254${phone.slice(1)} ${name}. New M-PESA balance is Ksh1,000.00.`
    )
  }
}

// Initialize permissions and SMS listener
askPermissions()
  .then(() => requestNotifications())
  .then(() => startSmsBridge(engine))
  .catch((e) => console.error(e))