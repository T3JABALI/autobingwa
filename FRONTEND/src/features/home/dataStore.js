import { notify } from '../notify/notify.js'
import { loadRows, putRows, deleteRows, settled, loadCustomerRows, putCustomers } from './txDb.js'

const TX_KEY = 'transactions:list' // the old home of the transactions, now read only once to move them
const AIRTIME_KEY = 'airtime:balance'
const WALLET_KEY = 'tokens:wallet'
const CONFIG_KEY = 'settings:config'
const CUSTOMERS_KEY = 'customers:summary'
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

// Many changes in a burst (a batch of payments, a backlog being worked through) tell the screens only once per 150 ms.
// Without this, every single change redraws every screen, which freezes the app when many transactions are queued.
let tellTimer = null
const tell = () => {
  if (tellTimer) return
  tellTimer = setTimeout(() => {
    tellTimer = null
    window.dispatchEvent(new Event(EVENT))
  }, 150)
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('Could not save ' + key, e)
  }
  tell()
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

// ---- Transactions: kept in memory, saved to IndexedDB ----
const KEEP = 50000 // rows kept in total
const FULL = 5000 // the newest rows keep everything; older finished rows lose their raw SMS and USSD text
const isOpen = (s) => s === 'Pending' || s === 'Processing' || s === 'Scheduled' || s === 'Paused'
const slim = (t) => ({ ...t, rawMessage: '', ussd: '', responses: [] })
const heavy = (t) => t.rawMessage || t.ussd || (t.responses && t.responses.length)

let cache = [] // newest first. A NEW array is made on every change, so screens redraw
let useDb = true

// Returns the trimmed list, the ids that were dropped and the rows that were slimmed
function trim(list) {
  const dropped = []
  let out = list
  if (list.length > KEEP) {
    let drop = list.length - KEEP
    const keep = []
    for (let i = list.length - 1; i >= 0; i--) {
      if (drop > 0 && !isOpen(list[i].status)) { drop--; dropped.push(list[i].id); continue }
      keep.push(list[i])
    }
    out = keep.reverse()
  }
  const slimmed = []
  out = out.map((t, i) => {
    if (i >= FULL && !isOpen(t.status) && heavy(t)) {
      const s = slim(t)
      slimmed.push(s)
      return s
    }
    return t
  })
  return { out, dropped, slimmed }
}

function persist(changed, removed) {
  if (useDb) {
    if (changed.length) putRows(changed).catch((e) => console.error('Could not save transactions', e))
    if (removed && removed.length) deleteRows(removed).catch((e) => console.error('Could not delete transactions', e))
  } else {
    try { localStorage.setItem(TX_KEY, JSON.stringify(cache)) } catch (e) { console.error('Could not save transactions', e) }
  }
}

export function loadTransactions() {
  return cache
}
// Resolves when every change made so far is really stored (the background engine is told only after this)
export const whenSaved = () => (useDb ? settled() : Promise.resolve())

// Runs once when the app starts (main.jsx), before the app draws.
// The first time, it moves the old transactions out of localStorage into the database.

