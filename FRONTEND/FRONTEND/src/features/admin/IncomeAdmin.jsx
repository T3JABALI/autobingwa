import { useEffect, useState } from 'react'
import { adminFetch } from './adminApi'
import './IncomeAdmin.css'

export const money = (n) => Number(n || 0).toLocaleString('en-KE')
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const sum = (a) => (a || []).reduce((s, x) => s + x, 0)
const dayFmt = (iso, n = 0) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const phoneFmt = (p) => (p ? (p.startsWith('254') ? '0' + p.slice(3) : p) : 'Phone not recorded')

/* ---------- One payment row (used on Home and in All transactions) ---------- */
const TONE = { Completed: 'ok', Pending: 'wait', Failed: 'bad', Cancelled: 'bad' }
export function TxRow({ t }) {
  const line2 = [t.item, t.name, phoneFmt(t.phone)].filter(Boolean).join(' · ')
  return (
    <div className="in-tx">
      <div className={`in-ico ${t.kind}`}>{t.kind === 'token' ? '◉' : '◎'}</div>
      <div className="in-main">
        <div className="in-l1">
          <b>{t.kind === 'token' ? 'Token subscription' : 'Portal subscription'}</b>
          <b className="in-amt">KSh {money(t.amount)}</b>
        </div>
        <div className="in-l2">{line2}</div>
        <div className="in-l3">{t.id} · {when(t.ts)}</div>
        <div className="in-tags">
          <span className={`in-tag ${t.method}`}>{t.method === 'mpesa' ? 'M-PESA' : 'AIRTIME'}</span>
          <span className={`in-tag st ${TONE[t.status] || 'wait'}`}>{t.status === 'Completed' ? '✔ ' : ''}{t.status}</span>
        </div>
      </div>
    </div>
  )
}

/* ---------- Bar chart (no library needed) ---------- */
const nice = (v) => {
  if (v <= 0) return 10
  const p = 10 ** Math.floor(Math.log10(v))
  const f = v / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}
const short = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))

function BarsChart({ series }) {
  const [sel, setSel] = useState(null)
  const W = 320, H = 170, L = 34, R = 6, T = 10, B = 24
  const max = nice(Math.max(1, ...series.flatMap((s) => s.data)))
  const gw = (W - L - R) / 7
  const bw = Math.min(14, (gw - 8) / series.length)
  const y = (v) => T + (H - T - B) * (1 - v / max)
  const ticks = [0, max / 2, max]
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="in-chart" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="in-grid" />
            <text x={L - 5} y={y(t) + 3} className="in-ytxt" textAnchor="end">{short(t)}</text>
          </g>
        ))}
        {DAYS.map((lb, i) => {
          const x0 = L + i * gw
          const used = bw * series.length + (series.length - 1) * 3
          const start = x0 + (gw - used) / 2
          return (
            <g key={lb} onClick={() => setSel(sel === i ? null : i)}>
              <rect x={x0} y={T} width={gw} height={H - T - B} className={sel === i ? 'in-sel on' : 'in-sel'} />
              {series.map((s, k) => {
                const v = s.data[i] || 0
                return (
                  <rect key={s.name} x={start + k * (bw + 3)} y={y(v)} width={bw}
                    height={Math.max(H - B - y(v), v > 0 ? 2 : 0)} rx="3" fill={s.color} />
                )
              })}
              <text x={x0 + gw / 2} y={H - 8} className="in-xtxt" textAnchor="middle">{lb}</text>
            </g>
          )
        })}
      </svg>
      <div className="in-legend">
        {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <p className="in-pick">
        {sel === null
          ? 'Tap a day to see the amounts'
          : `${DAYS[sel]}: ` + series.map((s) => `${s.name} KSh ${money(s.data[sel])}`).join(' · ')}
      </p>
    </>
  )
}

function ChartCard({ title, sub, series }) {
  return (
    <div className="in-card">
      <h3>{title}</h3>
      <p className="in-sub">{sub}</p>
      <BarsChart series={series} />
    </div>
  )
}

