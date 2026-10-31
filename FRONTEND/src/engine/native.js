import { buildSignature, LEARN_PHONE } from './signature.js'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { loadConfig, savedContactName } from './config.js'
import {
  parseCommission, recordCommission, parseAirtimeBalance, setAirtimeBalance,
} from './balances.js'
import { classifyConfirmation } from './confirm.js'
import { splitUssd } from './ussdSteps.js'
export const AutoBingwa = registerPlugin('AutoBingwa')
export const isNative = () => Capacitor.isNativePlatform()

const fromMpesa = (sender) => /mpesa/i.test(String(sender || '').replace(/[^a-z]/gi, ''))

// Asks the user to allow SMS, phone and contacts access (only inside the Android app)
export async function askPermissions() {
  if (!isNative()) return null
  const have = await AutoBingwa.checkPermissions()
  if (have.sms === 'granted' && have.phone === 'granted' && have.contacts === 'granted') return have
  return AutoBingwa.requestPermissions()
}

// Saves a customer to the phone's contacts as "Name Suffix"
export async function saveContact(name, phone) {
  if (!isNative() || !name || !phone) return
  try {
    await AutoBingwa.saveContact({ name, phone })
  } catch (e) {
    console.error('AB saveContact', e)
  }
}

// The SIMs in the phone: [{ slot: 0, carrier: 'Safaricom' }, ...]
export async function getSims() {
  if (!isNative()) return []
  const res = await AutoBingwa.getSims()
  return res.sims || []
}
// Every contact saved on the phone: [{ name, phone }]
export async function listContacts() {
  if (!isNative()) return []
  const res = await AutoBingwa.listContacts()
  return res.contacts || []
}
// Dials *144# on the chosen SIM (slot 0 = SIM 1, slot 1 = SIM 2) with no popup, and saves the balance
export async function refreshAirtime(slot) {
  if (!isNative()) throw new Error('Airtime can only be checked inside the Android app')
  const res = await AutoBingwa.runUssd({ code: '*144#', slot })
  console.log('AB airtime raw', JSON.stringify(res))
  const value = parseAirtimeBalance(res.text)
  if (value === null) throw new Error('Could not find the balance in: ' + res.text)
  setAirtimeBalance(value, slot)
  return value
}

// Sends an SMS from the chosen SIM (slot 0 = SIM 1, slot 1 = SIM 2)
export async function sendSms({ to, text, slot = 0 }) {
  if (!isNative()) throw new Error('SMS can only be sent inside the Android app')
  return AutoBingwa.sendSms({ to, text, slot })
}

// Runs an offer's full USSD path. Returns { status, ok, responses }.
// express = true: the whole code goes out in one request, no dialog
export async function runFlow({
  ussd, phone, slot = 0, express = true, sig = null, stepTimeoutMs = 20000, keyDelayMs = 80, totalTimeoutMs = 90000,
}) {
  if (!isNative()) throw new Error('USSD can only run inside the Android app')
  const s = splitUssd(ussd, phone)
  if (!s) throw new Error('This offer has no USSD code')
  const res = await AutoBingwa.runUssdFlow({
    first: s.first, steps: s.steps, slot, express, sig: sig || undefined, stepTimeoutMs, keyDelayMs, totalTimeoutMs,
  })
  console.log('AB flow', JSON.stringify(res))
  return { status: res.status, ok: res.status === 'complete', responses: res.responses || [], message: res.message }
}

// Learns an offer's signature. Dials every step EXCEPT the last one (the purchase), so nothing is bought.
// Returns { signature, screens } so the window can show what was found on each step.
export async function learnSignature({ ussd, slot = 0 }) {
  if (!isNative()) throw new Error('Learning only works inside the Android app')
  const s = splitUssd(ussd, LEARN_PHONE)
  if (!s || !s.steps || !s.steps.length) throw new Error('This USSD has no steps to learn')
  const all = s.steps.map(String)
  const res = await AutoBingwa.runUssdFlow({
    first: s.first, steps: all.slice(0, -1), slot, express: false,
    stepTimeoutMs: 20000, keyDelayMs: 80, totalTimeoutMs: 90000,
  })
  const screens = (res.responses || []).map((r) => r.text)
  console.log('AB learn', JSON.stringify(res))
  if (screens.length < all.length) {
    throw new Error(res.message || `The menu ended early at step ${screens.length}: ${screens[screens.length - 1] || 'no screen'}`)
  }
  return { signature: buildSignature(screens, all), screens }
}

