import { notify } from '../notify/notify.js'

const TX_KEY = 'transactions:list'
const AIRTIME_KEY = 'airtime:balance'
const WALLET_KEY = 'tokens:wallet'
const CONFIG_KEY = 'settings:config'
const EVENT = 'autobingwa-data'

// Tokens used by each transaction chain (not used while an unlimited plan is active).
export const TOKENS_PER_TRANSACTION = 1

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v === null ? fallback : v
  } catch (e) {
    console.error('Could not read ' + key, e)
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('Could not save ' + key, e)
  }
  window.dispatchEvent(new Event(EVENT))
}

// Pages call this to be told whenever the data changes.
export function subscribe(listener) {
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function loadTransactions() {
  const list = read(TX_KEY, [])
  return Array.isArray(list) ? list : []
}

export function loadAirtime() {
  const n = Number(read(AIRTIME_KEY, 0))
  return Number.isFinite(n) ? n : 0
}

// Use this when your phone app reports the real airtime balance.
export function setAirtimeBalance(amount) {
  write(AIRTIME_KEY, Number(amount) || 0)
}

export function loadWallet() {
  return { units: 0, unlimitedUntil: 0, ...(read(WALLET_KEY, null) || {}) }
}

export function saveMode(mode) {
  write(CONFIG_KEY, { ...read(CONFIG_KEY, {}), mode })
}

function announce(tx) {
  const what = tx.offerName || 'Transaction'
  const who = tx.name || tx.phone
  const to = who ? ` for ${who}` : ''
  if (tx.status === 'Pending') notify(`Processing ${what}${to}...`, 'processing', 'Processing')
  else if (tx.status === 'Completed') notify(`${what} completed${to}`, 'success', 'Successful')
  else if (tx.status === 'Failed' && !tx.hasFallback) notify(`${what} failed${to}`, 'error', 'Failed')
  else if (tx.status === 'Scheduled') notify(`${what} scheduled${to}`, 'info', 'Scheduled')
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// Keep the app fast: only the newest 500 finished transactions are kept
const KEEP = 500
const isOpen = (s) => s === 'Pending' || s === 'Processing' || s === 'Scheduled' || s === 'Paused'
function trim(list) {
  if (list.length <= KEEP) return list
  let drop = list.length - KEEP
  const keep = []
  for (let i = list.length - 1; i >= 0; i--) {
    if (drop > 0 && !isOpen(list[i].status)) { drop--; continue }
    keep.push(list[i])
  }
  return keep.reverse()
}

// Airtime goes down when a transaction completes.
function applyCompletion(tx) {
  const cost = Number(tx.cost) || 0
  if (cost) write(AIRTIME_KEY, Math.max(0, loadAirtime() - cost))
}

// One token per dialed transaction chain (unlimited plans ignore this)
export function chargeToken() {
  const wallet = loadWallet()
  if (!(wallet.unlimitedUntil > Date.now()) && wallet.units > 0) {
    write(WALLET_KEY, { ...wallet, units: Math.max(0, wallet.units - TOKENS_PER_TRANSACTION) })
  }
}

// Call this from your transaction code:
//   addTransaction({ name, phone, amount, cost, offerName, status: 'Completed',
//                    rawMessage, ussd, responses: [{ input: '5', text: '...' }] })
export function addTransaction(data) {
  const now = Date.now()
  const tx = {
    id: newId(), name: '', phone: '', amount: 0, cost: 0, offerName: '',
    status: 'Pending', createdAt: now, completedAt: null, scheduledFor: null,
    rawMessage: '', ussd: '', responses: [], ...data,
  }
  if (tx.status === 'Completed') {
    tx.completedAt = tx.completedAt || now
    applyCompletion(tx)
  }
  announce(tx)
  write(TX_KEY, trim([tx, ...loadTransactions()]))
  return tx
}

export function updateTransaction(id, patch) {
  const list = loadTransactions()
  const old = list.find((t) => t.id === id)
  if (!old) return
  const next = { ...old, ...patch }
  if (patch.status === 'Completed' && old.status !== 'Completed') {
    next.completedAt = Date.now()
    applyCompletion(next)
  }
  if (patch.status && patch.status !== old.status) announce(next)
  write(TX_KEY, list.map((t) => (t.id === id ? next : t)))
}

const DELETED_KEY = 'transactions:deleted'

// IDs and M-Pesa codes of deleted transactions, so they are never created again
export function loadDeletedKeys() {
  const v = read(DELETED_KEY, [])
  return Array.isArray(v) ? v : []
}
export const wasDeleted = (key) => Boolean(key) && loadDeletedKeys().includes(String(key))

// Deleting one transaction deletes its whole fallback chain (the original and its backups),
// because the user sees them as one transaction.
export function deleteTransaction(id) {
  const list = loadTransactions()
  const gone = new Set([String(id)])
  let grew = true
  while (grew) {
    grew = false
    for (const t of list) {
      const from = t.fallbackFromId ? String(t.fallbackFromId) : ''
      if (from && gone.has(from) && !gone.has(String(t.id))) { gone.add(String(t.id)); grew = true } // a backup of a deleted one
      if (from && gone.has(String(t.id)) && !gone.has(from)) { gone.add(from); grew = true } // the original behind a deleted backup
    }
  }
  const marks = []
  list.forEach((t) => {
    if (!gone.has(String(t.id))) return
    marks.push(String(t.id))
    if (t.mpesaId) marks.push(String(t.mpesaId))
  })
  write(DELETED_KEY, [...new Set([...loadDeletedKeys(), ...marks])].slice(-1000))
  write(TX_KEY, list.filter((t) => !gone.has(String(t.id))))
}

// One-time cleanup of the old sample transactions
const DEMO_ROWS = [
  'Faith Simiyu|0704590730', 'Ruth Mogaka|0759461380', 'Purity Bowen|0769010855',
  'Sydney Wangwe|0797609585', 'Imran Ahmed|0711723954', 'Mitchelle Makokha|0791818480',
  'Joy Wanjiku|0722334455', 'Brian Otieno|0733445566', 'Amina Hassan|0744556677',
  'Peter Kamau|0755667788',
]

export function removeDemoData() {
  try {
    if (localStorage.getItem('ab:demo-removed') === '1') return
    const list = loadTransactions()
    const keep = list.filter((t) => !DEMO_ROWS.includes(`${t.name || ''}|${t.phone || ''}`))
    if (keep.length !== list.length) write(TX_KEY, keep)
    if (loadAirtime() === 11274.24) write(AIRTIME_KEY, 0)
    localStorage.setItem('ab:demo-removed', '1')
  } catch (e) {
    console.error('demo cleanup', e)
  }
}
// Applies the tokens the background engine used. The counter only ever goes up, so a charge is never applied twice.
export function applyNativeCharges(total) {
  const t = Number(total) || 0
  const w = loadWallet()
  const applied = Number(w.chargesApplied) || 0
  if (t <= applied) return
  const next = { ...w, chargesApplied: t }
  if (!(Number(w.unlimitedUntil) > Date.now())) {
    next.units = Math.max(0, (Number(w.units) || 0) - (t - applied))
  }
  write(WALLET_KEY, next)
}