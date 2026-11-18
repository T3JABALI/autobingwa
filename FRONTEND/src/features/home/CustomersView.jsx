import { useMemo, useState } from 'react'

const DAY = 86400000
const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']]

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const kes = (n) => `KES ${r2(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }
const startOfWeek = (ts) => { const d = new Date(startOfDay(ts)); d.setDate(d.getDate() - d.getDay()); return d.getTime() }
const initials = (n) =>
  String(n || '#').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#'
const ago = (ts, now) => {
  const d = Math.floor((now - ts) / DAY)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
}

function ContactCard({ c, now }) {
  return (
    <div className="cu-contact">
      <span className="cu-avatar">{initials(c.name)}</span>
      <div className="cu-contact-main">
        <b>{c.name || c.phone || 'Unknown'}</b>
        {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <small>No number saved</small>}
        <small>{c.count} purchase{c.count === 1 ? '' : 's'} · last {ago(c.last, now)}</small>
      </div>
      <div className="cu-contact-end">
        <small>Net purchase</small>
        <b>{kes(c.total)}</b>
      </div>
    </div>
  )
}

export default function CustomersView({ done, lifetime = [], now }) {
  const [period, setPeriod] = useState('week')
  const [view, setView] = useState(null) // null | 'top' | 'risk' | 'new'

  const d = new Date(now)
  const from =
    period === 'today' ? startOfDay(now)
    : period === 'week' ? startOfWeek(now)
    : new Date(d.getFullYear(), d.getMonth(), 1).getTime()

  // Lifetime facts come from the saved summary; "this period" facts come from recent sales
  const customers = useMemo(() => {
    const map = {}
    lifetime.forEach((c) => { map[c.key] = { ...c, inRange: 0, bought: false } })
    done.forEach((t) => {
      const key = String(t.phone || t.name || '').trim()
      if (!key) return
      if (!map[key]) {
        map[key] = { key, name: t.name || t.phone, phone: t.phone || '', first: t.at, last: t.at, count: 1, total: t.money, inRange: 0, bought: false }
      }
      if (t.at >= from) {
        map[key].inRange += t.money
        map[key].bought = true
      }
    })
    return Object.values(map)
  }, [done, lifetime, from])

  const buyers = customers.filter((c) => c.bought)
  const fresh = customers.filter((c) => c.first >= from).sort((a, b) => b.first - a.first)
  const returning = buyers.filter((c) => c.first < from)
  const active = customers.filter((c) => now - c.last <= 7 * DAY)
  const slipping = customers.filter((c) => now - c.last > 7 * DAY && now - c.last <= 30 * DAY)
  const dormant = customers.filter((c) => now - c.last > 30 * DAY)
  const top = [...customers].sort((a, b) => b.total - a.total)
  const atRisk = customers.filter((c) => c.count >= 2 && now - c.last > 7 * DAY).sort((a, b) => b.total - a.total)

  const all = customers.length
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0)
  const repeatPct = pct(customers.filter((c) => c.count >= 2).length, all)
  const returningPct = pct(returning.length, buyers.length)
  const spendInRange = customers.reduce((s, c) => s + c.inRange, 0)
  const avgSpend = buyers.length ? spendInRange / buyers.length : 0

  // ---- Contact list page ----
  if (view) {
    const pages = {
      top: ['Top customers', 'Ranked by total money spent', top],
      risk: ['At-risk contacts', 'Regulars who stopped buying', atRisk],
      new: ['New customers', PERIODS.find((p) => p[0] === period)[1], fresh],
    }
    const [title, sub, rows] = pages[view]
    return (
      <div className="cu-wrap">
        <div className="cu-head">
          <button className="cu-back" onClick={() => setView(null)} aria-label="Back">
            <svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" /></svg>
          </button>
          <div><h3>{title}</h3><small>{sub} · {rows.length}</small></div>
        </div>
        {rows.length === 0 && <div className="cu-empty">No customers here yet</div>}
        <div className="cu-list">
          {rows.map((c) => <ContactCard key={c.key} c={c} now={now} />)}
        </div>
      </div>
    )
  }

  const stat = (label, value, tone) => (
    <div className={`cu-bubble ${tone || ''}`}><small>{label}</small><b>{value}</b></div>
  )
  const base = (color, label, note, list) => (
    <div className="cu-base-row">
      <i style={{ background: color }} />
      <div><b>{label}</b><small>{note}</small></div>
      <strong>{list.length}</strong>
    </div>
  )
  const link = (label, note, count, key) => (
    <button className="cu-link" onClick={() => setView(key)}>
      <div><b>{label}</b><small>{note}</small></div>
      <span>{count}<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span>
    </button>
  )
  const seg = (list, color) => ({ w: all ? (list.length / all) * 100 : 0, color })

  return (
    <div className="cu-wrap">
      <div className="an-chips">
        {PERIODS.map(([k, label]) => (
          <button key={k} className={`an-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
        ))}
      </div>

      <div className="cu-three">
        {stat('Total', buyers.length)}
        {stat('New', fresh.length, 'blue')}
        {stat('Returning', returning.length, 'green')}
      </div>

      <div className="an-card">
        <h3 className="an-title">Customer health</h3>
        <p className="an-sub">As of today · {all} customer{all === 1 ? '' : 's'}</p>
        <div className="cu-bar">
          {[seg(active, 'var(--success)'), seg(slipping, 'var(--warning)'), seg(dormant, 'var(--danger)')].map((s, i) => (
            <span key={i} style={{ width: `${s.w}%`, background: s.color }} />
          ))}
        </div>
        {base('var(--success)', 'Active', 'Bought in the last 7 days', active)}
        {base('var(--warning)', 'Slipping', 'Quiet for 8 to 30 days', slipping)}
        {base('var(--danger)', 'Dormant', 'Quiet for over 30 days', dormant)}
      </div>

      <div className="cu-three">
        {stat('Repeat buyers', `${repeatPct}%`)}
        {stat('Came back', `${returningPct}%`)}
        {stat('Avg spend', kes(avgSpend))}
      </div>

      <div className="an-card">
        <h3 className="an-title">Customer lists</h3>
        {link('Top customers', 'Biggest spenders', '', 'top')}
        {link('At-risk contacts', 'Regulars who stopped buying', atRisk.length, 'risk')}
        {link('New customers', PERIODS.find((p) => p[0] === period)[1], fresh.length, 'new')}
      </div>
    </div>
  )
}