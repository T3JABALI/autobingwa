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
import { isNative, getSims, refreshAirtime, sendSms, AutoBingwa } from '../../engine/native.js'
import { loadConfig, last9, isBlacklisted } from '../../engine/config.js'
import { loadClients, saveClients, CLIENTS_EVENT } from '../../engine/clientsStore.js'
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
  .hm-s-all .hm-chips {
    display: flex !important; flex-wrap: nowrap !important; overflow-x: auto !important;
    gap: 8px; margin: 0 -4px 14px !important; padding: 0 4px 6px;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .hm-s-all .hm-chips::-webkit-scrollbar { display: none; }
  .hm-s-all .hm-chip { flex: 0 0 auto !important; white-space: nowrap; }
  .hm-s-all .hm-head h2 { margin: 0; }
  .hm-s-all .hm-list { display: flex; flex-direction: column; gap: 10px; }
  .hm-s-home .hm-bigbtn.holding { filter: brightness(1.3); }
  .hm-fb { margin-left: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; color: var(--primary); white-space: nowrap; }
  .hm-fbnote { margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; font-size: 14px; border: 1px solid var(--border); }
  .hm-fbnote b { color: var(--primary); }
  .hm-modal-back {
    position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 20px;
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
  .hm-row { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .hm-row.sel { outline: 2px solid var(--primary); outline-offset: -2px; }
  .hm-selbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 60;
    padding: calc(env(safe-area-inset-top, 0px) + 8px) 12px 10px;
    background: var(--bg); border-bottom: 1px solid var(--border); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .hm-selbar-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .hm-selbar-top b { flex: 1; font-size: 16px; }
  .hm-selx { display: grid; place-items: center; width: 38px; height: 38px; border: 0; border-radius: 50%; background: transparent; color: var(--text); cursor: pointer; }
  .hm-selacts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .hm-selact {
    display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 2px;
    border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text);
    font: inherit; font-size: 11px; cursor: pointer;
  }
  .hm-selact.del { color: #e5484d; }
  .hm-actions2 { display: grid !important; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }
  .hm-actions2 .hm-act { flex-direction: column; gap: 4px; padding: 10px 4px; font-size: 12px; text-align: center; }
  .hm-ta {
    width: 100%; box-sizing: border-box; padding: 12px; border-radius: 12px; border: 1px solid var(--border);
    background: transparent; color: var(--text); font: inherit; font-size: 15px; resize: vertical;
  }
  .hm-qk { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 4px; }
  .hm-qk button {
    padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--border); background: transparent;
    color: var(--soft); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
  }
  .hm-simbtn.hm-center { text-align: center; }
  .hm-modal .hm-scroll { max-height: 50vh; overflow-y: auto; }

  /* Status colours. Rows: the word itself is coloured. Detail screen: solid pill with white text. */
  .hm-row-end .st[data-status="Completed"]  { color: #22c55e !important; }
  .hm-row-end .st[data-status="Failed"]     { color: #ef4444 !important; }
  .hm-row-end .st[data-status="Pending"]    { color: #f59e0b !important; }
  .hm-row-end .st[data-status="Processing"] { color: #a855f7 !important; }
  .hm-row-end .st[data-status="Scheduled"]  { color: #06b6d4 !important; }
  .hm-row-end .st[data-status="Unmatched"]  { color: #3b82f6 !important; }
  .hm-row-end .st[data-status="Paused"]     { color: #f97316 !important; }
  .hm-row-end .st[data-status="Skipped"]    { color: #94a3b8 !important; }

  .hm-status[data-status="Completed"]  { background: #16a34a !important; color: #fff !important; }
  .hm-status[data-status="Failed"]     { background: #dc2626 !important; color: #fff !important; }
  .hm-status[data-status="Pending"]    { background: #d97706 !important; color: #fff !important; }
  .hm-status[data-status="Processing"] { background: #9333ea !important; color: #fff !important; }
  .hm-status[data-status="Scheduled"]  { background: #0891b2 !important; color: #fff !important; }
  .hm-status[data-status="Unmatched"]  { background: #2563eb !important; color: #fff !important; }
  .hm-status[data-status="Paused"]     { background: #ea580c !important; color: #fff !important; }
  .hm-status[data-status="Skipped"]    { background: #64748b !important; color: #fff !important; }
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
// Line icons for the new actions (same style as the copy icon)
const ICONS = {
  retry: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
  message: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  ban: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  swap: <><path d="M7 7h12l-3-3" /><path d="M17 17H5l3 3" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  all: <><path d="M4 7l2 2 3-3" /><path d="M4 17l2 2 3-3" /><path d="M13 8h7M13 18h7" /></>,
}
const Ic = ({ name, size = 20 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
)

const QUICK = [
  'Hi {name}, your plan is being processed. Thank you for your patience.',
  'Hi {name}, sorry, we could not give that plan. Please contact us.',
  'Hi {name}, thank you for buying. Enjoy your plan!',
]
const firstName = (name) => {
  const w = String(name || '').trim().split(/\s+/)[0] || ''
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : 'Customer'
}
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
const readOffers = () => {
  try {
    const v = JSON.parse(localStorage.getItem('myOffers') || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}
export default function HomePage({
  onOpenTokens,
  automationRunning = false,
  onToggleAutomation,
  onOpenAnalytics,
  onScreenChange,
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
  const [sel, setSel] = useState([]) // ids of the selected transactions
  const [msgTo, setMsgTo] = useState(null) // transactions a message is going to
  const [msgText, setMsgText] = useState('')
  const [msgBusy, setMsgBusy] = useState(false)
  const [recoFor, setRecoFor] = useState(null) // transaction we are recommending another plan for
  const [copied, setCopied] = useState(false)
  const pressTimer = useRef(null)
  const pressed = useRef(false)
  useEffect(() => () => clearTimeout(pressTimer.current), [])

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
    // New commission messages, balance checks and client changes tell the screen to redraw
    window.addEventListener('ab-balances', sync)
    window.addEventListener(CLIENTS_EVENT, sync)
    const tick = setInterval(() => setNow(Date.now()), 60000)
    return () => {
      off()
      window.removeEventListener('ab-balances', sync)
      window.removeEventListener(CLIENTS_EVENT, sync)
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
  // Home only shows today's transactions. Older ones live in the full list (the arrow).
  const recent = sorted.filter((t) => t.createdAt >= todayStart).filter(matches).slice(0, 5)

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

  // Tell the app which screen is open (so the top bar hides), and start each screen at the top
  useEffect(() => {
    if (onScreenChange) onScreenChange(screen)
    try {
      window.scrollTo(0, 0)
      const m = document.querySelector('.main')
      if (m) m.scrollTo(0, 0)
    } catch (e) { /* nothing to scroll */ }
  }, [screen])
  useEffect(() => () => { if (onScreenChange) onScreenChange('home') }, [])

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
  // ---- Selecting several transactions ----
  const selTxs = sel.map((id) => txs.find((t) => t.id === id)).filter(Boolean)
  const shown = screen === 'all' ? allList : recent
  const clearSel = () => setSel([])
  const toggleSel = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  useEffect(() => { setSel([]) }, [screen])

  // A long press (half a second) selects a row. After that, a tap adds or removes rows.
  const rowDown = (id) => {
    pressed.current = false
    clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => {
      pressed.current = true
      try { if (navigator.vibrate) navigator.vibrate(40) } catch (e) { /* no vibration */ }
      setSel((s) => (s.includes(id) ? s : [...s, id]))
    }, 500)
  }
  const rowUp = () => clearTimeout(pressTimer.current)
  const rowTap = (t, from) => {
    if (pressed.current) { pressed.current = false; return }
    if (sel.length) toggleSel(t.id)
    else openDetail(t.id, from)
  }

  // Only marks the transaction as successful. It does not dial USSD or send the success SMS.
  function completeTx(t) {
    try { if (isNative() && t.engine === 'native') AutoBingwa.nativeRelease({ id: t.id }).catch(() => {}) } catch (e) { /* ignore */ }
    updateTransaction(t.id, { status: 'Completed', engine: 'js', scheduledFor: null, completedAt: Date.now() })
  }

  function bulkRetry() {
    const go = selTxs.filter((t) => t.status !== 'Completed' && t.status !== 'Processing')
    go.forEach((t) => engine.retry(t.id))
    if (go.length < selTxs.length) setNotice(`${selTxs.length - go.length} could not be retried because they are completed or still running`)
    clearSel()
  }

  async function bulkComplete() {
    const go = selTxs.filter((t) => t.status !== 'Completed')
    if (!go.length) return clearSel()
    if (!(await confirmDialog(`Mark ${go.length} as completed? Do this only if the customers already got their plans.`, { title: 'Mark as completed?', confirmLabel: 'Complete' }))) return
    go.forEach(completeTx)
    clearSel()
  }

  async function bulkDelete() {
    const n = selTxs.length
    if (!(await confirmDialog(`${n} transaction${n === 1 ? '' : 's'} will be removed for good.`, { title: `Delete ${n}?`, confirmLabel: 'Delete', danger: true }))) return
    selTxs.forEach((t) => deleteTransaction(t.id))
    clearSel()
  }

  // Marks each number as blacklisted in the clients list, which isBlacklisted() in engine/config.js reads.
  // A client that already exists (same last 9 digits) is flagged. A new one gets the same fields
  // that recordClientPurchase creates. saveClients also fires the ab-clients event.
  function addToBlacklist(phones) {
    try {
      const list = loadClients()
      phones.forEach((p) => {
        const key = last9(p)
        if (key.length < 9) return
        const c = list.find((x) => last9(x.phone) === key)
        if (c) {
          c.blacklisted = true
        } else {
          const t = txs.find((x) => last9(x.phone) === key)
          const at = (t && t.createdAt) || Date.now()
          list.push({
            id: Date.now() + Math.random(),
            name: t && t.name ? titleCase(t.name) : p,
            phone: p,
            createdAt: at,
            lastActive: at,
            totalSpent: 0,
            purchases: 0,
            blacklisted: true,
            days: [],
          })
        }
      })
      saveClients(list)
      return true
    } catch (e) {
      console.error('AB blacklist', e)
      return false
    }
  }

  async function blacklist(list) {
    const phones = [...new Set(list.map((t) => t.phone).filter(Boolean))]
    if (!phones.length) return setNotice('Cannot blacklist: no phone number saved')
    const who = phones.length === 1 ? phones[0] : `${phones.length} numbers`
    if (!(await confirmDialog(`${who} will be blacklisted, so their payments will not be processed.`, { title: 'Blacklist?', confirmLabel: 'Blacklist', danger: true }))) return
    if (!addToBlacklist(phones)) return setNotice('Could not blacklist: the list could not be saved')
    clearSel()
  }

  function openMessage(list) {
    const to = list.filter((t) => t.phone)
    if (!to.length) return setNotice('Cannot message: no phone number saved')
    setMsgText('')
    setMsgTo(to)
  }

  async function sendMessages() {
    const text = msgText.trim()
    if (!text || !msgTo) return
    if (!isNative()) {
      setMsgTo(null)
      return setNotice('Messages can only be sent inside the Android app')
    }
    setMsgBusy(true)
    const slot = loadConfig().replySim === 'SIM 1' ? 0 : 1 // same reply SIM as the automatic messages
    let failed = 0
    for (const t of msgTo) {
      const body = text.replace(/\{name\}/gi, firstName(t.name))
      try {
        await sendSms({ to: t.phone, text: body, slot })
        const cur = loadTransactions().find((x) => x.id === t.id)
        if (cur) updateTransaction(t.id, { responses: [...(cur.responses || []), { input: 'SMS sent', text: body }] })
      } catch (e) {
        failed += 1
        console.error('AB manual sms', e)
      }
    }
    const total = msgTo.length
    setMsgBusy(false)
    setMsgTo(null)
    if (failed) setNotice(`Could not send ${failed} of ${total} messages`)
    else clearSel()
  }

  // Sends a different plan to the same customer (runs like a Quick Dial)
  const recoOffers = recoFor
    ? readOffers().filter((o) => o.enabled !== false && String(o.id) !== String(recoFor.offerId))
    : []
  async function pickReco(o) {
    const t = recoFor
    setRecoFor(null)
    if (!(await confirmDialog(`Send ${o.name} (KES ${o.price}) to ${t.phone}?`, { title: 'Recommend this plan?', confirmLabel: 'Send' }))) return
    engine.quickDial({ offerId: o.id, phone: t.phone }).then((r) => {
      if (r && !r.ok && r.status === 'Failed') setNotice(`Could not send the alternative plan: ${r.text}`)
    })
    goBack()
  }

  async function copySummary(t) {
    const text = [
      `Name: ${t.name || '-'}`, `Phone: ${t.phone || '-'}`, `Plan: ${t.offerName}`, `Amount: KES ${t.amount}`,
      `Status: ${t.status}`, `M-Pesa ID: ${t.mpesaId || '-'}`, `Date: ${fmtDate(t.createdAt)} ${fmtTime(t.createdAt)}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      setNotice('Could not copy. Select the text and copy it by hand.')
    }
  }
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  const responseText = (t) =>
    t.responses && t.responses.length
      ? t.responses.map((r, i) => `--- Screen ${i + 1} (input: ${r.input}) ---\n${r.text}`).join('\n\n')
      : 'No response recorded yet.'

  // One transaction row, used on Home and on the full list. Long press selects it.
  const row = (t, from) => {
    const on = sel.includes(t.id)
    return (
      <button
        key={t.id}
        className={`hm-row ${on ? 'sel' : ''}`}
        onClick={() => rowTap(t, from)}
        onPointerDown={() => rowDown(t.id)}
        onPointerUp={rowUp}
        onPointerLeave={rowUp}
        onPointerCancel={rowUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="hm-avatar">{on ? <Ic name="check" size={22} /> : initials(t.name || t.phone)}</span>
        <span className="hm-row-main">
          <span className="hm-row-name">
            <span className="hm-nm">{t.name || t.phone}</span>
            {t.verified !== false && <VerifiedBadge />}
            {tagOf(t) && <span className="hm-fb">{tagOf(t)}</span>}
          </span>
          <span className="hm-row-sub">{t.phone} · {t.offerName} · KES {t.amount}</span>
        </span>
        <span className="hm-row-end">
          <span data-status={t.status} className={`st hm-${t.status === 'Scheduled' ? 'info-c' : TONE[t.status]}`}>{t.status}</span>
          <span className="when">{ago(t.createdAt, now)}</span>
        </span>
      </button>
    )
  }

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
      {selTxs.length > 0 && (screen === 'home' || screen === 'all') && (
        <div className="hm-selbar" role="toolbar" aria-label="Actions for the selected transactions">
          <div className="hm-selbar-top">
            <button className="hm-selx" onClick={clearSel} aria-label="Cancel selection"><Ic name="close" /></button>
            <b>{selTxs.length} selected</b>
            <button className="hm-selx" onClick={() => setSel(shown.map((t) => t.id))} aria-label="Select all"><Ic name="all" /></button>
          </div>
          <div className="hm-selacts">
            <button className="hm-selact" onClick={bulkRetry}><Ic name="retry" /><span>Retry</span></button>
            <button className="hm-selact" onClick={() => openMessage(selTxs)}><Ic name="message" /><span>Message</span></button>
            <button className="hm-selact" onClick={() => blacklist(selTxs)}><Ic name="ban" /><span>Blacklist</span></button>
            <button className="hm-selact" onClick={bulkComplete}><Ic name="check" /><span>Complete</span></button>
            <button className="hm-selact del" onClick={bulkDelete}><Ic name="trash" /><span>Delete</span></button>
          </div>
        </div>
      )}

      {msgTo && (
        <div className="hm-modal-back" onClick={() => !msgBusy && setMsgTo(null)}>
          <div className="hm-modal" role="dialog" aria-label="Send message" onClick={(e) => e.stopPropagation()}>
            <h3>Send message</h3>
            <p>
              {msgTo.length === 1 ? `To ${msgTo[0].name || msgTo[0].phone} (${msgTo[0].phone}).` : `To ${msgTo.length} customers.`}
              {' '}Type {'{name}'} to put in the customer's first name.
            </p>
            <textarea className="hm-ta" rows={4} value={msgText} onChange={(e) => setMsgText(e.target.value)} placeholder="Type your message" />
            <div className="hm-qk">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => setMsgText(q)}>{q}</button>)}
            </div>
            <button className="hm-simbtn hm-center" disabled={msgBusy || !msgText.trim()} onClick={sendMessages}>
              {msgBusy ? 'Sending…' : 'Send'}
            </button>
            <button className="hm-cancel" disabled={msgBusy} onClick={() => setMsgTo(null)}>Cancel</button>
          </div>
        </div>
      )}

      {recoFor && (
        <div className="hm-modal-back" onClick={() => setRecoFor(null)}>
          <div className="hm-modal" role="dialog" aria-label="Recommend another plan" onClick={(e) => e.stopPropagation()}>
            <h3>Recommend another plan</h3>
            <p>Pick the plan to send to {recoFor.phone} instead of {recoFor.offerName}.</p>
            <div className="hm-scroll">
              {recoOffers.length === 0 ? (
                <p>No other enabled offers. Add some in Offers.</p>
              ) : (
                recoOffers.map((o) => (
                  <button key={o.id} className="hm-simbtn" onClick={() => pickReco(o)}>
                    {o.name}
                    <small>KES {o.price}{o.category ? ` · ${o.category}` : ''}</small>
                  </button>
                ))
              )}
            </div>
            <button className="hm-cancel" onClick={() => setRecoFor(null)}>Cancel</button>
          </div>
        </div>
      )}
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
                ) : filter === 'All' ? (
                  <p>No transactions today yet. Tap the arrow to see older ones.</p>
                ) : (
                  <p>No {filter.toLowerCase()} transactions today.</p>
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
            <span data-status={tx.status} className={`hm-status ${TONE[tx.status]}`}>{tx.status}</span>
            <span className="hm-datetime">
              <span><Icon name="calendar" />{fmtDate(execAt(tx))}</span>
              <span><Icon name="clock" />{fmtTime(execAt(tx))}</span>
            </span>
          </div>

          <div className="hm-money">
            <span className="hm-amount">KES {tx.amount}</span>
            <span className="hm-offer">{tx.offerName}</span>
          </div>

          <p className="hm-fbnote">Airtime cost saved: <b>KES {Number(tx.cost) || 0}</b></p>

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
          <div className="hm-actions hm-actions2">
            <button className="hm-act" onClick={() => openMessage([tx])} disabled={!tx.phone}>
              <Ic name="message" /> Message
            </button>
            <button className="hm-act" onClick={() => blacklist([tx])} disabled={!tx.phone || tx.blacklisted || isBlacklisted(tx.phone)}>
              <Ic name="ban" /> Blacklist
            </button>
            <button className="hm-act" onClick={() => copySummary(tx)}>
              <Ic name="copy" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="hm-act" onClick={() => setRecoFor(tx)} disabled={!tx.phone}>
              <Ic name="swap" /> Recommend plan
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