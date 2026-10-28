import { Capacitor, registerPlugin } from '@capacitor/core'
import { loadConfig, savedContactName } from './config.js'

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

// Every saved M-Pesa SMS is handed to the engine, then marked as done
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
          if (fromMpesa(m.sender)) engine.ingest(m.body)
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