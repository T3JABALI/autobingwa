// Finds the real number behind a hidden one such as 0714***999 (used when the background engine is off)
import { AutoBingwa, isNative } from './native.js'
import { loadConfig, readJson, CLIENTS_KEY } from './config.js'

let book = [] // the phone's own contacts: [name, phone]
let bookAt = 0

// Reads the phonebook ahead of time, so a hidden number can be matched at once
export async function refreshPhonebook(force = false) {
  if (!isNative() || !loadConfig().unmaskPhones) return
  if (!force && Date.now() - bookAt < 120000) return
  bookAt = Date.now()
  try {
    const res = await AutoBingwa.listContacts()
    book = ((res && res.contacts) || []).map((c) => [c.name || '', c.phone || ''])
  } catch (e) {
    console.error('AB phonebook cache', e)
  }
}

function toLocal(token) {
  const s = String(token || '').replace(/[\s\-().]/g, '').replace(/^\+/, '')
  if (/^254[17][\d*]{8}$/.test(s)) return '0' + s.slice(3)
  if (/^0[17][\d*]{8}$/.test(s)) return s
  if (/^[17][\d*]{8}$/.test(s)) return '0' + s
  return ''
}

function tokens(text, drop = new Set()) {
  const out = new Set()
  String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).forEach((w) => {
    if (w.length >= 2 && !drop.has(w)) out.add(w)
  })
  return out
}

function digitsFit(masked, phone) {
  if (masked.length !== phone.length) return false
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '*' && masked[i] !== phone[i]) return false
  }
  return true
}

// Returns { phone, name, reason }. phone is empty unless exactly one saved person fits.
export function resolveMasked(masked, smsName, suffix) {
  const none = { phone: '', name: '', reason: '' }
  if (!masked) return { ...none, reason: 'no hidden number was read' }
  const drop = tokens(suffix)
  const want = tokens(smsName)
  if (!want.size) return { ...none, reason: 'the message has no name to match' }

  const rows = [
    ...book,
    ...readJson('contacts:list', []).map((c) => [c && c.name, c && c.phone]),
    ...readJson(CLIENTS_KEY, []).filter((c) => c && c.purchases > 0).map((c) => [c.name, c.phone]),
  ]
  const hits = new Map() // real number -> saved name
  for (const [name, num] of rows) {
    const phone = toLocal(num)
    if (!phone || phone.includes('*') || !digitsFit(masked, phone)) continue
    const have = tokens(name, drop)
    if (!have.size) continue
    let shared = 0
    have.forEach((w) => { if (want.has(w)) shared++ })
    const need = Math.min(2, have.size, want.size)
    if (shared > 0 && shared >= need && !hits.has(phone)) hits.set(phone, String(name || ''))
  }
  if (hits.size === 1) {
    const [phone, name] = [...hits.entries()][0]
    return { phone, name, reason: '' }
  }
  return {
    ...none,
    reason: hits.size === 0
      ? 'no saved contact fits the digits and the name'
      : `${hits.size} different contacts fit, so it was not guessed`,
  }
}