import { useRef, useState } from 'react'

const KEY = 'autoreplies:list'

const TRIGGERS = [
  { id: 'success', label: 'Successful Transaction' },
  { id: 'recommended', label: 'Offer Already Purchased Today' },
  { id: 'failed', label: 'Failed Transaction' },
  { id: 'unavailable', label: 'Unavailable Offer' },
  { id: 'paused', label: 'App Paused' },
  { id: 'blacklisted', label: 'Blacklisted Customer' },
]

const PLACEHOLDERS = [
  ['<firstName>', "Customer's first name"],
  ['<surname>', "Customer's surname"],
  ['<mpesaCode>', 'M-Pesa transaction code'],
  ['<amount>', 'Amount paid by the customer'],
  ['<offerName>', 'Name you have given this offer amount'],
  ['<offerPrice>', 'Actual price for current offer'],
]

const DEFAULTS = [
  {
    id: 'd-success', builtin: true, enabled: false, trigger: 'success', amounts: [],
    title: 'Successful Response',
    message: 'Hi <firstName>, thank you for purchasing from Autobingwa. Your <offerName> has been activated. M-Pesa code: <mpesaCode>.',
  },
  {
    id: 'd-recommended', builtin: true, enabled: false, trigger: 'recommended', amounts: [],
    title: 'Offer Already Recommended',
    message: 'Hello <firstName>, you have already purchased this offer today. Please try again tomorrow or choose another offer.',
  },
  {
    id: 'd-failed', builtin: true, enabled: false, trigger: 'failed', amounts: [],
    title: 'Failed Request',
    message: 'Hello <firstName>, your request failed. Please hold as we look into the issue.',
  },
  {
    id: 'd-unavailable', builtin: true, enabled: false, trigger: 'unavailable', amounts: [],
    title: 'Unavailable Offer',
    message: 'Hi <firstName>, there is no offer matching the amount you have paid (KES <amount>). Please contact us for help.',
  },
  {
    id: 'd-paused', builtin: true, enabled: false, trigger: 'paused', amounts: [],
    title: 'App Paused',
    message: 'Hi <firstName>, there is an issue affecting our systems. You will however receive your offer as soon as it is resolved.',
  },
  {
    id: 'd-blacklisted', builtin: true, enabled: false, trigger: 'blacklisted', amounts: [],
    title: 'Customer Blacklisted',
    message: 'Hi <firstName>, there is an issue affecting your account. Please reach out to us for assistance.',
  },
]

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (Array.isArray(saved) && saved.length) return saved
  } catch (e) {
    console.error('Could not read auto replies', e)
  }
  return DEFAULTS
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Could not save auto replies', e)
  }
}

// ---- Use these from your transaction code later ----
// Replaces <firstName>, <amount> etc. with real values:
//   fillTemplate(reply.message, { firstName: 'Faith', amount: 50 })
export function fillTemplate(text, data = {}) {
  return String(text || '').replace(/<(\w+)>/g, (m, k) => (data[k] !== undefined ? data[k] : m))
}

// Finds the enabled reply for an event (trigger ids are in TRIGGERS above):
//   findAutoReply('success', 50)
export function findAutoReply(trigger, amount) {
  const list = load().filter((r) => r.enabled && r.trigger === trigger)
  return (
    list.find((r) => r.amounts.includes(Number(amount))) ||
    list.find((r) => !r.amounts.length) ||
    null
  )
}

const triggerLabel = (id) => (TRIGGERS.find((t) => t.id === id) || {}).label || ''
const newId = () => 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`rp-switch ${on ? 'on' : ''}`}
      onClick={onChange}
    >
      <span className="rp-thumb" />
    </button>
  )
}

