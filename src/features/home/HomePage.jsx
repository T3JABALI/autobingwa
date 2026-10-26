import { useEffect, useState } from 'react'
import {
  subscribe, loadTransactions, loadAirtime, loadWallet,
  updateTransaction, deleteTransaction, seedDemo,
} from './dataStore.js'
import { CSS } from './homeStyles.js'
import CommissionChart, { WEEKDAYS } from './CommissionChart.jsx'
import { Icon, InfoCard } from './HomeParts.jsx'

const DAY = 86400000
const FILTERS = ['All', 'Completed', 'Pending', 'Scheduled', 'Failed']
const TONE = { Completed: 'ok', Pending: 'warn', Scheduled: 'info', Failed: 'bad' }

const pad = (n) => String(n).padStart(2, '0')
const money = (n) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const startOfDay = (ts) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const fmtDate = (ts) => {
  const d = new Date(ts)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`
}
const fmtTime = (ts) => {
  const d = new Date(ts)
  const h = d.getHours()
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`
}
const toDateValue = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const toTimeValue = (ts) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ago(ts, now) {
  const mins = Math.max(0, Math.floor((now - ts) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}

function unlimitedLeft(until, now) {
  const ms = until - now
  if (ms <= 0) return ''
  const d = Math.floor(ms / DAY)
  const h = Math.floor((ms % DAY) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${d}d ${h}h ${m}m left`
}

export default function HomePage({ offers = [], onOpenTokens }) {
  const [txs, setTxs] = useState(loadTransactions)
  const [airtime, setAirtime] = useState(loadAirtime)
  const [wallet, setWallet] = useState(loadWallet)
  const [now, setNow] = useState(Date.now())
  const [hide, setHide] = useState(false)
  const [filter, setFilter] = useState('All')
  const [view, setView] = useState({ name: 'home', id: null })
  const [spin, setSpin] = useState(false)
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState({})
  const [when, setWhen] = useState({ date: '', time: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    const sync = () => {
      setTxs(loadTransactions())
      setAirtime(loadAirtime())
      setWallet(loadWallet())
      setNow(Date.now())
    }
    const off = subscribe(sync)
    const tick = setInterval(() => setNow(Date.now()), 60000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [])

  // ---- Numbers shown on the dashboard ----
  const todayStart = startOfDay(now)
  const todays = txs.filter((t) => t.createdAt >= todayStart)
  const counts = {
    Completed: todays.filter((t) => t.status === 'Completed').length,
    Pending: todays.filter((t) => t.status === 'Pending').length,
    Scheduled: txs.filter((t) => t.status === 'Scheduled').length,
    Failed: todays.filter((t) => t.status === 'Failed').length,
  }
  const airtimeUsed = txs
    .filter((t) => t.status === 'Completed' && (t.completedAt || t.createdAt) >= todayStart)
    .reduce((sum, t) => sum + (Number(t.cost) || 0), 0)

  const weekStartDate = new Date(todayStart)
  weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay())
  const weekStart = weekStartDate.getTime()
  const todayIndex = new Date(now).getDay()
  const values = WEEKDAYS.map((_, i) =>
    txs
      .filter((t) => t.status === 'Completed')
      .reduce((sum, t) => {
        const at = t.completedAt || t.createdAt
        const inDay = at >= weekStart + i * DAY && at < weekStart + (i + 1) * DAY
        return inDay ? sum + Math.max(0, (Number(t.amount) || 0) - (Number(t.cost) || 0)) : sum
      }, 0)
  )
  const weekTotal = values.reduce((a, b) => a + b, 0)

  const unlimitedActive = wallet.unlimitedUntil > now
  const mask = (text) => (hide ? '••••••' : text)

  const recent = txs
    .filter((t) => filter === 'All' || t.status === filter)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)

  const tx = view.id ? txs.find((t) => t.id === view.id) : null
  const screen = tx ? view.name : 'home'

  // ---- Actions ----
  function refreshBalance() {
    setSpin(true)
    setAirtime(loadAirtime())
    setWallet(loadWallet())
    setNow(Date.now())
    setTimeout(() => {
      setSpin(false)
      setNotice('Balance refreshed')
    }, 700)
  }

  function openDetail(id) {
    setOpen({})
    setNotice('')
    setView({ name: 'detail', id })
  }

  function goHome() {
    setView({ name: 'home', id: null })
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Copied')
    } catch (e) {
      setNotice('Could not copy. Select the text and copy it by hand.')
    }
  }

  function retry(t) {
    updateTransaction(t.id, { status: 'Pending', scheduledFor: null })
    setNotice('Retrying. Please wait...')
    // Demo only: your phone app will report the real result.
    setTimeout(() => {
      updateTransaction(t.id, { status: 'Completed' })
      setNotice('Transaction completed')
    }, 3000)
  }

  function openReschedule(t) {
    const soon = Date.now() + 5 * 60000
    setWhen({ date: toDateValue(soon), time: toTimeValue(soon) })
    setError('')
    setView({ name: 'reschedule', id: t.id })
  }

  function confirmReschedule() {
    const at = new Date(`${when.date}T${when.time}`)
    if (!when.date || !when.time || Number.isNaN(at.getTime())) return setError('Choose a date and time')
    if (at.getTime() <= Date.now()) return setError('Choose a time in the future')
    updateTransaction(view.id, { status: 'Scheduled', scheduledFor: at.getTime() })
    setNotice(`Rescheduled for ${fmtDate(at.getTime())} at ${fmtTime(at.getTime())}`)
    setView({ name: 'detail', id: view.id })
  }

  function remove(t) {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return
    deleteTransaction(t.id)
    setNotice('Transaction deleted')
    goHome()
  }

  function loadDemo() {
    seedDemo(offers)
    setNotice('Demo transactions loaded')
  }

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  const responseText = (t) =>
    t.responses && t.responses.length
      ? t.responses.map((r, i) => `--- Screen ${i + 1} (input: ${r.input}) ---\n${r.text}`).join('\n\n')
      : 'No response recorded yet.'

  return (
    <div className="hm-page">
      <style>{CSS}</style>

      {notice && <p className="hm-note" role="status">{notice}</p>}

      {screen === 'home' && (
        <>
          <section>
            <div className="hm-sec-head">
              <h2>Balances</h2>
              <button
                className="hm-icon"
                onClick={() => setHide(!hide)}
                aria-pressed={hide}
                aria-label={hide ? 'Show values' : 'Hide values'}
                title={hide ? 'Show values' : 'Hide values'}
              >
                <Icon name={hide ? 'eyeOff' : 'eye'} />
              </button>
            </div>

            <div className="hm-bals">
              <div className="hm-bal air">
                <button
                  className={`hm-icon ${spin ? 'hm-spin' : ''}`}
                  onClick={refreshBalance}
                  aria-label="Refresh airtime balance"
                  title="Refresh balance"
                >
                  <Icon name="refresh" />
                </button>
                <span className="hm-bal-val">{mask(`KES ${money(airtime)}`)}</span>
                <span className="hm-bal-label">Airtime balance</span>
              </div>

              <div className="hm-bal used">
                <span className="hm-bal-val">{mask(`KES ${money(airtimeUsed)}`)}</span>
                <span className="hm-bal-label">Airtime used</span>
              </div>

              <button className="hm-bal tok" onClick={onOpenTokens} aria-label="Open tokens">
                <span className="hm-bal-val">{mask(`${wallet.units.toLocaleString('en-KE')} units`)}</span>
                <span className="hm-bal-label">Tokens</span>
                <span className="hm-bal-sub">
                  {unlimitedActive && !hide
                    ? `∞ Unlimited active • ${unlimitedLeft(wallet.unlimitedUntil, now)}`
                    : 'Tap to top up'}
                </span>
              </button>
            </div>
          </section>

          <section>
            <div className="hm-sec-head"><h2>Overview</h2></div>
            <div className="hm-stats">
              <div className="hm-stat"><span className="hm-stat-n hm-ok">{counts.Completed}</span><span className="hm-stat-l">Successful</span></div>
              <div className="hm-stat"><span className="hm-stat-n hm-warn">{counts.Pending}</span><span className="hm-stat-l">Pending</span></div>
              <div className="hm-stat"><span className="hm-stat-n hm-info-c">{counts.Scheduled}</span><span className="hm-stat-l">Scheduled</span></div>
              <div className="hm-stat"><span className="hm-stat-n hm-bad">{counts.Failed}</span><span className="hm-stat-l">Failed</span></div>
            </div>
          </section>

          <section>
            <div className="hm-sec-head">
              <h2>Daily commissions</h2>
              <span className="hm-total">This week: <b>{mask(`KES ${money(weekTotal)}`)}</b></span>
            </div>
            <div className="hm-card hm-chart">
              <CommissionChart values={values} todayIndex={todayIndex} total={weekTotal} />
            </div>
          </section>

          <section>
            <div className="hm-sec-head"><h2>Recent transactions</h2></div>
            <div className="hm-chips" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  className={`hm-chip ${filter === f ? 'on' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>

            {recent.length === 0 ? (
              <div className="hm-card hm-empty">
                {txs.length === 0 ? (
                  <>
                    <p>No transactions yet. They appear here automatically after each purchase.</p>
                    <button className="hm-btn" onClick={loadDemo}>Load demo transactions</button>
                  </>
                ) : (
                  <p>No {filter.toLowerCase()} transactions.</p>
                )}
              </div>
            ) : (
              <div className="hm-list">
                {recent.map((t) => (
                  <button key={t.id} className="hm-row" onClick={() => openDetail(t.id)}>
                    <span className="hm-avatar">{initials(t.name || t.phone)}</span>
                    <span className="hm-row-main">
                      <span className="hm-row-name">{t.name || t.phone}</span>
                      <span className="hm-row-sub">{t.phone} · {t.offerName} · KES {t.amount}</span>
                    </span>
                    <span className="hm-row-end">
                      <span className={`st hm-${t.status === 'Scheduled' ? 'info-c' : TONE[t.status]}`}>{t.status}</span>
                      <span className="when">{ago(t.createdAt, now)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {screen === 'detail' && tx && (
        <>
          <div className="hm-head">
            <button className="hm-icon" onClick={goHome} aria-label="Back to home">
              <Icon name="back" />
            </button>
            <h2>Transaction</h2>
          </div>

          <div><span className={`hm-status ${TONE[tx.status]}`}>{tx.status}</span></div>

          <div className="hm-money">
            <span className="hm-amount">KES {tx.amount}</span>
            <span className="hm-offer">{tx.offerName}</span>
          </div>

          <div className="hm-when">
            {(() => {
              const at =
                tx.status === 'Completed' && tx.completedAt
                  ? tx.completedAt
                  : tx.status === 'Scheduled' && tx.scheduledFor
                    ? tx.scheduledFor
                    : tx.createdAt
              return (
                <>
                  <span><Icon name="calendar" />{fmtDate(at)}</span>
                  <span><Icon name="clock" />{fmtTime(at)}</span>
                </>
              )
            })()}
          </div>

          <InfoCard
            title="Raw message"
            text={tx.rawMessage || 'No message saved.'}
            lines={3}
            open={open.raw}
            onToggle={() => toggle('raw')}
            onCopy={() => copy(tx.rawMessage || '')}
          />
          <InfoCard
            title="USSD"
            text={tx.ussd || 'No USSD saved.'}
            lines={3}
            open={open.ussd}
            onToggle={() => toggle('ussd')}
            onCopy={() => copy(tx.ussd || '')}
          />
          <InfoCard
            title="Response"
            text={responseText(tx)}
            lines={8}
            open={open.resp}
            onToggle={() => toggle('resp')}
            onCopy={() => copy(responseText(tx))}
          />

          <div className="hm-actions">
            <button className="hm-act" onClick={() => retry(tx)} disabled={tx.status === 'Completed'}>
              <Icon name="retry" /> Retry
            </button>
            <button className="hm-act" onClick={() => openReschedule(tx)} disabled={tx.status === 'Completed'}>
              <Icon name="clock" /> Reschedule
            </button>
            <button className="hm-act del" onClick={() => remove(tx)}>
              <Icon name="trash" /> Delete
            </button>
          </div>
          {tx.status === 'Completed' && (
            <p className="hm-hint">A completed purchase cannot be retried or rescheduled.</p>
          )}
        </>
      )}

      {screen === 'reschedule' && tx && (
        <>
          <div className="hm-head">
            <button
              className="hm-icon"
              onClick={() => setView({ name: 'detail', id: tx.id })}
              aria-label="Back to transaction"
            >
              <Icon name="back" />
            </button>
            <h2>Reschedule</h2>
          </div>

          <div className="hm-money">
            <span className="hm-amount">KES {tx.amount}</span>
            <span className="hm-offer">{tx.offerName}</span>
          </div>

          <div>
            <label className="hm-lab" htmlFor="hm-date">New date</label>
            <input
              id="hm-date"
              className="hm-field"
              type="date"
              min={toDateValue(Date.now())}
              value={when.date}
              onChange={(e) => setWhen({ ...when, date: e.target.value })}
            />
          </div>
          <div>
            <label className="hm-lab" htmlFor="hm-time">New time</label>
            <input
              id="hm-time"
              className="hm-field"
              type="time"
              value={when.time}
              onChange={(e) => setWhen({ ...when, time: e.target.value })}
            />
          </div>

          {error && <p className="hm-err" role="alert">{error}</p>}

          <button className="hm-btn" onClick={confirmReschedule}>Schedule</button>
          <button className="hm-btn ghost" onClick={() => setView({ name: 'detail', id: tx.id })}>
            Cancel
          </button>
        </>
      )}
    </div>
  )
}