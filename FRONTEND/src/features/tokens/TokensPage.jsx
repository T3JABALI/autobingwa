import { useEffect, useRef, useState } from 'react'
import { parsePhone } from '../quickdial/ussd'

const PACKAGES = [
  { id: 'u1000', title: '1,000 units', note: 'Non-expiry', price: 90, units: 1000 },
  { id: 'u600', title: '600 units', note: 'Non-expiry', price: 50, units: 600 },
  { id: 'u250', title: '250 units', note: 'Non-expiry', price: 25, units: 250 },
  { id: 'u100', title: '100 units', note: 'Non-expiry', price: 15, units: 100 },
  { id: 'd1', title: '1 day unlimited', note: 'Unlimited daily', price: 30, days: 1 },
  { id: 'd7', title: '7 days unlimited', note: 'Unlimited 7 days', price: 200, days: 7 },
  { id: 'd30', title: '30 days unlimited', note: 'Unlimited 30 days', price: 550, days: 30 },
]

const STORAGE_KEY = 'tokens:wallet'
const DAY_MS = 24 * 60 * 60 * 1000

function loadWallet() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && typeof saved.units === 'number') return saved
  } catch (e) {
    console.error('Could not read wallet', e)
  }
  return { units: 0, unlimitedUntil: 0 }
}

function saveWallet(wallet) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet))
  } catch (e) {
    console.error('Could not save wallet', e)
  }
}

