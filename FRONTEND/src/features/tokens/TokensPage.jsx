import { useEffect, useRef, useState } from 'react'
import { parsePhone } from '../quickdial/ussd.js'
import { loadWallet, subscribe } from '../home/dataStore.js'
import { loadHistory } from '../../engine/tokens.js'
import { isNative } from '../../engine/native.js'
import {
  payWithAirtime, verifyAirtimePayment, cancelAirtimePayment, pendingAirtimePayment,
  startMpesaPayment, waitForMpesaPayment, pendingMpesaPayment, cancelMpesaPayment,
} from '../../engine/tokenPay.js'

const PACKAGES = [
  { id: 'u1000', title: '1,000 units', note: 'Non-expiry', price: 90, units: 1000 },
  { id: 'u600', title: '600 units', note: 'Non-expiry', price: 50, units: 600 },
  { id: 'u250', title: '250 units', note: 'Non-expiry', price: 25, units: 250 },
  { id: 'u100', title: '100 units', note: 'Non-expiry', price: 15, units: 100 },
  { id: 'd1', title: '1 day unlimited', note: 'Unlimited daily', price: 30, days: 1 },
  { id: 'd7', title: '7 days unlimited', note: 'Unlimited 7 days', price: 200, days: 7 },
  { id: 'd30', title: '30 days unlimited', note: 'Unlimited 30 days', price: 550, days: 30 },
]

const DAY_MS = 24 * 60 * 60 * 1000

