import { parsePhone } from '../features/quickdial/ussd.js'
import { last9 } from './config.js'

export const CLIENTS_KEY = 'clients:list'
export const CLIENTS_EVENT = 'ab-clients'
export const DAY = 24 * 60 * 60 * 1000

const pad = (n) => String(n).padStart(2, '0')
export const dayKey = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function loadClients() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLIENTS_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch (e) {
    console.error('Could not read clients', e)
    return []
  }
}

export function saveClients(list) {
  try {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Could not save clients', e)
  }
  try { window.dispatchEvent(new Event(CLIENTS_EVENT)) } catch (e) { /* no window */ }
}

// The days (YYYY-MM-DD) this client bought on. Older saves without it use their last purchase day.
export const purchaseDays = (c) =>
  Array.isArray(c.days) ? c.days : c.purchases > 0 && c.lastActive ? [dayKey(c.lastActive)] : []

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())

// Called by the engine after every completed purchase
export function recordClientPurchase(phone, amount, name = '') {
  const clean = parsePhone(String(phone || ''))
  if (!clean) return
  const list = loadClients()
  const now = Date.now()
  let c = list.find((x) => last9(x.phone) === last9(clean))
  if (!c) {
    c = {
      id: now + Math.random(), name: name ? titleCase(name) : clean, phone: clean,
      createdAt: now, lastActive: 0, totalSpent: 0, purchases: 0, blacklisted: false, days: [],
    }
    list.push(c)
  } else if (!c.createdAt && !c.purchases) {
    c.createdAt = now // a synced contact buying for the first time is a new customer
  }
  if (name && (!c.name || c.name === c.phone)) c.name = titleCase(name)
  c.totalSpent = (Number(c.totalSpent) || 0) + (Number(amount) || 0)
  c.purchases = (Number(c.purchases) || 0) + 1
  c.lastActive = now
  const days = purchaseDays(c)
  const key = dayKey(now)
  c.days = (days.includes(key) ? days : [...days, key]).slice(-60)
  saveClients(list)
}