function timeLeft(until, now) {
  const ms = until - now
  if (ms <= 0) return ''
  const d = Math.floor(ms / DAY_MS)
  const h = Math.floor((ms % DAY_MS) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${d}d ${h}h ${m}m left`
}

export default function TokensPage({ onBack }) {
  const [wallet, setWallet] = useState(loadWallet)
  const [now, setNow] = useState(Date.now())
  const [screen, setScreen] = useState('list')
  const [selected, setSelected] = useState(null)
  const [method, setMethod] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      clearInterval(t)
      clearTimeout(timer.current)
    }
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

  function pay() {
    if (!method) return setError('Choose how you want to pay')
    let cleanPhone = ''
    if (method === 'mpesa') {
      cleanPhone = parsePhone(phone)
      if (!cleanPhone) return setError('Enter a valid M-Pesa phone number')
    }
    setError('')
    setScreen('processing')

    timer.current = setTimeout(() => {
      const current = loadWallet()
      const base = Math.max(Date.now(), current.unlimitedUntil || 0)
      const updated = selected.units
        ? { ...current, units: current.units + selected.units }
        : { ...current, unlimitedUntil: base + selected.days * DAY_MS }
      saveWallet(updated)
      setWallet(updated)
      setNow(Date.now())
      setReceipt({
        title: selected.title,
        price: selected.price,
        method: method === 'mpesa' ? `M-Pesa (${cleanPhone})` : 'Airtime',
        ref: 'TK' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        time: new Date().toLocaleString('en-KE'),
      })
      setScreen('done')
    }, 3500)
  }

  function finish() {
    setScreen('list')
    setSelected(null)
    setReceipt(null)
  }

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
        .tk-head {
          display: grid; grid-template-columns: 44px 1fr 44px; align-items: center;
          margin-bottom: 20px;
        }
        .tk-head h1 { margin: 0; text-align: center; font-size: 20px; font-weight: 700; }
        .tk-icon-btn {
          width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; font-size: 24px; cursor: pointer; display: grid; place-items: center;
        }
        .tk-icon-btn:hover { background: var(--tk-hover); }
        .tk-icon-btn:focus-visible, .tk-buy:focus-visible, .tk-btn:focus-visible,
        .tk-method:focus-visible { outline: 2px solid var(--tk-accent); outline-offset: 3px; }
        .tk-balance {
          display: flex; align-items: center; gap: 18px; padding: 20px;
          border: 1px solid var(--tk-border); border-radius: 18px; background: var(--tk-card);
        }
        .tk-cube {
          width: 54px; height: 54px; border-radius: 14px; background: var(--tk-hover);
          color: var(--tk-accent); display: grid; place-items: center; font-size: 28px; flex-shrink: 0;
        }
        .tk-balance small { display: block; color: var(--tk-soft); font-size: 13px; }
        .tk-units { font-size: 28px; font-weight: 800; color: var(--tk-accent); margin: 2px 0; }
        .tk-unl { font-size: 13px; color: var(--tk-soft); }
        .tk-unl.on { color: var(--tk-ok); font-weight: 600; }
        .tk-sub { margin: 26px 0 12px; font-size: 17px; font-weight: 700; }
        .tk-list { display: grid; gap: 12px; }
        .tk-card {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 18px; border: 1px solid var(--tk-border); border-radius: 16px;
          background: var(--tk-card);
        }
        .tk-card h3 { margin: 0; font-size: 17px; }
        .tk-note { color: var(--tk-soft); font-size: 13px; margin: 5px 0 10px; }
        .tk-price { font-size: 16px; font-weight: 800; }
        .tk-buy {
          min-width: 92px; padding: 14px 20px; border: 0; border-radius: 14px;
          background: var(--tk-accent); color: var(--tk-on); font: inherit; font-weight: 700;
          cursor: pointer;
        }
        .tk-buy:hover { filter: brightness(1.08); }
        .tk-panel {
          padding: 22px; border: 1px solid var(--tk-border); border-radius: 18px;
          background: var(--tk-card);
        }
        .tk-panel h2 { margin: 0 0 6px; font-size: 20px; }
        .tk-summary {
          display: flex; justify-content: space-between; gap: 12px; padding: 14px;
          border-radius: 12px; background: var(--tk-hover); margin: 14px 0 20px;
        }
        .tk-methods { display: grid; gap: 12px; }
        .tk-method {
          display: flex; align-items: center; gap: 14px; width: 100%; padding: 18px;
          border: 2px solid var(--tk-border); border-radius: 14px; background: transparent;
          color: inherit; font: inherit; font-size: 16px; font-weight: 600; text-align: left;
          cursor: pointer;
        }
        .tk-method.on { border-color: var(--tk-accent); background: var(--tk-hover); }
        .tk-method .tk-mi { font-size: 24px; }
        .tk-method small { display: block; color: var(--tk-soft); font-weight: 400; font-size: 13px; }
        .tk-field {
          width: 100%; box-sizing: border-box; margin-top: 14px; padding: 16px;
          border: 2px solid var(--tk-border); border-radius: 12px; background: transparent;
          color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .tk-field:focus { border-color: var(--tk-accent); }
        .tk-err { color: var(--danger, #D32F2F); font-weight: 600; margin: 14px 0 0; font-size: 14px; }
        .tk-row { display: flex; gap: 10px; margin-top: 22px; }
        .tk-btn {
          flex: 1; padding: 16px; border: 0; border-radius: 999px; font: inherit;
          font-size: 16px; font-weight: 700; cursor: pointer;
          background: var(--tk-accent); color: var(--tk-on);
        }
        .tk-btn.ghost {
          background: transparent; color: inherit; border: 2px solid var(--tk-border);
        }
        .tk-center { text-align: center; padding: 36px 20px; }
        .tk-spinner {
          width: 64px; height: 64px; margin: 0 auto 22px; border-radius: 50%;
          border: 6px solid var(--tk-hover); border-top-color: var(--tk-accent);
          animation: tk-spin 0.9s linear infinite;
        }
        @keyframes tk-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .tk-spinner { animation-duration: 3s; } }
        .tk-tick {
          width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 50%;
          background: var(--tk-ok); color: var(--tk-on); display: grid; place-items: center;
          font-size: 40px; font-weight: 800;
        }
        .tk-receipt {
          text-align: left; margin: 22px 0 0; padding: 14px; border-radius: 12px;
          background: var(--tk-hover); display: grid; gap: 8px; font-size: 14px;
        }
        .tk-receipt div { display: flex; justify-content: space-between; gap: 12px; }
        .tk-receipt span:first-child { color: var(--tk-soft); }
        .tk-wait { color: var(--tk-soft); margin: 6px 0 0; }
      `}</style>

      <div className="tk-inner">
        <div className="tk-head">
          <button className="tk-icon-btn" onClick={screen === 'list' ? onBack : finish} aria-label="Go back"
            disabled={screen === 'processing'}>
            ←
          </button>
          <h1>Token Top Up</h1>
          <button className="tk-icon-btn" onClick={refresh} aria-label="Refresh balance">
            ↻
          </button>
        </div>

        {screen === 'list' && (
          <>
            <div className="tk-balance">
              <div className="tk-cube">⬡</div>
              <div>
                <small>Available Tokens</small>
                <div className="tk-units">{wallet.units.toLocaleString('en-KE')} units</div>
                <div className={`tk-unl ${unlimitedActive ? 'on' : ''}`}>
                  {unlimitedActive
                    ? `∞ Unlimited active • ${timeLeft(wallet.unlimitedUntil, now)}`
                    : '∞ No unlimited plan active'}
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
                  <button className="tk-buy" onClick={() => startBuy(pkg)}>
                    Buy
                  </button>
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
              <button
                type="button"
                className={`tk-method ${method === 'airtime' ? 'on' : ''}`}
                onClick={() => { setMethod('airtime'); setError('') }}
              >
                <span className="tk-mi">▯</span>
                <span>
                  Pay using Airtime
                  <small>Deducted from your airtime balance</small>
                </span>
              </button>
              <button
                type="button"
                className={`tk-method ${method === 'mpesa' ? 'on' : ''}`}
                onClick={() => { setMethod('mpesa'); setError('') }}
              >
                <span className="tk-mi">☎</span>
                <span>
                  Pay using M-Pesa
                  <small>You will get a payment prompt on your phone</small>
                </span>
              </button>
            </div>

            {method === 'mpesa' && (
              <input
                className="tk-field"
                type="tel"
                inputMode="tel"
                placeholder="M-Pesa phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-label="M-Pesa phone number"
              />
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
            <p className="tk-wait">
              Kindly wait while your transaction is being processed. Do not close this page.
            </p>
          </div>
        )}

        {screen === 'done' && receipt && (
          <div className="tk-panel tk-center" role="status">
            <div className="tk-tick">✓</div>
            <h2>Transaction completed</h2>
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