function timeLeft(until, now) {
  const ms = until - now
  if (ms <= 0) return ''
  const d = Math.floor(ms / DAY_MS)
  const h = Math.floor((ms % DAY_MS) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${d}d ${h}h ${m}m left`
}

const toPlan = (pkg) => ({ ...pkg, label: pkg.title })

export default function TokensPage({ onBack }) {
  const [wallet, setWallet] = useState(loadWallet)
  const [now, setNow] = useState(Date.now())
  const [screen, setScreen] = useState('list') // list | method | processing | problem | done
  const [selected, setSelected] = useState(null)
  const [method, setMethod] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [problem, setProblem] = useState({ kind: '', message: '' })
  const [receipt, setReceipt] = useState(null)
  const [simSlot, setSimSlot] = useState(() => (Number(localStorage.getItem('tokens:paySim')) === 1 ? 1 : 0))
  const busy = useRef(false)
  const native = isNative()

  useEffect(() => {
    const refreshWallet = () => { setWallet(loadWallet()); setNow(Date.now()) }
    const off = subscribe(refreshWallet)
    const t = setInterval(() => setNow(Date.now()), 30000)

    // A payment interrupted earlier (app closed, no answer yet) comes back here
    const a = pendingAirtimePayment()
    const m = pendingMpesaPayment()
    if (a) {
      setProblem({ kind: 'airtime', message: `A KES ${a.amount} airtime payment for ${a.plan.label} is waiting to be confirmed.` })
      setScreen('problem')
    } else if (m) {
      setProblem({ kind: 'mpesa', message: `An M-Pesa payment for ${m.plan.label} is waiting. If you paid, press Check payment.` })
      setScreen('problem')
    }
    return () => { off(); clearInterval(t) }
  }, [])

  const unlimitedActive = wallet.unlimitedUntil > now

  function refresh() {
    setWallet(loadWallet())
    setNow(Date.now())
  }

  function startBuy(pkg) {
    setSelected(pkg)
    setMethod('')
    setPhone('')
    setError('')
    setScreen('method')
  }

  function showDone(via) {
    const last = loadHistory()[0]
    setReceipt({
      title: last ? last.label : selected ? selected.title : '',
      price: last ? last.price : selected ? selected.price : 0,
      method: via === 'mpesa' ? 'M-Pesa' : 'Airtime',
      ref: last && last.ref ? last.ref : '-',
      time: new Date().toLocaleString('en-KE'),
    })
    refresh()
    setScreen('done')
  }

  function showProblem(kind, message) {
    setProblem({ kind, message })
    setScreen('problem')
  }

  async function pay() {
    if (busy.current) return
    if (!method) return setError('Choose how you want to pay')
    if (method === 'mpesa' && !parsePhone(phone)) return setError('Enter a valid M-Pesa phone number')
    if (method === 'airtime' && !native) return setError('Paying with airtime only works inside the Android app')
    setError('')
    busy.current = true
    setScreen('processing')
    const plan = toPlan(selected)

    if (method === 'airtime') {
      setStatus('Starting the payment...')
      try {
        const r = await payWithAirtime(plan, { onStatus: setStatus, slot: simSlot })
        if (r.status === 'paid') showDone('airtime')
        else showProblem('airtime', r.message)
      } catch (e) {
        setError(e && e.message ? e.message : String(e))
        setScreen('method')
      }
    } else {
      setStatus('Sending the M-Pesa prompt to your phone...')
      let started = false
      try {
        await startMpesaPayment(plan, phone)
        started = true
        setStatus('Enter your M-Pesa PIN on your phone...')
        const r = await waitForMpesaPayment({ onStatus: setStatus })
        if (r.status === 'paid') showDone('mpesa')
        else if (r.status === 'failed') showProblem('failed', r.message)
        else showProblem('mpesa', r.message)
      } catch (e) {
        const msg = e && e.message ? e.message : String(e)
        if (started) showProblem('mpesa', msg)
        else { setError(msg); setScreen('method') }
      }
    }
    busy.current = false
  }

  async function recheck() {
    if (busy.current) return
    busy.current = true
    setScreen('processing')
    try {
      if (problem.kind === 'airtime') {
        setStatus('Confirming the airtime payment...')
        const r = await verifyAirtimePayment({ onStatus: setStatus })
        if (r.status === 'paid') showDone('airtime')
        else showProblem('airtime', r.message)
      } else {
        setStatus('Checking your M-Pesa payment...')
        const r = await waitForMpesaPayment({ onStatus: setStatus, timeoutMs: 30000 })
        if (r.status === 'paid') showDone('mpesa')
        else if (r.status === 'failed') showProblem('failed', r.message)
        else showProblem('mpesa', r.message)
      }
    } catch (e) {
      showProblem(problem.kind, e && e.message ? e.message : String(e))
    }
    busy.current = false
  }

  function cancelPending() {
    if (problem.kind === 'airtime') cancelAirtimePayment()
    else cancelMpesaPayment()
    finish()
  }

  function finish() {
    setScreen('list')
    setSelected(null)
    setReceipt(null)
    setError('')
    refresh()
  }

  const canGoBack = screen !== 'processing'

  return (
    <div className="tk-page">
      <style>{`
        .tk-page {
          --tk-accent: var(--accent-color, #1F5EFF);
          --tk-card: var(--card-bg, #FFFFFF);
          --tk-border: var(--border-color, #D5DDF0);
          --tk-soft: var(--muted-text, #4A5568);
          --tk-hover: var(--muted-bg, #E6EDFF);
          --tk-on: var(--on-primary, #FFFFFF);
          --tk-ok: var(--success, #0A7D4B);
          width: 100%; box-sizing: border-box; padding: 4px 4px 32px;
        }
        .tk-inner { max-width: 560px; margin: 0 auto; }
        .tk-head { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; margin-bottom: 20px; }
        .tk-head h1 { margin: 0; text-align: center; font-size: 20px; font-weight: 700; }
        .tk-icon-btn { width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 24px; cursor: pointer; display: grid; place-items: center; }
        .tk-icon-btn:hover { background: var(--tk-hover); }
        .tk-icon-btn:disabled { opacity: .4; cursor: default; }
        .tk-icon-btn:focus-visible, .tk-buy:focus-visible, .tk-btn:focus-visible, .tk-method:focus-visible { outline: 2px solid var(--tk-accent); outline-offset: 3px; }
        .tk-balance { display: flex; align-items: center; gap: 18px; padding: 20px; border: 1px solid var(--tk-border); border-radius: 18px; background: var(--tk-card); }
        .tk-cube { width: 54px; height: 54px; border-radius: 14px; background: var(--tk-hover); color: var(--tk-accent); display: grid; place-items: center; font-size: 28px; flex-shrink: 0; }
        .tk-balance small { display: block; color: var(--tk-soft); font-size: 13px; }
        .tk-units { font-size: 28px; font-weight: 800; color: var(--tk-accent); margin: 2px 0; }
        .tk-unl { font-size: 13px; color: var(--tk-soft); }
        .tk-unl.on { color: var(--tk-ok); font-weight: 600; }
        .tk-sub { margin: 26px 0 12px; font-size: 17px; font-weight: 700; }
        .tk-list { display: grid; gap: 12px; }
        .tk-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px; border: 1px solid var(--tk-border); border-radius: 16px; background: var(--tk-card); }
        .tk-card h3 { margin: 0; font-size: 17px; }
        .tk-note { color: var(--tk-soft); font-size: 13px; margin: 5px 0 10px; }
        .tk-price { font-size: 16px; font-weight: 800; }
        .tk-buy { min-width: 92px; padding: 14px 20px; border: 0; border-radius: 14px; background: var(--tk-accent); color: var(--tk-on); font: inherit; font-weight: 700; cursor: pointer; }
        .tk-buy:hover { filter: brightness(1.08); }
        .tk-panel { padding: 22px; border: 1px solid var(--tk-border); border-radius: 18px; background: var(--tk-card); }
        .tk-panel h2 { margin: 0 0 6px; font-size: 20px; }
        .tk-summary { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border-radius: 12px; background: var(--tk-hover); margin: 14px 0 20px; }
        .tk-methods { display: grid; gap: 12px; }
        .tk-method { display: flex; align-items: center; gap: 14px; width: 100%; padding: 18px; border: 2px solid var(--tk-border); border-radius: 14px; background: transparent; color: inherit; font: inherit; font-size: 16px; font-weight: 600; text-align: left; cursor: pointer; }
        .tk-method.on { border-color: var(--tk-accent); background: var(--tk-hover); }
        .tk-method .tk-mi { font-size: 24px; }
        .tk-method small { display: block; color: var(--tk-soft); font-weight: 400; font-size: 13px; }
        .tk-field { width: 100%; box-sizing: border-box; margin-top: 14px; padding: 16px; border: 2px solid var(--tk-border); border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none; }
        .tk-field:focus { border-color: var(--tk-accent); }
        .tk-err { color: var(--danger, #D32F2F); font-weight: 600; margin: 14px 0 0; font-size: 14px; }
        .tk-row { display: flex; gap: 10px; margin-top: 22px; }
        .tk-btn { flex: 1; padding: 16px; border: 0; border-radius: 999px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; background: var(--tk-accent); color: var(--tk-on); }
        .tk-btn.ghost { background: transparent; color: inherit; border: 2px solid var(--tk-border); }
        .tk-center { text-align: center; padding: 36px 20px; }
        .tk-spinner { width: 64px; height: 64px; margin: 0 auto 22px; border-radius: 50%; border: 6px solid var(--tk-hover); border-top-color: var(--tk-accent); animation: tk-spin 0.9s linear infinite; }
        @keyframes tk-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .tk-spinner { animation-duration: 3s; } }
        .tk-tick { width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 50%; background: var(--tk-ok); color: var(--tk-on); display: grid; place-items: center; font-size: 40px; font-weight: 800; }
        .tk-warn { width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 50%; background: var(--danger, #D32F2F); color: #fff; display: grid; place-items: center; font-size: 40px; font-weight: 800; }
        .tk-receipt { text-align: left; margin: 22px 0 0; padding: 14px; border-radius: 12px; background: var(--tk-hover); display: grid; gap: 8px; font-size: 14px; }
        .tk-receipt div { display: flex; justify-content: space-between; gap: 12px; }
        .tk-receipt span:first-child { color: var(--tk-soft); }
        .tk-wait { color: var(--tk-soft); margin: 6px 0 0; }
        .tk-head { margin-bottom: 8px; }
        .tk-head h1 { font-size: 18px; }
        .tk-balance { padding: 10px 14px; gap: 12px; border-radius: 14px; }
        .tk-cube { width: 38px; height: 38px; font-size: 20px; border-radius: 10px; }
        .tk-balance small { font-size: 12px; }
        .tk-units { font-size: 20px; margin: 0; }
        .tk-unl { font-size: 12px; }
        .tk-sub { margin: 12px 0 8px; font-size: 15px; }
        .tk-list { gap: 6px; }
        .tk-card { display: grid; grid-template-columns: 1fr auto auto; column-gap: 12px; align-items: center; padding: 8px 12px; border-radius: 12px; }
        .tk-card > div { display: contents; }
        .tk-card h3 { grid-column: 1; grid-row: 1; font-size: 14px; }
        .tk-card .tk-note { grid-column: 1; grid-row: 2; font-size: 11px; margin: 1px 0 0; }
        .tk-card .tk-price { grid-column: 2; grid-row: 1 / span 2; font-size: 13px; white-space: nowrap; }
        .tk-card .tk-buy { grid-column: 3; grid-row: 1 / span 2; min-width: 64px; padding: 9px 16px; font-size: 13px; border-radius: 10px; }
        .tk-status { font-weight: 600; margin: 14px 0 0; }
      `}</style>

      <div className="tk-inner">
        <div className="tk-head">
          <button className="tk-icon-btn" onClick={screen === 'list' ? onBack : finish} aria-label="Go back" disabled={!canGoBack}>←</button>
          <h1>Token Top Up</h1>
          <button className="tk-icon-btn" onClick={refresh} aria-label="Refresh balance">↻</button>
        </div>

        {screen === 'list' && (
          <>
            <div className="tk-balance">
              <div className="tk-cube">⬡</div>
              <div>
                <small>Available Tokens</small>
                <div className="tk-units">{Number(wallet.units || 0).toLocaleString('en-KE')} units</div>
                <div className={`tk-unl ${unlimitedActive ? 'on' : ''}`}>
                  {unlimitedActive ? `∞ Unlimited active • ${timeLeft(wallet.unlimitedUntil, now)}` : '∞ No unlimited plan active'}
                </div>
              </div>
            </div>

            <h2 className="tk-sub">Available Packages</h2>
            <div className="tk-list">
              {PACKAGES.map((pkg) => (
                <article className="tk-card" key={pkg.id}>
                  <div>
                    <h3>{pkg.title}</h3>
                    <div className="tk-note">{pkg.note}</div>
                    <div className="tk-price">KES {pkg.price}</div>
                  </div>
                  <button className="tk-buy" onClick={() => startBuy(pkg)}>Buy</button>
                </article>
              ))}
            </div>
          </>
        )}

        {screen === 'method' && selected && (
          <div className="tk-panel">
            <h2>Choose payment method</h2>
            <div className="tk-summary">
              <strong>{selected.title}</strong>
              <strong>KES {selected.price}</strong>
            </div>

            <div className="tk-methods">
              <button type="button" className={`tk-method ${method === 'airtime' ? 'on' : ''}`}
                onClick={() => { setMethod('airtime'); setError('') }}>
                <span className="tk-mi">▯</span>
                <span>
                  Pay using Airtime
                  <small>Sent silently from your SIM, then confirmed</small>
                </span>
              </button>
              <button type="button" className={`tk-method ${method === 'mpesa' ? 'on' : ''}`}
                onClick={() => { setMethod('mpesa'); setError('') }}>
                <span className="tk-mi">☎</span>
                <span>
                  Pay using M-Pesa
                  <small>You will get a payment prompt on your phone</small>
                </span>
              </button>
            </div>

            {method === 'airtime' && (
              <div>
                <p className="tk-wait">Pay from which SIM?</p>
                <div className="tk-row">
                  {[0, 1].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`tk-btn ${simSlot === s ? '' : 'ghost'}`}
                      onClick={() => {
                        setSimSlot(s)
                        try { localStorage.setItem('tokens:paySim', String(s)) } catch (e) { /* ignore */ }
                      }}
                    >
                      SIM {s + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {method === 'mpesa' && (
              <input className="tk-field" type="tel" inputMode="tel" placeholder="M-Pesa phone number"
                value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="M-Pesa phone number" />
            )}

            {error && <p className="tk-err" role="alert">{error}</p>}

            <div className="tk-row">
              <button className="tk-btn ghost" onClick={finish}>Cancel</button>
              <button className="tk-btn" onClick={pay}>Pay KES {selected.price}</button>
            </div>
          </div>
        )}

        {screen === 'processing' && (
          <div className="tk-panel tk-center" role="status" aria-live="polite">
            <div className="tk-spinner" />
            <h2>Please wait</h2>
            <p className="tk-wait">Kindly wait while your payment is being confirmed. Do not close this page.</p>
            {status && <p className="tk-status">{status}</p>}
          </div>
        )}

        {screen === 'problem' && (
          <div className="tk-panel tk-center" role="alert">
            <div className="tk-warn">!</div>
            <h2>{problem.kind === 'failed' ? 'Payment failed' : 'Payment not confirmed yet'}</h2>
            <p className="tk-wait">{problem.message}</p>
            <p className="tk-wait">No token is added until the payment is confirmed.</p>
            <div className="tk-row">
              {problem.kind === 'failed' ? (
                <button className="tk-btn" onClick={finish}>Close</button>
              ) : (
                <>
                  <button className="tk-btn ghost" onClick={cancelPending}>Cancel payment</button>
                  <button className="tk-btn" onClick={recheck}>{problem.kind === 'airtime' ? 'Verify again' : 'Check payment'}</button>
                </>
              )}
            </div>
          </div>
        )}

        {screen === 'done' && receipt && (
          <div className="tk-panel tk-center" role="status">
            <div className="tk-tick">✓</div>
            <h2>Payment confirmed</h2>
            <p className="tk-wait">Your tokens have been added successfully.</p>
            <div className="tk-receipt">
              <div><span>Package</span><strong>{receipt.title}</strong></div>
              <div><span>Amount</span><strong>KES {receipt.price}</strong></div>
              <div><span>Paid with</span><strong>{receipt.method}</strong></div>
              <div><span>Reference</span><strong>{receipt.ref}</strong></div>
              <div><span>Time</span><strong>{receipt.time}</strong></div>
            </div>
            <div className="tk-row">
              <button className="tk-btn" onClick={finish}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}