export async function ussdServiceEnabled() {
  if (!isNative()) return false
  return Boolean((await AutoBingwa.ussdServiceStatus()).enabled)
}

export const openAccessibilitySettings = () => AutoBingwa.openAccessibilitySettings()

// ---- Setup helpers, keep-alive and phone notifications ----
const safe = async (fn) => {
  if (!isNative()) return null
  try { return await fn() } catch (e) { console.error('AB native', e); return null }
}
export const openAppInfo = () => safe(() => AutoBingwa.openAppInfo())
export const requestBatteryExemption = () => safe(() => AutoBingwa.requestBatteryExemption())
export const requestNotifications = () => safe(() => AutoBingwa.requestNotifications())
export const setKeepAlive = (on) => safe(() => (on ? AutoBingwa.startKeepAlive() : AutoBingwa.stopKeepAlive()))
export const phoneAlert = (kind, title, text) => safe(() => AutoBingwa.phoneAlert({ kind, title, text }))
export async function restrictedStatus() {
  const r = await safe(() => AutoBingwa.restrictedStatus())
  return Boolean(r && r.blocked)
}

// Other accessibility apps that can click or close the USSD dialog.
// Returns { apps: [{ package, label }], ours: boolean }. Empty until the Java side adds accessibilityConflicts.
export async function accessibilityConflicts() {
  const r = await safe(() => AutoBingwa.accessibilityConflicts())
  return r || { apps: [], ours: false }
}

// Every saved SMS is handed on, then marked as done
export function startSmsBridge(engine) {
  if (!isNative()) return

  // Every new transaction with a full phone number is saved to the contacts
  engine.on((event, tx) => {
    if (event !== 'added' || !tx || !tx.phone || tx.blacklisted) return
    const cfg = loadConfig()
    if (!cfg.autoSave) return
    saveContact(savedContactName(tx.name || tx.phone, cfg), tx.phone)
  })

  let busy = false
  let again = false
  const failures = new Map()

  async function drainOnce() {
    const { items } = await AutoBingwa.peekSms()
    const done = []
    for (const m of items) {
      try {
        console.log('AB sms from', m.sender)
        const total = parseCommission(m.body)
        const isPayment = /^[A-Z0-9]{10}\s+Confirmed/i.test(String(m.body).trim())
        const conf = isPayment ? null : classifyConfirmation(m.body)
        if (total !== null) {
          const added = recordCommission(m.id, total, m.time)
          console.log('AB commission', total, added ? 'saved' : 'already saved')
        }
        if (conf) {
          const used = engine.confirm({ ...conf, text: m.body })
          console.log('AB confirmation', conf.status, used ? 'used' : 'no transaction waiting')
        } else if (total === null && fromMpesa(m.sender)) {
          engine.ingest(m.body)
        }
        done.push(m.id)
      } catch (err) {
        // Not acknowledged, so it comes back on the next pass.
        // After 3 failures give up, so one bad message cannot block the rest.
        const n = (failures.get(m.id) || 0) + 1
        failures.set(m.id, n)
        console.error('AB ingest failed', n, err)
        if (n >= 3) done.push(m.id)
      }
    }
    if (done.length) await AutoBingwa.ackSms({ ids: done })
  }

  // If a signal arrives while a pass is running, run again afterwards instead of dropping it
  async function drain() {
    if (busy) { again = true; return }
    busy = true
    try {
      do {
        again = false
        await drainOnce()
      } while (again)
    } catch (e) {
      console.error('SMS bridge', e)
    } finally {
      busy = false
    }
  }

  const catchUp = () => safe(() => AutoBingwa.scanInbox())
  AutoBingwa.addListener('smsStored', drain)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { catchUp(); drain() }
  })
  setInterval(drain, 5000) // safety net in case a signal is ever missed
  catchUp()
  drain()
}