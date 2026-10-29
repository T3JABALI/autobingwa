// Balances: airtime balance, airtime used per day, and commission (this week and per day).
// Everything is stored on the phone. Each day is keyed by the device date, so "today" restarts at midnight.
const COMM_KEY = 'ab:commission:snaps'
const USED_KEY = 'ab:airtime:used'
const BAL_KEY = 'ab:airtime:balance'

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.error('Could not save ' + key, e)
    return false
  }
}

// Tells open screens to redraw
function changed() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('ab-balances'))
  } catch (e) {
    // nothing to do
  }
}

const toNumber = (s) => Number(String(s).replace(/,/g, ''))
const round2 = (n) => Math.round(n * 100) / 100

export function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// The chart runs Sun to Sat, so a week starts on Sunday at midnight
export function startOfWeek(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d.getTime()
}

// ---------- Airtime balance (read from *144#) ----------
export function parseAirtimeBalance(text) {
  const t = String(text || '')
  // "Airtime Bal: 4081.00KSH." (amount first), or "Airtime balance is Ksh 1,250" (currency first)
  let m = t.match(/bal(?:ance)?[^0-9]{0,20}([\d,]+(?:\.\d+)?)\s*(?:ksh|kes)/i)
  if (!m) m = t.match(/(?:airtime|balance|bal)[^0-9]{0,40}(?:ksh|kes)\.?\s*([\d,]+(?:\.\d+)?)/i)
  if (!m) m = t.match(/([\d,]+(?:\.\d+)?)\s*(?:ksh|kes)/i)
  if (!m) m = t.match(/(?:ksh|kes)\.?\s*([\d,]+(?:\.\d+)?)/i)
  return m ? toNumber(m[1]) : null
}

export function setAirtimeBalance(value, slot, time = Date.now()) {
  write(BAL_KEY, { value: Number(value), slot, t: time })
  changed()
}

export function getAirtimeBalance() {
  return read(BAL_KEY, null)
}

// ---------- Airtime used (adds up every completed transaction, per day) ----------
export function addAirtimeUsed(amount, time = Date.now()) {
  const a = Number(amount) || 0
  if (a <= 0) return
  const ledger = read(USED_KEY, {})
  const k = dayKey(time)
  ledger[k] = round2((ledger[k] || 0) + a)
  const keys = Object.keys(ledger).sort()
  while (keys.length > 60) delete ledger[keys.shift()]
  write(USED_KEY, ledger)
  changed()
}

export function airtimeUsedToday(now = Date.now()) {
  return read(USED_KEY, {})[dayKey(now)] || 0
}

// ---------- Commission ----------
// Safaricom's message says: "... Total commission this week is Ksh.61.00"
export function parseCommission(text) {
  const m = String(text || '').match(/total\s+commission\s+this\s+week\s+is\s+(?:ksh|kes)\.?\s*([\d,]+(?:\.\d+)?)/i)
  return m ? toNumber(m[1]) : null
}

// Keeps every weekly total with the time it arrived. A repeated message is ignored.
export function recordCommission(id, total, time = Date.now()) {
  const snaps = read(COMM_KEY, [])
  if (snaps.some((s) => s.id === id)) return false
  snaps.push({ id, t: Number(time) || Date.now(), total: Number(total) })
  snaps.sort((a, b) => a.t - b.t)
  write(COMM_KEY, snaps.slice(-500))
  changed()
  return true
}

export function commissionThisWeek(now = Date.now()) {
  const snaps = read(COMM_KEY, [])
  const last = snaps[snaps.length - 1]
  return last && last.t >= startOfWeek(now) ? last.total : 0
}

// Seven values, Sun to Sat. A day's value is how much the weekly total grew that day.
// Days that have not happened yet are null, so the chart stops at today.
export function commissionByDay(now = Date.now()) {
  const snaps = read(COMM_KEY, [])
  const ws = startOfWeek(now)
  const today = new Date(now).getDay()
  const values = [0, 0, 0, 0, 0, 0, 0]
  let prev = null
  for (const s of snaps) {
    const newWeek = prev && startOfWeek(prev.t) !== startOfWeek(s.t)
    const delta = !prev ? 0 : newWeek || s.total < prev.total ? s.total : s.total - prev.total
    prev = s
    if (s.t >= ws && s.t < ws + 7 * 86400000) values[new Date(s.t).getDay()] += delta
  }
  return { values: values.map((v, i) => (i > today ? null : round2(v))), today }
}