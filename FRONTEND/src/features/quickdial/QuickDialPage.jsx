import { useState } from 'react'
import { parsePhone } from './ussd.js'
import { engine } from '../../engine/index.js'

export default function QuickDialPage({ offers, onBack, onOpenOffers }) {
  const [phoneText, setPhoneText] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState(null) // { ok, text }
  const [busy, setBusy] = useState(false)
  const [cat, setCat] = useState('ALL')

  const available = offers.filter(offer => offer.enabled)
  const catOf = offer => String(offer.category || offer.cat || 'OTHER').toUpperCase()
  const cats = [...new Set(available.map(catOf))]
  const shown = cat === 'ALL' || !cats.includes(cat) ? available : available.filter(o => catOf(o) === cat)

  function handlePhoneChange(value) {
    setPhoneText(value)
    setMessage('')
    setResult(null)
  }

  function handleSelect(id) {
    setSelectedId(id)
    setMessage('')
    setResult(null)
  }

  async function handleDial() {
    if (busy) return
    const phone = parsePhone(phoneText)
    if (!phone) {
      setMessage('Enter a valid phone number, for example 0712345678.')
      return
    }

    const offer = available.find(item => item.id === selectedId)
    if (!offer) {
      setMessage('Choose an offer first.')
      return
    }

    setMessage('')
    setResult(null)
    setBusy(true)
    try {
      // Same path as a customer payment: it shows in Recent transactions on Home
      setResult(await engine.quickDial({ offerId: offer.id, phone }))
    } catch (e) {
      setResult({ ok: false, text: `Could not dial: ${e && e.message ? e.message : e}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="qd-page">
          <style>{`
        .qd-page { width: 100%; min-width: 0; text-align: left; }
        .qd-page button, .qd-page textarea { font: inherit; color: inherit; }

        .qd-header { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
        .qd-back {
          display: grid; place-items: center; width: 36px; height: 36px; flex: none; padding: 0;
          border: 1px solid var(--border); border-radius: 12px;
          background: var(--panel); color: var(--text); cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }
        .qd-back:hover { background: var(--panel-hover); border-color: var(--primary); }
        .qd-title { margin: 0; color: var(--text); font-size: 17px; font-weight: 800; }

        .qd-phone {
          display: flex; gap: 8px; padding: 8px;
          border: 1px solid var(--border); border-radius: 14px;
          background: var(--bg); transition: border-color 0.2s;
        }
        .qd-phone:focus-within { border-color: var(--primary); }
        .qd-page .qd-input {
          flex: 1; min-width: 0; padding: 6px; border: 0; outline: 0; background: none;
          color: var(--text); resize: none; font-size: 14px; font-weight: 600;
        }
        .qd-page .qd-input::placeholder { color: var(--muted); opacity: 1; }
        .qd-call {
          flex: none; align-self: flex-start; display: grid; place-items: center;
          width: 46px; height: 46px; padding: 0; border: 0; border-radius: 12px;
          background: var(--primary); color: #FFFFFF; cursor: pointer;
          transition: background 0.15s, transform 0.15s;
        }
        .qd-call:hover { background: var(--primary-hover); }
        .qd-call:active { transform: scale(0.96); }
        .qd-call:disabled { opacity: 0.5; cursor: wait; transform: none; }

        .qd-page .qd-message { margin: 12px 0 0; color: var(--red); font-size: 12px; font-weight: 600; }
        .qd-page .qd-status { margin: 12px 0 0; color: var(--muted); font-size: 13px; font-weight: 600; }
        .qd-page .qd-result {
          margin: 12px 0 0; padding: 12px 14px; border-radius: 12px;
          border: 1px solid var(--border); font-size: 14px; font-weight: 600;
          line-height: 1.5; overflow-wrap: anywhere;
        }
        .qd-page .qd-result.ok { border-color: #1f9d55; color: #1f9d55; }
        .qd-page .qd-result.bad { border-color: var(--red); color: var(--red); }
        .qd-page .qd-empty { margin: 22px 0 0; color: var(--muted); font-size: 13px; }

        /* category chips */
        .qd-chips {
          display: flex; gap: 8px; margin-top: 14px; overflow-x: auto;
          padding-bottom: 2px; scrollbar-width: none;
        }
        .qd-chips::-webkit-scrollbar { display: none; }
        .qd-chip {
          flex: none; padding: 7px 14px; border: 1px solid var(--primary);
          border-radius: 999px; background: var(--bg); color: var(--primary);
          font-size: 12px; font-weight: 700; cursor: pointer;
          transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
        }
        @supports (background: color-mix(in srgb, red 10%, blue)) {
          .qd-chip {
            background: color-mix(in srgb, var(--primary) 12%, var(--bg));
            border-color: color-mix(in srgb, var(--primary) 35%, transparent);
          }
          .qd-chip:hover {
            background: color-mix(in srgb, var(--primary) 20%, var(--bg));
            border-color: var(--primary);
          }
        }
        .qd-chip[aria-selected='true'],
        .qd-chip[aria-selected='true']:hover {
          background: var(--primary); border-color: var(--primary); color: #FFFFFF;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
        }

        /* offers: 3 small cards per row, scrolling inside their own area */
        .qd-scroll {
          margin-top: 12px; max-height: calc(100vh - 340px); min-height: 120px;
          overflow-y: auto; padding: 2px 2px 6px; -webkit-overflow-scrolling: touch;
        }
        .qd-offers {
          display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
        }
        .qd-offer {
          display: flex; flex-direction: column; justify-content: space-between;
          gap: 4px; min-height: 54px; padding: 8px 9px;
          border: 1px solid var(--border); border-radius: 10px;
          background: var(--bg); color: var(--text);
          font-size: 11.5px; font-weight: 700; line-height: 1.25; text-align: left;
          overflow-wrap: anywhere; cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }
        .qd-offer:hover { border-color: var(--primary); }
        .qd-offer[aria-pressed='true'] {
          border-color: var(--primary); background: var(--primary); color: #FFFFFF;
        }
        .qd-offer-name {
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .qd-offer-price { font-size: 10.5px; font-weight: 600; color: var(--muted); }
        .qd-offer[aria-pressed='true'] .qd-offer-price { color: rgba(255, 255, 255, 0.85); }

        @media (max-width: 340px) {
          .qd-offers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>

      <header className="qd-header">
        <button type="button" className="qd-back" onClick={onBack} aria-label="Back to Home">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 12H5M11 6l-6 6 6 6"
            />
          </svg>
        </button>
        <h2 className="qd-title">Quick Dial</h2>
      </header>

      <div className="qd-phone">
        <textarea
          className="qd-input"
          value={phoneText}
          onChange={e => handlePhoneChange(e.target.value)}
          placeholder="Customer Phone"
          aria-label="Customer phone number"
          inputMode="tel"
          autoComplete="off"
          spellCheck={false}
             rows={5}
        />
        <button type="button" className="qd-call" onClick={handleDial} disabled={busy} aria-label="Dial">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
            />
          </svg>
        </button>
      </div>

      {message && (
        <p className="qd-message" role="alert">
          {message}
        </p>
      )}

      {busy && <p className="qd-status" role="status">Dialing. Keep the phone unlocked, this can take up to a minute...</p>}

      {result && (
        <p className={`qd-result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? '✔ Successful. ' : '✖ Failed. '}
          {result.text}
        </p>
      )}

      {available.length === 0 ? (
        <p className="qd-empty">
          No enabled offers yet.{' '}
          <button type="button" className="text-button" onClick={onOpenOffers}>
            Open Offers
          </button>
        </p>
      ) : (
            <>
          {cats.length > 1 && (
            <div className="qd-chips" role="tablist" aria-label="Offer categories">
              {['ALL', ...cats].map(c => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={cat === c}
                  className="qd-chip"
                  onClick={() => setCat(c)}
                >
                  {c === 'ALL' ? 'All' : c.charAt(0) + c.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          )}

          <div className="qd-scroll">
            <div className="qd-offers">
              {shown.map(offer => (
                <button
                  key={offer.id}
                  type="button"
                  className="qd-offer"
                  aria-pressed={offer.id === selectedId}
                  onClick={() => handleSelect(offer.id)}
                >
                  <span className="qd-offer-name">{offer.name}</span>
                  {Number(offer.price) > 0 && (
                    <span className="qd-offer-price">KES {Number(offer.price)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}