export async function initTransactions() {
  try {
    let rows = await loadRows()
    if (!rows.length) {
      const old = read(TX_KEY, [])
      if (Array.isArray(old) && old.length) {
        await putRows(old)
        rows = await loadRows()
        if (rows.length >= old.length) {
          try { localStorage.removeItem(TX_KEY) } catch (e) { /* ignore */ }
        }
      }
    }
    cache = rows
  } catch (e) {
    console.error('Could not open the transaction database, using the old storage', e)
    useDb = false
    const old = read(TX_KEY, [])
    cache = Array.isArray(old) ? old : []
  }
  // The customer summary has its own safety net, so a problem here never affects the transactions
  try {
    if (!useDb) throw new Error('no database')
    await loadCustomersFromDb()
  } catch (e) {
    console.error('Could not open the customer database, using the old storage', e)
    custDb = false
    const saved = read(CUSTOMERS_KEY, null)
    custMap = saved && typeof saved === 'object' ? saved : summaryFromTransactions()
  }
  tell()
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

// ---- Lifetime customer summary (never trimmed). Kept in memory, saved to the database ----
const custKey = (t) => String((t && (t.phone || t.name)) || '').trim()

let custMap = {}
let custDb = true

function addToSummary(map, tx) {
  const key = custKey(tx)
  if (!key) return
  const at = Number(tx.completedAt || tx.createdAt) || Date.now()
  const c = map[key] || (map[key] = {
    key, name: tx.name || tx.phone || '', phone: tx.phone || '',
    first: at, last: at, count: 0, total: 0,
  })
  c.count += 1
  c.total = Math.round((c.total + (Number(tx.amount) || 0)) * 100) / 100
  if (at < c.first) c.first = at
  if (at > c.last) c.last = at
  if (tx.name) c.name = tx.name
  if (tx.phone) c.phone = tx.phone
}

// Used once, to start the summary from the transactions you already have
function summaryFromTransactions() {
  const map = {}
  loadTransactions().filter((t) => t.status === 'Completed').forEach((t) => addToSummary(map, t))
  return map
}

// Runs at startup. The first time, it moves the old summary out of localStorage into the database.
async function loadCustomersFromDb() {
  const rows = await loadCustomerRows()
  if (rows.length) {
    custMap = {}
    rows.forEach((c) => { custMap[c.key] = c })
    return
  }
  const saved = read(CUSTOMERS_KEY, null)
  custMap = saved && typeof saved === 'object' ? saved : summaryFromTransactions()
  const list = Object.values(custMap)
  if (list.length) {
    await putCustomers(list)
    if (saved) {
      try { localStorage.removeItem(CUSTOMERS_KEY) } catch (e) { /* ignore */ }
    }
  }
}

export function loadCustomers() {
  return Object.values(custMap)
}

function recordCustomer(tx) {
  const key = custKey(tx)
  if (!key) return
  addToSummary(custMap, tx)
  if (custDb) putCustomers([custMap[key]]).catch((e) => console.error('Could not save customers', e))
  else write(CUSTOMERS_KEY, custMap)
}
// Airtime goes down when a transaction completes.
function applyCompletion(tx) {
  const cost = Number(tx.cost) || 0
  if (cost) write(AIRTIME_KEY, Math.max(0, loadAirtime() - cost))
  recordCustomer(tx)
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
  const { out, dropped, slimmed } = trim([tx, ...cache])
  cache = out
  persist([tx, ...slimmed], dropped)
  tell()
  return tx
}

export function updateTransaction(id, patch) {
  const at = cache.findIndex((t) => t.id === id)
  if (at < 0) return
  const old = cache[at]
  const next = { ...old, ...patch }
  if (patch.status === 'Completed' && old.status !== 'Completed') {
    next.completedAt = Date.now()
    applyCompletion(next)
  }
  if (patch.status && patch.status !== old.status) announce(next)
  const copy = cache.slice() // a new array, so screens redraw
  copy[at] = next
  cache = copy
  persist([next])
  tell()
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
  const list = cache
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
  const ids = []
  list.forEach((t) => {
    if (!gone.has(String(t.id))) return
    ids.push(t.id)
    marks.push(String(t.id))
    if (t.mpesaId) marks.push(String(t.mpesaId))
  })
  write(DELETED_KEY, [...new Set([...loadDeletedKeys(), ...marks])].slice(-1000))
  cache = list.filter((t) => !gone.has(String(t.id)))
  persist([], ids)
  tell()
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
    const isDemo = (t) => DEMO_ROWS.includes(`${t.name || ''}|${t.phone || ''}`)
    const ids = cache.filter(isDemo).map((t) => t.id)
    if (ids.length) {
      cache = cache.filter((t) => !isDemo(t))
      persist([], ids)
      tell()
    }
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
  // A wallet with no counter is new (or was wiped): start from the native counter, subtract nothing
  if (w.chargesApplied === undefined) {
    write(WALLET_KEY, { ...w, chargesApplied: t })
    return
  }
  const applied = Number(w.chargesApplied) || 0
  if (t <= applied) return
  const next = { ...w, chargesApplied: t }
  if (!(Number(w.unlimitedUntil) > Date.now())) {
    next.units = Math.max(0, (Number(w.units) || 0) - (t - applied))
  }
  write(WALLET_KEY, next)
}