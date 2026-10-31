const KEY = 'autoreplies:list'

function readReplies() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

// <firstName>, <amount> ... are filled in. Unknown <words> are left as they are.
export function fillTemplate(text, data = {}) {
  return String(text || '').replace(/<(\w+)>/g, (m, k) => (data[k] !== undefined ? data[k] : m))
}

// trigger: success | recommended | failed | unavailable | paused | blacklisted
// A reply set for the exact amount wins over one for any amount.
export function findAutoReply(trigger, amount) {
  const list = readReplies().filter((r) => r.enabled && r.trigger === trigger)
  return (
    list.find((r) => Array.isArray(r.amounts) && r.amounts.includes(Number(amount))) ||
    list.find((r) => !r.amounts || !r.amounts.length) ||
    null
  )
}