export default function AutoRepliesPage({ onBack }) {
  const [list, setList] = useState(load)
  const [screen, setScreen] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(null)
  const [showAmount, setShowAmount] = useState(false)
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const msgRef = useRef(null)

  function update(next) {
    setList(next)
    save(next)
  }

  function toggle(id) {
    update(list.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
  }

  function openCreate() {
    setEditingId(null)
    setForm({ title: '', trigger: 'failed', amounts: [], message: '', enabled: false })
    setShowAmount(false)
    setAmountInput('')
    setError('')
    setNotice('')
    setScreen('form')
  }

  function openEdit(r) {
    setEditingId(r.id)
    setForm({ title: r.title, trigger: r.trigger, amounts: [...r.amounts], message: r.message, enabled: r.enabled })
    setShowAmount(false)
    setAmountInput('')
    setError('')
    setNotice('')
    setScreen('form')
  }

  function addAmount() {
    const n = Number(amountInput)
    if (!(n > 0)) return setError('Enter an amount greater than 0')
    if (form.amounts.includes(n)) return setError('That amount is already added')
    setForm({ ...form, amounts: [...form.amounts, n].sort((a, b) => a - b) })
    setAmountInput('')
    setShowAmount(false)
    setError('')
  }

  function removeAmount(n) {
    setForm({ ...form, amounts: form.amounts.filter((a) => a !== n) })
  }

  function insertPlaceholder(tag) {
    const el = msgRef.current
    const text = form.message
    const start = el ? el.selectionStart : text.length
    const end = el ? el.selectionEnd : text.length
    const next = text.slice(0, start) + tag + text.slice(end)
    setForm({ ...form, message: next })
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  function submit() {
    if (!form.trigger) return setError('Choose what triggers this reply')
    if (!form.message.trim()) return setError('Write the reply message')
    const title = form.title.trim() || triggerLabel(form.trigger)
    const data = { ...form, title, message: form.message.trim() }

    if (editingId) {
      update(list.map((r) => (r.id === editingId ? { ...r, ...data } : r)))
      setNotice('AutoReply saved')
    } else {
      update([...list, { id: newId(), builtin: false, ...data }])
      setNotice('AutoReply created')
    }
    setScreen('list')
  }

  function remove() {
    if (!window.confirm('Delete this AutoReply? This cannot be undone.')) return
    update(list.filter((r) => r.id !== editingId))
    setNotice('AutoReply deleted')
    setScreen('list')
  }

  const editing = list.find((r) => r.id === editingId)
  const locked = Boolean(editing && editing.builtin)

  return (
    <div className="rp-page">
      <style>{`
        .rp-page {
          --rp-accent: var(--accent-color, #1F5EFF);
          --rp-card: var(--card-bg, #FFFFFF);
          --rp-border: var(--border-color, #D5DDF0);
          --rp-soft: var(--muted-text, #4A5568);
          --rp-hover: var(--muted-bg, #E6EDFF);
          --rp-on: var(--on-primary, #FFFFFF);
          --rp-bad: var(--danger, #D32F2F);
          width: 100%; box-sizing: border-box; padding: 4px 4px 100px; position: relative;
        }
        .rp-inner { max-width: 560px; margin: 0 auto; }
        .rp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
        .rp-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .rp-icon {
          width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; display: grid; place-items: center; flex-shrink: 0;
        }
        .rp-icon:hover { background: var(--rp-hover); }
        .rp-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .rp-icon:focus-visible, .rp-btn:focus-visible, .rp-chip:focus-visible, .rp-card-main:focus-visible,
        .rp-switch:focus-visible, .rp-fab:focus-visible, .rp-ph:focus-visible { outline: 2px solid var(--rp-accent); outline-offset: 3px; }
        .rp-note { margin: 0 0 14px; padding: 12px 14px; border-radius: 10px; background: var(--rp-hover); font-size: 14px; }
        .rp-list { display: grid; gap: 12px; }
        .rp-card {
          display: flex; align-items: center; gap: 12px; padding: 16px;
          border: 1px solid var(--rp-border); border-radius: 16px; background: var(--rp-card);
        }
        .rp-card-main {
          flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; color: inherit;
          font: inherit; cursor: pointer; padding: 0; border-radius: 8px;
        }
        .rp-card-main h3 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
        .rp-card-main p {
          margin: 0; color: var(--rp-soft); font-size: 14px; font-style: italic; line-height: 1.45;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .rp-meta { margin-top: 6px; color: var(--rp-soft); font-size: 12px; }
        .rp-switch {
          width: 52px; height: 30px; flex-shrink: 0; padding: 0; border-radius: 999px; cursor: pointer;
          border: 2px solid var(--rp-border); background: var(--rp-hover); position: relative;
          transition: background 160ms ease, border-color 160ms ease;
        }
        .rp-thumb {
          position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
          background: var(--rp-soft); transition: transform 160ms ease, background 160ms ease;
        }
        .rp-switch.on { background: var(--rp-accent); border-color: var(--rp-accent); }
        .rp-switch.on .rp-thumb { transform: translateX(22px); background: var(--rp-on); }
        @media (prefers-reduced-motion: reduce) { .rp-switch, .rp-thumb { transition: none; } }
        .rp-fab {
          position: fixed; right: 22px; bottom: 22px; z-index: 20; width: 62px; height: 62px;
          border: 0; border-radius: 20px; background: var(--rp-accent); color: var(--rp-on);
          font-size: 34px; line-height: 1; cursor: pointer; box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
        }
        .rp-fab:hover { filter: brightness(1.08); }
        .rp-panel {
          padding: 18px; border: 1px solid var(--rp-border); border-radius: 18px; background: var(--rp-card);
        }
        .rp-panel h2 { margin: 0 0 12px; font-size: 17px; }
        .rp-chips { display: flex; flex-wrap: wrap; gap: 10px; }
        .rp-chip {
          padding: 12px 16px; border: 2px solid var(--rp-border); border-radius: 12px; background: transparent;
          color: inherit; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .rp-chip.on { border-color: var(--rp-accent); background: var(--rp-accent); color: var(--rp-on); }
        .rp-chip:disabled { opacity: 0.55; cursor: not-allowed; }
        .rp-add {
          display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin-top: 16px;
          padding: 16px; border: 2px solid var(--rp-border); border-radius: 999px; background: transparent;
          color: var(--rp-accent); font: inherit; font-weight: 700; cursor: pointer;
        }
        .rp-amount-row { display: flex; gap: 8px; margin-top: 12px; }
        .rp-field, .rp-area {
          width: 100%; box-sizing: border-box; padding: 15px; border: 2px solid var(--rp-border);
          border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .rp-field:focus, .rp-area:focus { border-color: var(--rp-accent); }
        .rp-area { min-height: 140px; resize: vertical; }
        .rp-save {
          flex-shrink: 0; width: 54px; border: 0; border-radius: 12px; background: var(--rp-accent);
          color: var(--rp-on); cursor: pointer; display: grid; place-items: center;
        }
        .rp-save svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
        .rp-amounts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .rp-amount-tag {
          display: inline-flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-radius: 999px;
          background: var(--rp-hover); font-size: 14px; font-weight: 600;
        }
        .rp-amount-tag button {
          width: 26px; height: 26px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; font-size: 18px; line-height: 1;
        }
        .rp-trigger-line { margin: 14px 0 0; color: var(--rp-soft); font-size: 14px; font-style: italic; }
        .rp-active { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin: 20px 4px; font-weight: 700; }
        .rp-ph-title { margin: 24px 0 12px; font-size: 17px; font-weight: 700; }
        .rp-ph {
          display: block; width: 100%; padding: 8px 0; border: 0; background: transparent; color: inherit;
          font: inherit; font-size: 14px; text-align: left; cursor: pointer; border-radius: 6px;
        }
        .rp-ph strong { color: var(--rp-accent); }
        .rp-ph span { color: var(--rp-soft); font-style: italic; }
        .rp-hint { margin: 4px 0 16px; color: var(--rp-soft); font-size: 13px; }
        .rp-label { display: block; margin: 18px 0 8px; font-weight: 600; font-size: 14px; }
        .rp-err { color: var(--rp-bad); font-weight: 600; font-size: 14px; margin: 14px 0 0; }
        .rp-btn {
          display: block; width: 100%; margin-top: 20px; padding: 19px 0; border: 0; border-radius: 999px;
          background: var(--rp-accent); color: var(--rp-on); font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
        }
        .rp-btn:hover { filter: brightness(1.08); }
        .rp-btn.danger { background: transparent; color: var(--rp-bad); border: 2px solid var(--rp-bad); margin-top: 12px; }
      `}</style>

      <div className="rp-inner">
        {screen === 'list' && (
          <>
            <div className="rp-head">
              <button className="rp-icon" onClick={onBack} aria-label="Go back">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <h1>AutoReply Messages</h1>
            </div>

            {notice && <p className="rp-note" role="status">{notice}</p>}

            <div className="rp-list">
              {list.map((r) => (
                <article className="rp-card" key={r.id}>
                  <button className="rp-card-main" onClick={() => openEdit(r)} aria-label={`Edit ${r.title}`}>
                    <h3>{r.title}</h3>
                    <p>{r.message}</p>
                    {r.amounts.length > 0 && (
                      <div className="rp-meta">Amounts: KES {r.amounts.join(', ')}</div>
                    )}
                  </button>
                  <Switch
                    on={r.enabled}
                    onChange={() => toggle(r.id)}
                    label={`${r.enabled ? 'Disable' : 'Enable'} ${r.title}`}
                  />
                </article>
              ))}
            </div>

            <button className="rp-fab" onClick={openCreate} aria-label="Add AutoReply" title="Add AutoReply">+</button>
          </>
        )}

        {screen === 'form' && form && (
          <>
            <div className="rp-head">
              <button className="rp-icon" onClick={() => setScreen('list')} aria-label="Back to list">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <h1>{editingId ? 'Edit AutoReply' : 'Create AutoReply'}</h1>
            </div>

            <label className="rp-label" htmlFor="rp-name">Name (optional)</label>
            <input
              id="rp-name"
              className="rp-field"
              value={form.title}
              placeholder="e.g. Failed 50 bob request"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />

            <div className="rp-panel" style={{ marginTop: 18 }}>
              <h2>Trigger conditions</h2>
              <div className="rp-chips" role="radiogroup" aria-label="Trigger">
                {TRIGGERS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={form.trigger === t.id}
                    disabled={locked && form.trigger !== t.id}
                    className={`rp-chip ${form.trigger === t.id ? 'on' : ''}`}
                    onClick={() => setForm({ ...form, trigger: t.id })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <button type="button" className="rp-add" onClick={() => { setShowAmount(!showAmount); setError('') }}>
                <span aria-hidden="true">+</span> Add Amount
              </button>

              {showAmount && (
                <div className="rp-amount-row">
                  <input
                    className="rp-field"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="Amount (KES)"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addAmount()}
                    aria-label="Amount in KES"
                    autoFocus
                  />
                  <button type="button" className="rp-save" onClick={addAmount} aria-label="Save amount">
                    <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
                  </button>
                </div>
              )}

              {form.amounts.length > 0 && (
                <div className="rp-amounts">
                  {form.amounts.map((n) => (
                    <span className="rp-amount-tag" key={n}>
                      KES {n}
                      <button type="button" onClick={() => removeAmount(n)} aria-label={`Remove KES ${n}`}>×</button>
                    </span>
                  ))}
                </div>
              )}

              <p className="rp-trigger-line">
                Will trigger on: {triggerLabel(form.trigger)}
                {form.amounts.length ? ` for KES ${form.amounts.join(', ')}` : ' for any amount'}
              </p>
            </div>

            <div className="rp-active">
              <span>Activate</span>
              <Switch
                on={form.enabled}
                onChange={() => setForm({ ...form, enabled: !form.enabled })}
                label="Activate this AutoReply"
              />
            </div>

            <h2 className="rp-ph-title">PlaceHolders:</h2>
            <p className="rp-hint">Tap a placeholder to add it to your message.</p>
            {PLACEHOLDERS.map(([tag, desc]) => (
              <button key={tag} type="button" className="rp-ph" onClick={() => insertPlaceholder(tag)}>
                <strong>{tag}</strong> <span>- {desc}</span>
              </button>
            ))}

            <label className="rp-label" htmlFor="rp-msg">Reply Message</label>
            <textarea
              id="rp-msg"
              ref={msgRef}
              className="rp-area"
              placeholder="Reply Message"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />

            {error && <p className="rp-err" role="alert">{error}</p>}

            <button className="rp-btn" onClick={submit}>{editingId ? 'Save' : 'Create'}</button>
            {editingId && !locked && (
              <button className="rp-btn danger" onClick={remove}>Delete AutoReply</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}