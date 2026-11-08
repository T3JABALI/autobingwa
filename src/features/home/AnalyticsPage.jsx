import { useEffect, useMemo, useState } from 'react'
import { GlowChart, WEEKDAYS } from './CommissionChart.jsx'
import { subscribe, loadTransactions } from './dataStore.js'
const DAY = 86400000
const HOUR_START = 6 // first 3-hour block starts at 6 AM
const BLOCKS = 6 // 6 blocks of 3 hours: 6 AM to midnight
const BLOCK_LABELS = ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM']
const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']]

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const kes = (n) => `KES ${r2(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`
const sum = (a) => a.reduce((s, v) => s + v, 0)
const startOfDay = (ts) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const startOfWeek = (ts) => {
  const d = new Date(startOfDay(ts))
  d.setDate(d.getDate() - d.getDay()) // Sunday
  return d.getTime()
}

const ICON = {
  bag: (
    <>
      <path d="M6 8h12l1 12H5L6 8z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  cash: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
}
const Ico = ({ name }) => <svg viewBox="0 0 24 24" aria-hidden="true">{ICON[name]}</svg>

export default function AnalyticsPage({ txs = [], now = Date.now() }) {
  const [period, setPeriod] = useState('week')

  // Every completed sale: money in, airtime spent, when, and which offer
  const done = useMemo(
    () =>
      txs
        .filter((t) => t.status === 'Completed')
        .map((t) => ({
          at: t.completedAt || t.createdAt,
          money: Number(t.amount) || 0,
          air: Number(t.cost) || 0,
          offer: t.offerName || 'Unknown',
        }))
        .filter((t) => t.at),
    [txs]
  )

  // ---- This week, Sunday to Saturday ----
  const weekStart = startOfWeek(now)
  const moneyW = Array(7).fill(0)
  const airW = Array(7).fill(0)
  done.forEach((t) => {
    if (t.at >= weekStart && t.at < weekStart + 7 * DAY) {
      const i = new Date(t.at).getDay()
      moneyW[i] += t.money
      airW[i] += t.air
    }
  })
  const today = new Date(now).getDay()
  const weekMoney = sum(moneyW)
  const weekAir = sum(airW)
  const dayMargin = moneyW[today] - airW[today]
  const weekMargin = weekMoney - weekAir

  // ---- Today by the hour, in 3-hour blocks ----
  const dayStart = startOfDay(now)
  const hourly = Array(BLOCKS).fill(0)
  done.forEach((t) => {
    if (t.at >= dayStart && t.at < dayStart + DAY) {
      const b = Math.floor((new Date(t.at).getHours() - HOUR_START) / 3)
      if (b >= 0 && b < BLOCKS) hourly[b] += t.money - t.air
    }
  })
  const nowBlock = Math.max(-1, Math.min(BLOCKS - 1, Math.floor((new Date(now).getHours() - HOUR_START) / 3)))

  // ---- Offers analysis ----
  const d = new Date(now)
  const from =
    period === 'today' ? dayStart : period === 'week' ? weekStart : new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const inRange = done.filter((t) => t.at >= from)
  const revenue = sum(inRange.map((t) => t.money))
  const byOffer = {}
  inRange.forEach((t) => { byOffer[t.offer] = (byOffer[t.offer] || 0) + 1 })
  const top = Object.entries(byOffer).sort((a, b) => b[1] - a[1])[0]

  const offerCard = (icon, tone, label, value, note) => (
    <div className="an-offer">
      <span className={`an-ico ${tone}`}><Ico name={icon} /></span>
      <div className="an-offer-text">
        <small>{label}</small>
        <b>{value}</b>
        {note && <em>{note}</em>}
      </div>
    </div>
  )

  return (
    <div className="an-wrap">
      <div className="an-top">
        <div>
          <h2>Analytics</h2>
          <small>Real-time performance metrics</small>
        </div>
        <span className="an-live"><i />LIVE</span>
      </div>

      <div className="an-card">
        <h3 className="an-title">Money received vs Airtime used</h3>
        <p className="an-sub">This week, Sunday to Saturday</p>
        <div className="an-legend">
          <div className="an-leg">
            <span><i className="an-dot" style={{ background: 'var(--primary)' }} />Money received</span>
            <b>{kes(weekMoney)}</b>
          </div>
          <div className="an-leg">
            <span><i className="an-dot" style={{ background: 'var(--warning)' }} />Airtime used</span>
            <b>{kes(weekAir)}</b>
          </div>
        </div>
        <div className="an-chart">
          <GlowChart
            uid="wk"
            labels={WEEKDAYS}
            upto={today}
            highlight={today}
            series={[
              { values: moneyW, color: 'var(--primary)', fill: true },
              { values: airW, color: 'var(--warning)' },
            ]}
          />
        </div>
        <div className="an-two">
          <div className="an-stat">
            <small>Daily margin</small>
            <b className={dayMargin >= 0 ? 'an-pos' : 'an-neg'}>{kes(dayMargin)}</b>
          </div>
          <div className="an-stat">
            <small>Weekly margin</small>
            <b className={weekMargin >= 0 ? 'an-pos' : 'an-neg'}>{kes(weekMargin)}</b>
          </div>
        </div>
      </div>

      <div className="an-card">
        <h3 className="an-title">Hourly performance</h3>
        <p className="an-sub">Revenue by the hour (today), every 3 hours</p>
        <div className="an-chart">
          <GlowChart uid="hr" labels={BLOCK_LABELS} upto={nowBlock} highlight={nowBlock} showValues
            series={[{ values: hourly, color: 'var(--primary)', fill: true }]} />
        </div>
      </div>

      <div className="an-card">
        <h3 className="an-title">Offers analysis</h3>
        <div className="an-chips">
          {PERIODS.map(([k, label]) => (
            <button key={k} className={`an-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
          ))}
        </div>
        <div className="an-offers">
          {offerCard('bag', 'blue', 'Total sales', `${inRange.length} sales`)}
          {offerCard('cash', 'green', 'Revenue', kes(revenue))}
          {offerCard('bolt', 'gold', 'Top plan', top ? top[0] : '—', top ? `Sold ${top[1]} time${top[1] === 1 ? '' : 's'}` : 'No sales yet')}
        </div>
      </div>
    </div>
  )
}

// Used by App.jsx: loads its own data and keeps it fresh
export function AnalyticsScreen() {
  const [txs, setTxs] = useState(loadTransactions)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const off = subscribe(() => {
      setTxs(loadTransactions())
      setNow(Date.now())
    })
    const tick = setInterval(() => setNow(Date.now()), 60000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [])
  return (
    <div className="hm-page hm-s-analytics">
      <AnalyticsPage txs={txs} now={now} />
    </div>
  )
}