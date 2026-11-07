// Tells the server about a confirmed airtime token payment, so it shows in the admin income.
// The price is never sent: the server uses its own price list. If the phone is offline, the report waits and is sent later.
const API = 'https://autobingwa-payments.onrender.com'
const KEY = 'tokens:airtimeReports'

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch (e) { /* ignore */ }
}

// true = done with this report (saved, or the server rejected it for good); false = try again later
async function send(r) {
  try {
    const res = await fetch(`${API}/tokens/airtime/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: r.packId, ref: r.ref }),
    })
    return res.ok || res.status === 400
  } catch (e) {
    return false
  }
}

let flushing = false
export async function flushAirtimeReports() {
  if (flushing) return
  flushing = true
  try {
    const keep = []
    for (const r of read()) {
      if (!(await send(r))) keep.push(r)
    }
    write(keep)
  } finally {
    flushing = false
  }
}

export function reportAirtime(packId) {
  if (!packId) return
  const ref = 'ap-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  write([...read(), { packId, ref }])
  flushAirtimeReports()
}