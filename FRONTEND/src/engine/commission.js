// Turns Safaricom's weekly total into a per-day amount.
// state = { lastTotal: number|null, days: { 'YYYY-MM-DD': amount } }
export function applyCommission(state, total, dateKey) {
  const s = { lastTotal: state?.lastTotal ?? null, days: { ...(state?.days || {}) } }
  let add = 0
  if (s.lastTotal === null) add = 0                 // first message = baseline only
  else if (total >= s.lastTotal) add = total - s.lastTotal
  else add = total                                  // new week started
  s.days[dateKey] = Math.round(((s.days[dateKey] || 0) + add) * 100) / 100
  s.lastTotal = total
  return s
}