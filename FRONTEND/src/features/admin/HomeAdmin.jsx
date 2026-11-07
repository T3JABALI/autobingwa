import { useEffect, useState } from 'react'
import { adminFetch } from './adminApi'
import { TxRow, money } from './IncomeAdmin'

const QUICK = [
  ['users', 'Users', 'Manage app users', '♙'],
  ['analytics', 'Analytics', 'View app stats', '▮'],
  ['income', 'Income', 'Track revenue', '▣'],
]

export default function HomeAdmin({ name, go }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])
  const h = now.getHours() // the device's own timezone
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const city = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop().replace(/_/g, ' ')

  async function load() {
    try {
      setD(await adminFetch('/admin/income/summary'))
      setErr('')
    } catch (e) {
      setErr(e.message || 'Could not load the income.')
    }
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  const monthLabel = d ? new Date(d.month + '-01T00:00:00').toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }) : ''
  const num = (v) => (d ? money(v) : '—')
  const cards = [
    { icon: '☎', label: 'Airtime', value: d && d.airtime, n: d && d.airtimeN },
    { icon: '▤', label: 'M-Pesa', value: d && d.mpesa, n: d && d.mpesaN },
    { icon: '▣', label: 'Total Income', value: d && d.total, n: d && d.airtimeN + d.mpesaN },
  ]

  return (
    <>
      <div className="ad-hello">
        <div className="ad-hello-row">
          <span className="ad-sun">☼</span>
          <span className="ad-greet">{greet}, {name}</span>
          <span className="ad-badge">★ SUPER ADMIN</span>
        </div>
        <div className="ad-title-row">
          <h1>Home Dashboard</h1>
          <span className="ad-sample">{city}{monthLabel ? ' · ' + monthLabel : ''}</span>
        </div>
      </div>

      {err && <p className="in-err">{err}</p>}

      <div className="ad-stats">
        {cards.map((s) => (
          <div className="ad-stat" key={s.label}>
            <div className="ad-stat-top"><span className="ad-stat-icon">{s.icon}</span><span className="ad-stat-label">{s.label}</span></div>
            <div className="ad-stat-value"><small>KSh</small> {num(s.value)}</div>
            <div className="ad-stat-note">{d ? `${s.n} payment${s.n === 1 ? '' : 's'} this month` : ' '}</div>
          </div>
        ))}
      </div>

      <div className="ad-card ad-txcard">
        <div className="ad-card-head">
          <span className="ad-clock">◷</span>
          <div>
            <b>Recent Transactions</b>
            <small>Latest subscription payments</small>
          </div>
          <button className="ad-link" onClick={() => go('income', 'tx')}>View All →</button>
        </div>
        <div className="in-txlist">
          {d && d.recent.length === 0 && <p className="in-msg">No payments yet</p>}
          {!d && !err && <p className="in-msg">Loading…</p>}
          {d && d.recent.slice(0, 5).map((t) => <TxRow key={t.key} t={t} />)}
        </div>
      </div>

      <div className="ad-quick-title">▦ Quick Access</div>
      <div className="ad-quick">
        {QUICK.map(([id, title, sub, icon]) => (
          <button key={id} className="ad-quick-btn" onClick={() => go(id)}>
            <span className="ad-quick-icon">{icon}</span>
            <b>{title}</b>
            <small>{sub} →</small>
          </button>
        ))}
      </div>
    </>
  )
}