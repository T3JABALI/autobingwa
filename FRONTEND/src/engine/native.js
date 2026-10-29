import { Capacitor, registerPlugin } from '@capacitor/core'
import { loadConfig, savedContactName } from './config.js'
import {
  parseCommission, recordCommission, parseAirtimeBalance, setAirtimeBalance,
} from './balances.js'
   import { classifyConfirmation } from './confirm.js'
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

// Every saved SMS is handed on, then marked as done
export function startSmsBridge(engine) {
  if (!isNative()) return
  let busy = false

  // Every new transaction with a full phone number is saved to the contacts
  engine.on((event, tx) => {
    if (event !== 'added' || !tx || !tx.phone || tx.blacklisted) return
    const cfg = loadConfig()
    if (!cfg.autoSave) return
    saveContact(savedContactName(tx.name || tx.phone, cfg), tx.phone)
  })

  async function drain() {
    if (busy) return
    busy = true
    try {
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
        } catch (err) {
          console.error('AB ingest failed', err)
        }
        done.push(m.id)
      }
      if (done.length) await AutoBingwa.ackSms({ ids: done })
    } catch (e) {
      console.error('SMS bridge', e)
    } finally {
      busy = false
    }
  }

  AutoBingwa.addListener('smsStored', drain)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) drain()
  })
  drain()
}