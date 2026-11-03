import { useState } from 'react'
import { parsePhone } from '../quickdial/ussd'

// Temporary sample offers, used only if the app does not pass real ones.
const FALLBACK_OFFERS = [
  { id: 1, name: 'Sample offer 1' },
  { id: 2, name: 'Sample offer 2' },
]

const pad = (n) => String(n).padStart(2, '0')
const toDateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toTimeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export default function AutoRenewalPage({ offers = FALLBACK_OFFERS, onBack }) {
  const [phone, setPhone] = useState('')
  const [offerId, setOfferId] = useState('')
  const [autoRenew, setAutoRenew] = useState(true)
  const [days, setDays] = useState('')
  const [date, setDate] = useState(() => toDateValue(new Date()))
  const [time, setTime] = useState(() => toTimeValue(new Date()))
  const [message, setMessage] = useState(null)

  function handleSchedule() {
    const cleanPhone = parsePhone(phone)
    const dayCount = parseInt(days, 10)

    if (!cleanPhone) return setMessage({ ok: false, text: 'Enter a valid phone number' })
    if (!offerId) return setMessage({ ok: false, text: 'Select an offer first' })
    if (!date || !time) return setMessage({ ok: false, text: 'Choose a date and time' })

    const startAt = new Date(`${date}T${time}`)
    if (Number.isNaN(startAt.getTime()))
      return setMessage({ ok: false, text: 'Choose a valid date and time' })
    if (startAt.getTime() < Date.now() - 60000)
      return setMessage({ ok: false, text: 'That date and time has already passed' })
    if (autoRenew && !(dayCount >= 1 && dayCount <= 365))
      return setMessage({ ok: false, text: 'Enter days between 1 and 365' })

    const offer = offers.find((o) => String(o.id) === String(offerId))
    if (!offer) return setMessage({ ok: false, text: 'Select an offer first' })

    const entry = {
      id: Date.now(),
      phone: cleanPhone,
      offerId: offer.id,
      offerName: offer.name,
      startAt: startAt.toISOString(),
      autoRenew,
      days: autoRenew ? dayCount : 1,
    }

    try {
      const list = JSON.parse(localStorage.getItem('autorenew:schedules') || '[]')
      list.push(entry)
      localStorage.setItem('autorenew:schedules', JSON.stringify(list))
    } catch (e) {
      console.error('Could not save schedule', e)
    }

    setMessage({ ok: true, text: 'Scheduled' })
    setPhone('')
    setOfferId('')
    setDays('')
    const fresh = new Date()
    setDate(toDateValue(fresh))
    setTime(toTimeValue(fresh))
  }

  return (
    <div className="ar-page">
      <style>{`
        .ar-page {
          --ar-accent: var(--accent-color, #526581);
          --ar-border: var(--border-color, #E1E4E8);
          --ar-field: var(--muted-bg, #EDF0F4);
          --ar-muted: var(--muted-text, #626B78);
          width: 100%;
          box-sizing: border-box;
          padding: 8px 4px 32px;
          letter-spacing: 0.02em;
        }
        .app.dark .ar-page { color-scheme: dark; }
        .app.light .ar-page { color-scheme: light; }
        .ar-inner { max-width: 440px; margin: 0 auto; }
        .ar-head { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
        .ar-back {
          background: none; border: 0; color: inherit; cursor: pointer;
          font-size: 26px; line-height: 1; padding: 4px;
        }
        .ar-title { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: 0.08em; }
        .ar-input {
          width: 100%; box-sizing: border-box; background: transparent; color: inherit;
          border: 2px solid var(--ar-border); border-radius: 8px;
          padding: 18px 16px; font: inherit; font-size: 16px; outline: none;
        }
        .ar-input::placeholder { color: var(--ar-muted); }
        .ar-input:focus { border-color: var(--ar-accent); }
        .ar-select-wrap { position: relative; margin-top: 18px; }
        .ar-select {
          width: 100%; box-sizing: border-box; appearance: none; -webkit-appearance: none;
          background: var(--ar-field); color: inherit; border: 0; border-radius: 12px;
          padding: 20px 48px 20px 16px; font: inherit; font-size: 16px; font-weight: 600;
          outline: none; cursor: pointer;
        }
        .ar-select:focus-visible { box-shadow: 0 0 0 2px var(--ar-accent); }
        .ar-caret {
          position: absolute; right: 20px; top: 50%; transform: translateY(-50%);
          width: 0; height: 0; pointer-events: none;
          border-left: 7px solid transparent; border-right: 7px solid transparent;
          border-top: 8px solid currentColor;
        }
        .ar-when {
          display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
          margin-top: 30px; font-size: 16px; font-weight: 600;
        }
        .ar-when input {
          background: var(--ar-field); color: var(--ar-accent); border: 2px solid transparent;
          border-radius: 10px; padding: 12px 12px; font: inherit; font-size: 16px;
          font-weight: 700; outline: none; cursor: pointer;
        }
        .ar-when input:focus { border-color: var(--ar-accent); }
        .ar-check {
          display: flex; align-items: center; gap: 18px; margin-top: 30px;
          font-size: 18px; font-weight: 600; cursor: pointer; width: fit-content;
          user-select: none;
        }
        .ar-check:focus-visible { outline: 2px solid var(--ar-accent); outline-offset: 4px; border-radius: 6px; }
        .ar-box {
          width: 34px; height: 34px; border-radius: 7px; background: var(--ar-accent);
display: grid; place-items: center; color: var(--on-primary, #fff); font-size: 22px; font-weight: 700;
          border: 2px solid var(--ar-accent); box-sizing: border-box;
        }
        .ar-box.off { background: transparent; border-color: var(--ar-border); }
        .ar-renew {
          display: flex; align-items: baseline; gap: 12px; margin-top: 32px;
          font-size: 17px; font-weight: 600; flex-wrap: wrap;
        }
        .ar-renew.dim { opacity: 0.4; }
        .ar-days {
          width: 70px; background: transparent; border: 0; border-bottom: 2px solid var(--ar-border);
          color: inherit; font: inherit; text-align: center; outline: none; padding: 2px 0;
        }
        .ar-days:focus { border-bottom-color: var(--ar-accent); }
        .ar-btn {
          display: block; width: 100%; margin-top: 40px; padding: 20px 0;
background: var(--ar-accent); color: var(--on-primary, #fff); border: 0; border-radius: 999px;
          font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
        }
        .ar-btn:hover { filter: brightness(1.08); }
        .ar-btn:active { filter: brightness(0.92); }
        .ar-btn:focus-visible { outline: 2px solid var(--ar-accent); outline-offset: 3px; }
        .ar-msg { text-align: center; margin-top: 18px; font-size: 15px; font-weight: 600; }
        .ar-msg.ok { color: var(--ar-accent); }
        .ar-msg.err { color: #d64545; }
      `}</style>

      <div className="ar-inner">
        <div className="ar-head">
          <button className="ar-back" onClick={onBack} aria-label="Go back">
            ←
          </button>
          <h1 className="ar-title">AUTO RENEW</h1>
        </div>

        <input
          className="ar-input"
          type="tel"
          inputMode="tel"
          placeholder="Customer Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-label="Customer phone"
        />

        <div className="ar-select-wrap">
          <select
            className="ar-select"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            aria-label="Select offer"
          >
            <option value="">Select Offer</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <span className="ar-caret" />
        </div>

        <div className="ar-when">
          <input
            type="date"
            value={date}
            min={toDateValue(new Date())}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Start date"
          />
          <span>at</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Start time"
          />
        </div>

        <div
          className="ar-check"
          role="checkbox"
          aria-checked={autoRenew}
          tabIndex={0}
          onClick={() => setAutoRenew(!autoRenew)}
          onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setAutoRenew(!autoRenew)}
        >
          <span className={`ar-box ${autoRenew ? '' : 'off'}`}>{autoRenew ? '✓' : ''}</span>
          Auto-Renew
        </div>

        <div className={`ar-renew ${autoRenew ? '' : 'dim'}`}>
          <span>Renew daily for the next</span>
          <input
            className="ar-days"
            type="number"
            inputMode="numeric"
            min="1"
            max="365"
            value={days}
            disabled={!autoRenew}
            onChange={(e) => setDays(e.target.value)}
            aria-label="Number of days"
          />
          <span>Day(s)</span>
        </div>

        <button className="ar-btn" onClick={handleSchedule}>
          Schedule
        </button>

        {message && (
          <div className={`ar-msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</div>
        )}
      </div>
    </div>
  )
}