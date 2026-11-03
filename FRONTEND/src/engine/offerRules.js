// Rules for offers. Pure functions: no screens, no storage.

export const CATEGORIES = ['DATA', 'MINUTES', 'SMS', 'TUNUKIWA']

// No spaces, AB always upper case
export const normalizeUssd = (u) =>
  String(u || '').trim().replace(/\s+/g, '').replace(/\*ab(?=[*#])/gi, '*AB')

// '' when the USSD is fine, otherwise the message to show under the box
export function checkUssd(u) {
  const t = normalizeUssd(u)
  if (!t) return 'Enter the USSD code'
  if (!/^\*\d+(\*[0-9A-Za-z]+)*#$/.test(t)) return 'Use the form *180*5*2*AB*1*1#'
  const ab = (t.match(/\*AB(?=[*#])/g) || []).length
  if (ab === 0) return "Put AB where the customer's phone number goes"
  if (ab > 1) return 'AB can only appear once'
  return ''
}

const mins = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// tw = { on, from: '19:00', until: '23:00' }. Windows that cross midnight (22:00 to 02:00) work too.
export function inWindow(tw, at = new Date()) {
  if (!tw || !tw.on) return true
  const now = at.getHours() * 60 + at.getMinutes()
  const a = mins(tw.from)
  const b = mins(tw.until)
  if (a === b) return true
  return a < b ? now >= a && now < b : now >= a || now < b
}

// Which offer handles a payment of this amount right now?
// Returns { offer, primary } or null. `primary` is set when the alternative offer was used
// because the matching offer is outside its time window.
export function pickOffer(offers, amount, at = new Date()) {
  const same = offers.filter((o) => o.enabled && Number(o.price) === Number(amount))
  if (!same.length) return null
  const open = same.filter((o) => inWindow(o.tw, at))
  if (open.length) {
    // a timed offer that is open beats an untimed one with the same price
    return { offer: open.find((o) => o.tw && o.tw.on) || open[0], primary: null }
  }
  for (const p of same) {
    const id = p.tw ? p.tw.altId : ''
    if (id === '' || id === undefined || id === null) continue
    const alt = offers.find((x) => String(x.id) === String(id) && x.enabled)
    if (alt && inWindow(alt.tw, at)) return { offer: alt, primary: p }
  }
  return null
}

// '06:00' -> the timestamp of 06:00 tomorrow
export function nextDayAt(hhmm, from = Date.now()) {
  const d = new Date(from)
  d.setDate(d.getDate() + 1)
  const m = mins(hhmm)
  d.setHours(Math.floor(m / 60), m % 60, 0, 0)
  return d.getTime()
}

// "Hi {name}, your {offer} is ready" -> filled in. Unknown {words} are left as they are.
export function fillTemplate(t, vars) {
  return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

// Used by the Edit sheet.
// Smart offers: the USSD and the saved signature stay locked, everything else can change.
// Manual offers: any edit switches the signature off, so it has to be learnt again.
export function applyEdit(offer, patch) {
  if (offer.smart) {
    const { ussd, sig, sigEnabled, sigLearned, smart, signature, ...rest } = patch
    return { ...offer, ...rest }
  }
  return {
    ...offer, ...patch,
    ussd: normalizeUssd((patch.ussd !== undefined ? patch.ussd : offer.ussd)),
    sig: null, sigLearned: false, sigEnabled: false,
  }
}