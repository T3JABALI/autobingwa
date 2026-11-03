import { parsePhone } from '../features/quickdial/ussd.js'
import { last9 } from './config.js'

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
}