/* ---------- Overview: this week vs last week + 3 graphs ---------- */
function Overview() {
  const [w, setW] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    adminFetch('/admin/income/week').then(setW).catch((e) => setErr(e.message || 'Could not load the income.'))
  }, [])

  if (err) return <p className="in-err">{err}</p>
  if (!w) return <p className="in-msg">Loading…</p>

  const thisT = sum(w.total.this), lastT = sum(w.total.last)
  const lastSoFar = sum(w.total.last.slice(0, w.today + 1))
  const diff = lastSoFar > 0 ? Math.round(((thisT - lastSoFar) / lastSoFar) * 100) : null
  const range = (iso) => `${dayFmt(iso)} – ${dayFmt(iso, 6)}`
  const THIS = '#f7941d', LAST = '#5b6b94'

  return (
    <>
      <div className="in-card">
        <h3>Income this week vs last week</h3>
        <p className="in-sub">Monday to Sunday</p>
        <div className="in-cmp">
          <div className="in-box now">
            <small>This week</small>
            <b>KSh {money(thisT)}</b>
            <span>{range(w.thisStart)}</span>
          </div>
          <div className="in-box">
            <small>Last week</small>
            <b>KSh {money(lastT)}</b>
            <span>{range(w.lastStart)}</span>
          </div>
        </div>
        <div className={`in-change ${diff === null ? '' : diff >= 0 ? 'up' : 'down'}`}>
          {diff === null
            ? 'Nothing to compare with yet'
            : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% compared with the same days last week`}
        </div>
        <div className="in-split">
          <span><i style={{ background: '#22c55e' }} />M-Pesa KSh {money(sum(w.mpesa.this))}</span>
          <span><i style={{ background: '#f97316' }} />Airtime KSh {money(sum(w.airtime.this))}</span>
        </div>
      </div>

      <ChartCard title="Token subscriptions"
        sub={`This week KSh ${money(sum(w.tokens.this))} · Last week KSh ${money(sum(w.tokens.last))}`}
        series={[{ name: 'This week', color: THIS, data: w.tokens.this }, { name: 'Last week', color: LAST, data: w.tokens.last }]} />

      <ChartCard title="Portal subscriptions"
        sub={`This week KSh ${money(sum(w.portal.this))} · Last week KSh ${money(sum(w.portal.last))}`}
        series={[{ name: 'This week', color: THIS, data: w.portal.this }, { name: 'Last week', color: LAST, data: w.portal.last }]} />

      <ChartCard title="M-Pesa vs Airtime"
        sub="Payments received this week"
        series={[{ name: 'M-Pesa', color: '#22c55e', data: w.mpesa.this }, { name: 'Airtime', color: '#f97316', data: w.airtime.this }]} />
    </>
  )
}

/* ---------- All transactions ---------- */
function Chips({ value, onChange, options }) {
  return (
    <div className="in-chips">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

function AllTx() {
  const [f, setF] = useState({ q: '', kind: 'all', method: 'all', status: 'all' })
  const [items, setItems] = useState([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }))

  async function load(offset) {
    setBusy(true)
    try {
      const url = `/admin/income/transactions?limit=30&offset=${offset}&kind=${f.kind}&method=${f.method}&status=${f.status}&q=${encodeURIComponent(f.q.trim())}`
      const j = await adminFetch(url)
      setItems((p) => (offset ? [...p, ...j.tx] : j.tx))
      setMore(Boolean(j.more))
      setErr('')
    } catch (e) {
      setErr(e.message || 'Could not load the transactions.')
    }
    setBusy(false)
  }
  useEffect(() => {
    const t = setTimeout(() => load(0), f.q ? 350 : 0)
    return () => clearTimeout(t)
  }, [f.q, f.kind, f.method, f.status])

  return (
    <>
      <div className="in-filters">
        <input className="in-search" placeholder="Search phone or transaction ID" value={f.q} onChange={(e) => set('q')(e.target.value)} />
        <Chips value={f.kind} onChange={set('kind')} options={[['all', 'All types'], ['token', 'Tokens'], ['portal', 'Portal']]} />
        <Chips value={f.method} onChange={set('method')} options={[['all', 'All money'], ['mpesa', 'M-Pesa'], ['airtime', 'Airtime']]} />
        <Chips value={f.status} onChange={set('status')} options={[['all', 'All status'], ['completed', 'Completed'], ['pending', 'Pending'], ['failed', 'Failed']]} />
      </div>
      <div className="in-txlist">
        {err && <p className="in-err">{err}</p>}
        {items.map((t) => <TxRow key={t.key} t={t} />)}
        {!busy && !err && items.length === 0 && <p className="in-msg">No transactions found</p>}
        {busy && <p className="in-msg">Loading…</p>}
      </div>
      {more && !busy && <button className="in-more" onClick={() => load(items.length)}>Load more</button>}
    </>
  )
}

export default function IncomeAdmin({ start = '' }) {
  const [tab, setTab] = useState(start === 'tx' ? 'tx' : 'overview')
  return (
    <div>
      <div className="in-tabs">
        <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'tx' ? 'on' : ''} onClick={() => setTab('tx')}>All transactions</button>
      </div>
      {tab === 'overview' ? <Overview /> : <AllTx />}
    </div>
  )
}