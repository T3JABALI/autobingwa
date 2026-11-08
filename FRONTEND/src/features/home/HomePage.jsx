import UpdatePopup from '../updates/UpdatePopup'
import { useEffect, useRef, useState } from 'react'
import UssdSetup from './UssdSetup.jsx'
import {
  subscribe, loadTransactions, loadAirtime, loadWallet,
  updateTransaction, deleteTransaction,
} from './dataStore.js'
import { CSS } from './homeStyles.js'
import { confirmDialog } from '../ui/dialog.js'
import CommissionChart from './CommissionChart.jsx'
import { Icon } from './HomeParts.jsx'
import VerifiedBadge from './VerifiedBadge.jsx'
import { engine } from '../../engine/index.js'
import { isNative, getSims, refreshAirtime } from '../../engine/native.js'
import { commissionByDay, commissionThisWeek, getAirtimeBalance } from '../../engine/balances.js'

// The card reads the balance the *144# check saved; the old store is only a fallback
const readAirtime = () => {
  const b = getAirtimeBalance()
  return b && Number.isFinite(Number(b.value)) ? Number(b.value) : loadAirtime()
}

const DAY = 86400000
const FILTERS = ['All', 'Completed', 'Pending', 'Scheduled', 'Failed']
const ALL_FILTERS = ['All', 'Today', 'Completed', 'Pending', 'Scheduled', 'Failed', 'Unmatched', 'Paused', 'Skipped']
const TONE = { Completed: 'ok', Pending: 'warn', Processing: 'warn', Scheduled: 'info', Failed: 'bad', Unmatched: 'bad', Paused: 'warn', Skipped: 'warn' }

// The label shown beside a transaction that did not come from a customer payment
const tagOf = (t) =>
  t.blacklisted
    ? '🚫 BLACKLISTED'
    : t.isFallback
      ? (t.fallbackDepth || 1) > 1 ? '(FB)' : '(FALLBACK)'
      : t.renewal
        ? `(RENEWAL ${t.renewal.day}/${t.renewal.of})`
        : t.source === 'quickdial'
          ? '(QUICK DIAL)'
          : ''

// Row, bottom bar and chart styling now live in abExtras.css. This keeps only the small leftovers.
const HOME_EXTRA = `
  .hm-note { position: static !important; margin: 0 0 6px !important; z-index: auto !important; }
  .hm-s-all .hm-head { position: static !important; display: flex; align-items: center; gap: 12px; margin: 4px 0 10px; }
  .hm-s-all .hm-search { position: static !important; display: block; width: 100%; box-sizing: border-box; margin: 0 0 10px; }
  .hm-s-all .hm-chips { margin-bottom: 10px; }
  .hm-s-home .hm-bigbtn.holding { filter: brightness(1.3); }
  .hm-fb { margin-left: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; color: var(--primary); white-space: nowrap; }
  .hm-fbnote { margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; font-size: 14px; border: 1px solid var(--border); }
  .hm-fbnote b { color: var(--primary); }
  .hm-modal-back {
    position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px;
    background: rgba(0, 0, 0, 0.6);
  }
  .hm-modal {
    width: 100%; max-width: 380px; padding: 22px 18px; border-radius: 20px;
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
  }
  .hm-modal h3 { margin: 0 0 6px; font-size: 19px; }
  .hm-modal p { margin: 0 0 16px; font-size: 14px; color: var(--soft); }
  .hm-simbtn {
    display: block; width: 100%; margin-top: 10px; padding: 16px; border-radius: 14px; cursor: pointer;
    border: 2px solid var(--primary); background: transparent; color: var(--text); font: inherit;
    font-size: 17px; font-weight: 700; text-align: left;
  }
  .hm-simbtn small { display: block; margin-top: 3px; font-size: 13px; font-weight: 400; color: var(--soft); }
  .hm-simbtn:disabled { opacity: 0.4; cursor: not-allowed; }
  .hm-modal .hm-cancel {
    display: block; width: 100%; margin-top: 14px; padding: 12px; border: 0; background: transparent;
    color: var(--soft); font: inherit; font-size: 15px; cursor: pointer;
  }
`

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
// The time shown beside the status on the detail screen
const execAt = (t) =>
  t.status === 'Completed' && t.completedAt
    ? t.completedAt
    : t.status === 'Scheduled' && t.scheduledFor
      ? t.scheduledFor
      : t.createdAt

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

