import { notify } from '../notify/notify.js'

const TX_KEY = 'transactions:list'
const AIRTIME_KEY = 'airtime:balance'
const WALLET_KEY = 'tokens:wallet'
const CONFIG_KEY = 'settings:config'
const EVENT = 'autobingwa-data'

// Tokens used by each successful transaction (not used while an unlimited plan is active).
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

// Airtime and tokens go down when a transaction completes.
function applyCompletion(tx) {
  const cost = Number(tx.cost) || 0
  if (cost) write(AIRTIME_KEY, Math.max(0, loadAirtime() - cost))
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
  write(TX_KEY, [tx, ...loadTransactions()])
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

export function deleteTransaction(id) {
  write(TX_KEY, loadTransactions().filter((t) => t.id !== id))
}

function stampOf(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  const h = d.getHours()
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} at ${h % 12 || 12}:${p(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`
}

// Sample data so you can test the page.
export function seedDemo(offers = []) {
  const now = Date.now()
  const pickOffer = (i) => offers[i % Math.max(offers.length, 1)] || {}
  const rows = [
    ['Faith Simiyu', '0704590730', 20, 15, 'Completed', -5],
    ['Ruth Mogaka', '0759461380', 50, 40, 'Completed', -40],
    ['Purity Bowen', '0769010855', 30, 24, 'Completed', -95],
    ['Sydney Wangwe', '0797609585', 20, 15, 'Pending', -2],
    ['Imran Ahmed', '0711723954', 100, 85, 'Failed', -120],
    ['Mitchelle Makokha', '0791818480', 19, 15, 'Completed', -180],
    ['Joy Wanjiku', '0722334455', 50, 40, 'Scheduled', 0],
    ['Brian Otieno', '0733445566', 30, 24, 'Completed', -1440],
    ['Amina Hassan', '0744556677', 20, 15, 'Completed', -1500],
    ['Peter Kamau', '0755667788', 50, 40, 'Completed', -2900],
  ]

  const list = rows.map(([name, phone, amount, cost, status, mins], i) => {
    const scheduled = status === 'Scheduled'
    const createdAt = scheduled ? now - 10 * 60000 : now + mins * 60000
    const code = Math.random().toString(36).slice(2, 12).toUpperCase()
    const offer = pickOffer(i)
    const ussd = (offer.ussd || '*180*5*2*ab*5*1#').replaceAll('ab', phone)
    const responses =
      status === 'Completed'
        ? [
            { input: '5', text: '1:Daily\n2:Weekly\n3:Monthly\n4:Deals' },
            { input: '2', text: '1:Confirm\n2:Cancel' },
            { input: '1', text: 'Your request is being processed. You will receive an SMS shortly.' },
          ]
        : status === 'Failed'
          ? [{ input: '5', text: 'Request failed. Please try again later.' }]
          : []
    return {
      id: newId() + i,
      name, phone, amount, cost, status, createdAt,
      offerName: offer.name || `${amount} bob offer`,
      completedAt: status === 'Completed' ? createdAt + 20000 : null,
      scheduledFor: scheduled ? now + 180 * 60000 : null,
      rawMessage: `${code} Confirmed. on ${stampOf(createdAt)} Ksh${amount}.00 received from 254${phone.slice(1)} ${name.toUpperCase()}. New M-PESA balance is Ksh${(5000 + i * 137).toFixed(2)}.`,
      ussd,
      responses,
    }
  })

  write(TX_KEY, list)
  if (loadAirtime() === 0) write(AIRTIME_KEY, 11274.24)
}