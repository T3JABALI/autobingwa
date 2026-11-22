import { parsePhone } from '../features/quickdial/ussd.js'
import { last9, loadConfig, savedContactName } from './config.js'
import { AutoBingwa, isNative } from './native.js'

export const CONTACTS_KEY = 'contacts:list'
export const CONTACTS_EVENT = 'ab-contacts'
const CLIENTS_KEY = 'clients:list'
const MIGRATED = 'contacts:migrated'

export const newContactId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    console.error('Could not read ' + key, e)
    return []
  }
}

export function writeContacts(list) {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Could not save contacts', e)
  }
  try { window.dispatchEvent(new Event(CONTACTS_EVENT)) } catch (e) { /* no window */ }
}

// Loads contacts. Customers who bought before this feature existed are copied in ONCE,
// so a contact you delete never comes back.
export function loadContacts() {
  const contacts = read(CONTACTS_KEY)
  try {
    if (localStorage.getItem(MIGRATED) !== '1') {
      let changed = false
      read(CLIENTS_KEY).forEach((c) => {
        if (c.purchases > 0 && !contacts.some((x) => last9(x.phone) === last9(c.phone))) {
          contacts.push({
            id: newContactId(), name: c.name || c.phone, phone: c.phone,
            email: '', source: 'local', createdAt: c.createdAt || Date.now(),
          })
          changed = true
        }
      })
      localStorage.setItem(MIGRATED, '1')
      if (changed) localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts))
    }
  } catch (e) {
    console.error('contacts migration', e)
  }
  return contacts
}

// ---------- the phone's own phonebook ----------
// Asks for the Contacts permission if needed. Returns true when it is granted.
async function contactsAllowed() {
  let p = await AutoBingwa.checkPermissions()
  if (p.contacts !== 'granted') p = await AutoBingwa.requestPermissions({ permissions: ['contacts'] })
  return p.contacts === 'granted'
}

// Saves one contact into the phonebook (a number that is already there is left alone).
// Follows the "auto save" setting, and uses the same name and suffix as the background engine.
function toPhonebook(name, phone) {
  try {
    if (!isNative()) return
    const cfg = loadConfig()
    if (!cfg.autoSave) return
    Promise.resolve(AutoBingwa.saveContact({ name: savedContactName(name || phone, cfg), phone }))
      .catch((e) => console.error('AB phonebook save', e))
  } catch (e) {
    console.error('AB phonebook save', e)
  }
}

// source: 'local' (paid straight to the till) or 'sitelink'
export function addContact(phone, name = '', source = 'local') {
  const clean = parsePhone(String(phone || ''))
  if (!clean) return
  const list = read(CONTACTS_KEY)
  if (list.some((c) => last9(c.phone) === last9(clean))) return
  list.push({
    id: newContactId(), name: name || clean, phone: clean, email: '',
    source: source === 'sitelink' ? 'sitelink' : 'local', createdAt: Date.now(),
  })
  writeContacts(list)
  toPhonebook(name, clean) // also into the phone's contacts, not only the app
}

// Brings the phonebook into the app. Numbers already in the app are skipped.
export async function importFromPhonebook() {
  if (!isNative()) throw new Error('Importing from the phonebook only works in the Android app.')
  if (!(await contactsAllowed())) {
    throw new Error('Contacts permission was not allowed. Allow it in the phone settings and try again.')
  }
  const res = await AutoBingwa.listContacts()
  const found = res && res.contacts ? res.contacts : []
  const list = read(CONTACTS_KEY)
  const seen = new Set(list.map((c) => last9(c.phone)))
  let added = 0
  let skipped = 0
  for (const pc of found) {
    const clean = parsePhone(String(pc.phone || '').replace(/[\s\-().]/g, ''))
    if (!clean) { skipped++; continue }
    const key = last9(clean)
    if (seen.has(key)) { skipped++; continue }
    seen.add(key)
    list.push({
      id: newContactId(), name: pc.name || clean, phone: clean, email: '',
      source: 'local', createdAt: Date.now(),
    })
    added++
  }
  if (added) writeContacts(list)
  return { added, skipped, total: found.length }
}

// Pushes every contact in the app into the phonebook. Numbers already there are skipped.
export async function exportToPhonebook() {
  if (!isNative()) throw new Error('Saving to the phonebook only works in the Android app.')
  if (!(await contactsAllowed())) {
    throw new Error('Contacts permission was not allowed. Allow it in the phone settings and try again.')
  }
  const cfg = loadConfig()
  let saved = 0
  let existed = 0
  let failed = 0
  for (const c of read(CONTACTS_KEY)) {
    if (!c.phone) continue
    try {
      const r = await AutoBingwa.saveContact({ name: savedContactName(c.name || c.phone, cfg), phone: c.phone })
      if (r && r.saved) saved++; else existed++
    } catch (e) {
      failed++
    }
  }
  return { saved, existed, failed }
}