export default function HomePage({
  onOpenTokens,
  automationRunning = false,
  onToggleAutomation,
  onOpenAnalytics,
}) {
  const [txs, setTxs] = useState(loadTransactions)
  const [airtime, setAirtime] = useState(readAirtime)
  const [wallet, setWallet] = useState(loadWallet)
  const [now, setNow] = useState(Date.now())
  const [hide, setHide] = useState(false)
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [view, setView] = useState({ name: 'home', id: null, from: 'home' })
  const [spin, setSpin] = useState(false)
  const [simPick, setSimPick] = useState(null)
  const [notice, setNoticeRaw] = useState('')
  const noticeTimer = useRef(null)
  // Only real problems show, and only for a few seconds. "Copied", "Retrying" and balances stay silent.
  const setNotice = (msg) => {
    clearTimeout(noticeTimer.current)
    if (msg && /could not|can only|cannot|failed|error|press and hold/i.test(msg)) {
      setNoticeRaw(msg)
      noticeTimer.current = setTimeout(() => setNoticeRaw(''), 3500)
    } else {
      setNoticeRaw('')
    }
  }
  const [open, setOpen] = useState({})
  const [when, setWhen] = useState({ date: '', time: '' })
  const [error, setError] = useState('')

  // Start / Stop only works on a long press (about one second), never on a tap
  const holdTimer = useRef(null)
  const fired = useRef(false)
  const [holding, setHolding] = useState(false)

  const startHold = () => {
    fired.current = false
    setHolding(true)
    holdTimer.current = setTimeout(() => {
      fired.current = true
      setHolding(false)
      try { if (navigator.vibrate) navigator.vibrate(60) } catch (e) { /* no vibration */ }
      if (onToggleAutomation) onToggleAutomation()
    }, 1000)
  }
  // A quick release shows a hint instead of doing anything
  const endHold = (showHint) => {
    clearTimeout(holdTimer.current)
    setHolding(false)
    if (showHint && !fired.current) setNotice('Press and hold the button for 1 second')
  }
  useEffect(() => () => clearTimeout(holdTimer.current), [])

  useEffect(() => {
    const sync = () => {
      setTxs(loadTransactions())
      setAirtime(readAirtime())
      setWallet(loadWallet())
      setNow(Date.now())
    }
    const off = subscribe(sync)
    // New commission messages and balance checks tell the screen to redraw
    window.addEventListener('ab-balances', sync)
    const tick = setInterval(() => setNow(Date.now()), 60000)
    return () => {
      off()
      window.removeEventListener('ab-balances', sync)
      clearInterval(tick)
    }
  }, [])

  // ---- Numbers shown on the dashboard ----
  const todayStart = startOfDay(now)
  // An original that has a fallback is hidden: only the fallback shows.
  // If a success SMS cancelled the fallback, the original (now Completed) shows instead.
  const hiddenIds = new Set()
  txs.forEach((t) => {
    if (!t.isFallback || !t.fallbackFromId) return
    if (t.status === 'Skipped') {
      const orig = txs.find((x) => x.id === t.fallbackFromId)
      if (orig && orig.status === 'Completed') hiddenIds.add(t.id)
    } else {
      hiddenIds.add(t.fallbackFromId)
    }
  })
  const visible = txs.filter((t) => !hiddenIds.has(t.id))
  const todays = visible.filter((t) => t.createdAt >= todayStart)
  const counts = {
    Completed: todays.filter((t) => t.status === 'Completed').length,
    Pending: todays.filter((t) => t.status === 'Pending' || t.status === 'Processing').length,
    Scheduled: visible.filter((t) => t.status === 'Scheduled').length,
    Failed: todays.filter((t) => t.status === 'Failed').length,
  }

  // Airtime used today: every transaction that completed since midnight. It starts again at 0 each midnight.
  const airtimeUsed = txs
    .filter((t) => t.status === 'Completed' && (t.completedAt || t.createdAt) >= todayStart)
    .reduce((sum, t) => sum + (Number(t.cost) || 0), 0)

  // Commission comes from the Safaricom messages: "Total commission this week is Ksh..."
  const commission = commissionByDay(now)
  const values = commission.values.map((v) => v || 0)
  const todayIndex = commission.today
  const weekTotal = commissionThisWeek(now)

  const unlimitedActive = wallet.unlimitedUntil > now
  const mask = (text) => (hide ? '••••••' : text)

  // A transaction belongs to a chip by status, or by date for Today
  const inFilter = (t, f) =>
    f === 'All'
      ? true
      : f === 'Today'
        ? t.createdAt >= todayStart
        : f === 'Pending'
          ? t.status === 'Pending' || t.status === 'Processing'
          : t.status === f
  const matches = (t) => inFilter(t, filter)
  const countFor = (f) => visible.filter((t) => inFilter(t, f)).length
  const sorted = [...visible].sort((a, b) => b.createdAt - a.createdAt)
  const recent = sorted.filter(matches).slice(0, 5)

  // Full list page: category + search (name, phone, M-Pesa message/ID, offer)
  const q = query.trim().toLowerCase()
  const allList = sorted.filter((t) => {
    if (!matches(t)) return false
    if (!q) return true
    return [t.name, t.phone, t.mpesaId, t.rawMessage, t.offerName].some((v) =>
      String(v || '').toLowerCase().includes(q)
    )
  })

  const tx = view.id ? txs.find((t) => t.id === view.id) : null
  const screen = tx ? view.name : view.name === 'all' ? 'all' : 'home'

  // ---- Actions ----
  // The refresh icon asks which SIM to check
  async function openSimPicker() {
    setNotice('')
    if (!isNative()) {
      setNotice('Airtime can only be checked inside the Android app')
      return
    }
    let found = null
    try {
      found = await getSims()
    } catch (e) {
      console.error('AB getSims', e)
    }
    setSimPick(
      [0, 1].map((slot) => {
        const s = found ? found.find((x) => x.slot === slot) : null
        return { slot, carrier: s ? s.carrier : '', present: found ? Boolean(s) : true }
      })
    )
  }

  async function checkAirtime(slot) {
    setSimPick(null)
    setSpin(true)
    setNotice(`Checking airtime on SIM ${slot + 1}...`)
    try {
      const value = await refreshAirtime(slot)
      setAirtime(readAirtime())
      setNotice(`Airtime balance on SIM ${slot + 1}: KES ${money(value)}`)
    } catch (e) {
      setNotice(`Could not check airtime: ${e && e.message ? e.message : e}`)
    } finally {
      setSpin(false)
    }
  }

  function openDetail(id, from = 'home') {
    setOpen({})
    setNotice('')
    setView({ name: 'detail', id, from })
  }

  function goBack() {
    if (view.name === 'all') setFilter('All')
    setView({ name: view.from === 'all' ? 'all' : 'home', id: null, from: 'home' })
  }

  function openAll() {
    setNotice('')
    setQuery('')
    setView({ name: 'all', id: null, from: 'home' })
  }

  // Overview cards: open the full list already filtered (Pending, Scheduled, Failed)
  function openList(f) {
    setFilter(f)
    openAll()
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
    setNotice('Retrying. Please wait...')
    engine.retry(t.id)
  }

  function openReschedule(t) {
    const soon = Date.now() + 5 * 60000
    setWhen({ date: toDateValue(soon), time: toTimeValue(soon) })
    setError('')
    setView({ ...view, name: 'reschedule', id: t.id })
  }

  function confirmReschedule() {
    const at = new Date(`${when.date}T${when.time}`)
    if (!when.date || !when.time || Number.isNaN(at.getTime())) return setError('Choose a date and time')
    if (at.getTime() <= Date.now()) return setError('Choose a time in the future')
    updateTransaction(view.id, { status: 'Scheduled', scheduledFor: at.getTime() })
    setNotice(`Rescheduled for ${fmtDate(at.getTime())} at ${fmtTime(at.getTime())}`)
    setView({ ...view, name: 'detail' })
  }

  async function remove(t) {
    if (!(await confirmDialog('This transaction will be removed for good.', { title: 'Delete transaction?', confirmLabel: 'Delete', danger: true }))) return
    deleteTransaction(t.id)
    setNotice('Transaction deleted')
    goBack()
  }

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  const responseText = (t) =>
    t.responses && t.responses.length
      ? t.responses.map((r, i) => `--- Screen ${i + 1} (input: ${r.input}) ---\n${r.text}`).join('\n\n')
      : 'No response recorded yet.'

  // One transaction row, used on Home and on the full list. Every row is the same size.
  const row = (t, from) => (
    <button key={t.id} className="hm-row" onClick={() => openDetail(t.id, from)}>
      <span className="hm-avatar">{initials(t.name || t.phone)}</span>
      <span className="hm-row-main">
        <span className="hm-row-name">
          <span className="hm-nm">{t.name || t.phone}</span>
          {t.verified !== false && <VerifiedBadge />}
          {tagOf(t) && <span className="hm-fb">{tagOf(t)}</span>}
        </span>
        <span className="hm-row-sub">{t.phone} · {t.offerName} · KES {t.amount}</span>
      </span>
      <span className="hm-row-end">
        <span className={`st hm-${t.status === 'Scheduled' ? 'info-c' : TONE[t.status]}`}>{t.status}</span>
        <span className="when">{ago(t.createdAt, now)}</span>
      </span>
    </button>
  )

  // Compact info card with a copy icon (tap the text to expand)
  const info = (title, text, copyText, key, lines) => (
    <div className="hm-ic">
      <div className="hm-ic-head">
        <span>{title}</span>
        <button className="hm-ic-copy" onClick={() => copy(copyText)} aria-label={`Copy ${title}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
          </svg>
        </button>
      </div>
      <div
        className={`hm-ic-text ${open[key] ? 'open' : ''}`}
        style={open[key] ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines }}
        onClick={() => toggle(key)}
        role="button"
        tabIndex={0}
      >
        {text}
      </div>
    </div>
  )

  const chipsFor = (list, withCount) => (
    <div className="hm-chips" role="tablist">
      {list.map((f) => (
        <button
          key={f}
          role="tab"
          aria-selected={filter === f}
          className={`hm-chip ${filter === f ? 'on' : ''}`}
          onClick={() => setFilter(f)}
        >
          {withCount ? `${f} (${countFor(f)})` : f}
        </button>
      ))}
    </div>
  )

  return (
    <div className={`hm-page hm-s-${screen}`}>
      <style>{CSS}</style>
      <style>{HOME_EXTRA}</style>
      <UssdSetup />
      <UpdatePopup />

      {notice && <p className="hm-note" role="status">{notice}</p>}

      {simPick && (
        <div className="hm-modal-back" onClick={() => setSimPick(null)}>
          <div className="hm-modal" role="dialog" aria-label="Choose a SIM" onClick={(e) => e.stopPropagation()}>
            <h3>Check airtime on which SIM?</h3>
            <p>The app dials *144# on the SIM you choose and shows the real balance.</p>
            {simPick.map((s) => (
              <button key={s.slot} className="hm-simbtn" disabled={!s.present} onClick={() => checkAirtime(s.slot)}>
                SIM {s.slot + 1}
                <small>{s.present ? s.carrier || 'Ready' : 'No SIM found'}</small>
              </button>
            ))}
            <button className="hm-cancel" onClick={() => setSimPick(null)}>Cancel</button>
          </div>
        </div>
      )}

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
                  onClick={openSimPicker}
                  disabled={spin}
                  aria-label="Refresh airtime balance"
                  title="Refresh balance"
                >
                  <Icon name="refresh" />
                </button>
                <span className="hm-bal-val">{hide ? '••••••' : <><small className="hm-cur">KES</small>{money(airtime)}</>}</span>
                <span className="hm-bal-label">Airtime balance</span>
              </div>

              <button className="hm-bal used" onClick={onOpenAnalytics} aria-label="Open analytics">
                <span className="hm-bal-val">{hide ? '••••••' : <><small className="hm-cur">KES</small>{money(airtimeUsed)}</>}</span>
                <span className="hm-bal-label">Airtime used</span>
              </button>

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
              <button className="hm-stat" onClick={() => openList('Pending')}><span className="hm-stat-n hm-warn">{counts.Pending}</span><span className="hm-stat-l">Pending</span></button>
              <button className="hm-stat" onClick={() => openList('Scheduled')}><span className="hm-stat-n hm-info-c">{counts.Scheduled}</span><span className="hm-stat-l">Scheduled</span></button>
              <button className="hm-stat" onClick={() => openList('Failed')}><span className="hm-stat-n hm-bad">{counts.Failed}</span><span className="hm-stat-l">Failed</span></button>
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
            <button className="hm-linkhead" onClick={openAll} aria-label="Open all transactions">
              <h2>Recent transactions</h2>
              <span className="hm-arrow" aria-hidden="true">→</span>
            </button>
            {chipsFor(FILTERS)}

            {recent.length === 0 ? (
              <div className="hm-card hm-empty">
                {txs.length === 0 ? (
                  <p>No transactions yet. They appear here automatically after each purchase.</p>
                ) : (
                  <p>No {filter.toLowerCase()} transactions.</p>
                )}
              </div>
            ) : (
              <div className="hm-list">{recent.map((t) => row(t, 'home'))}</div>
            )}
          </section>

          {onToggleAutomation && (
            <button
              className={`hm-bigbtn ${automationRunning ? 'stop' : 'start'} ${holding ? 'holding' : ''}`}
              onPointerDown={startHold}
              onPointerUp={() => endHold(true)}
              onPointerLeave={() => endHold(false)}
              onPointerCancel={() => endHold(false)}
              onContextMenu={(e) => e.preventDefault()}
              style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
            >
              {automationRunning ? '■ Hold to stop automation' : '▶ Hold to start automation'}
            </button>
          )}
        </>
      )}

      {screen === 'all' && (
        <>
          <div className="hm-head">
            <button className="hm-icon" onClick={goBack} aria-label="Back to home">
              <Icon name="back" />
            </button>
            <h2>Transactions</h2>
          </div>

          <input
            className="hm-search"
            type="search"
            placeholder="Search M-Pesa ID, phone or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search transactions"
          />
          {chipsFor(ALL_FILTERS, true)}

          {allList.length === 0 ? (
            <div className="hm-card hm-empty">
              <p>{txs.length === 0 ? 'No transactions yet.' : 'No transactions match your search.'}</p>
            </div>
          ) : (
            <div className="hm-list">{allList.map((t) => row(t, 'all'))}</div>
          )}
        </>
      )}

      {screen === 'detail' && tx && (
        <>
          <div className="hm-head">
            <button className="hm-icon" onClick={goBack} aria-label="Back">
              <Icon name="back" />
            </button>
            <h2>Transaction</h2>
          </div>

          <div className="hm-statusrow">
            <span className={`hm-status ${TONE[tx.status]}`}>{tx.status}</span>
            <span className="hm-datetime">
              <span><Icon name="calendar" />{fmtDate(execAt(tx))}</span>
              <span><Icon name="clock" />{fmtTime(execAt(tx))}</span>
            </span>
          </div>

          <div className="hm-money">
            <span className="hm-amount">KES {tx.amount}</span>
            <span className="hm-offer">{tx.offerName}</span>
          </div>

          {tagOf(tx) && (
            <p className="hm-fbnote">
              <b>{tagOf(tx)}</b>{' '}
              {tx.fallbackNote ||
                (tx.renewal
                  ? `Auto renewal, day ${tx.renewal.day} of ${tx.renewal.of}`
                  : tx.blacklisted
                    ? 'This customer is blacklisted, so the payment was not processed.'
                    : 'Started from Quick Dial')}
            </p>
          )}

          {tx.isFallback && tx.fallbackFromId && txs.some((x) => x.id === tx.fallbackFromId) && (
            <button className="hm-btn ghost" onClick={() => openDetail(tx.fallbackFromId, view.from)}>
              View the original attempt
            </button>
          )}
          {info('M-Pesa message', tx.rawMessage || 'No message saved.', tx.rawMessage || '', 'raw', 4)}
          <div className="hm-ic-grid">
            {info('Phone number', tx.phone || 'No phone number saved.', tx.phone || '', 'phone', 1)}
            {info('USSD', tx.ussd || 'No USSD saved.', tx.ussd || '', 'ussd', 3)}
          </div>
          {info('USSD response', responseText(tx), responseText(tx), 'resp', 3)}

          <div className="hm-actions">
            <button className="hm-act" onClick={() => retry(tx)} disabled={tx.status === 'Processing'}>
              <Icon name="retry" /> Retry
            </button>
            <button className="hm-act" onClick={() => openReschedule(tx)} disabled={tx.status === 'Processing'}>
              <Icon name="clock" /> Reschedule
            </button>
            <button className="hm-act del" onClick={() => remove(tx)}>
              <Icon name="trash" /> Delete
            </button>
          </div>
        </>
      )}

      {screen === 'reschedule' && tx && (
        <>
          <div className="hm-head">
            <button
              className="hm-icon"
              onClick={() => setView({ ...view, name: 'detail' })}
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
          <button className="hm-btn ghost" onClick={() => setView({ ...view, name: 'detail' })}>
            Cancel
          </button>
        </>
      )}
    </div>
  )
}