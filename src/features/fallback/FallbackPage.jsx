import { useState } from 'react'

const KEY = 'fallback:config'
const MAX_DELAY = 30

const TRIGGERS = [
  {
    id: 'recommended',
    label: 'Already recommended',
    help: 'Runs as soon as the USSD reply says this number already received the offer.',
  },
  {
    id: 'failed',
    label: 'Purchase failed',
    help: 'Runs only after the primary plan has used up all its auto-retries.',
  },
]

const EMPTY = { active: true, delay: 0, mappings: [] }

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved && Array.isArray(saved.mappings)) return { ...EMPTY, ...saved }
  } catch (e) {
    console.error('Could not read fallback plans', e)
  }
  return EMPTY
}

function save(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config))
  } catch (e) {
    console.error('Could not save fallback plans', e)
  }
}

// For your transaction code later:
//   findFallback(primaryOfferId, 'failed')  ->  mapping or null
export function findFallback(primaryId, trigger) {
  const config = load()
  if (!config.active) return null
  return (
    config.mappings.find(
      (m) => String(m.primaryId) === String(primaryId) && m.trigger === trigger
    ) || null
  )
}

const newId = () => 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const triggerLabel = (id) => (TRIGGERS.find((t) => t.id === id) || {}).label || ''

export default function FallbackPage({ offers = [], onBack }) {
  const [config, setConfig] = useState(load)
  const [helpOpen, setHelpOpen] = useState(false)
  const [modal, setModal] = useState(null) // null | { id: string|null }
  const [form, setForm] = useState({ trigger: 'recommended', primaryId: '', fallbackId: '', notify: false })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function update(next) {
    setConfig(next)
    save(next)
  }

  const nameOf = (id, stored) => {
    const found = offers.find((o) => String(o.id) === String(id))
    return found ? found.name : stored
  }

  // Each offer may be a primary only once.
  const editingId = modal ? modal.id : null
  const takenPrimaries = config.mappings
    .filter((m) => m.id !== editingId)
    .map((m) => String(m.primaryId))
  const primaryOptions = offers.filter((o) => !takenPrimaries.includes(String(o.id)))
  const fallbackOptions = offers.filter((o) => String(o.id) !== String(form.primaryId))

  function openAdd() {
    setForm({ trigger: 'recommended', primaryId: '', fallbackId: '', notify: false })
    setError('')
    setNotice('')
    setModal({ id: null })
  }

  function openEdit(m) {
    setForm({
      trigger: m.trigger,
      primaryId: String(m.primaryId),
      fallbackId: String(m.fallbackId),
      notify: m.notify,
    })
    setError('')
    setNotice('')
    setModal({ id: m.id })
  }

  function submit() {
    if (!form.primaryId) return setError('Choose the primary plan')
    if (!form.fallbackId) return setError('Choose the fallback plan to recommend')
    if (form.primaryId === form.fallbackId) return setError('The fallback must be a different plan')
    if (takenPrimaries.includes(String(form.primaryId)))
      return setError('That plan already has a fallback. Each plan can be primary only once.')

    const primary = offers.find((o) => String(o.id) === String(form.primaryId))
    const fallback = offers.find((o) => String(o.id) === String(form.fallbackId))
    if (!primary || !fallback) return setError('Choose plans from the list')

    const entry = {
      id: editingId || newId(),
      primaryId: primary.id,
      primaryName: primary.name,
      fallbackId: fallback.id,
      fallbackName: fallback.name,
      trigger: form.trigger,
      notify: form.notify,
    }

    update({
      ...config,
      mappings: editingId
        ? config.mappings.map((m) => (m.id === editingId ? entry : m))
        : [...config.mappings, entry],
    })
    setNotice(editingId ? 'Mapping updated' : 'Mapping added')
    setModal(null)
  }

  function removeOne(m) {
    if (!window.confirm('Remove this mapping?')) return
    update({ ...config, mappings: config.mappings.filter((x) => x.id !== m.id) })
    setNotice('Mapping removed')
  }

  function clearAll() {
    if (!config.mappings.length) return setNotice('There are no mappings to delete')
    if (!window.confirm(`Delete all ${config.mappings.length} fallback mappings? This cannot be undone.`)) return
    update({ ...config, mappings: [] })
    setNotice('All mappings deleted')
  }

  const delay = Number(config.delay) || 0

  return (
    <div className="fb-page">
      <style>{`
        .fb-page {
          --fb-accent: var(--accent-color, #1F5EFF);
          --fb-card: var(--card-bg, #FFFFFF);
          --fb-border: var(--border-color, #D5DDF0);
          --fb-soft: var(--muted-text, #4A5568);
          --fb-hover: var(--muted-bg, #E6EDFF);
          --fb-on: var(--on-primary, #FFFFFF);
          --fb-ok: var(--success, #0A7D4B);
          --fb-bad: var(--danger, #D32F2F);
          width: 100%; box-sizing: border-box; padding: 4px 4px 24px;
        }
        .fb-inner { max-width: 600px; margin: 0 auto; }
        .fb-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
        .fb-head-left { display: flex; align-items: center; gap: 6px; }
        .fb-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .fb-icon {
          width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; display: grid; place-items: center; flex-shrink: 0;
        }
        .fb-icon:hover { background: var(--fb-hover); }
        .fb-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .fb-text-btn {
          border: 0; background: transparent; color: var(--fb-bad); font: inherit; font-size: 16px;
          font-weight: 700; cursor: pointer; padding: 10px 6px; border-radius: 8px;
        }
        .fb-icon:focus-visible, .fb-text-btn:focus-visible, .fb-chip:focus-visible, .fb-seg button:focus-visible,
        .fb-btn:focus-visible, .fb-fab:focus-visible, .fb-map:focus-visible, .fb-switch:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 3px; }
        .fb-lead { margin: 0 0 8px; font-size: 17px; font-weight: 700; }
        .fb-desc { margin: 0; color: var(--fb-soft); font-size: 14px; line-height: 1.65; }
        .fb-status { display: flex; align-items: center; gap: 12px; margin: 18px 0; }
        .fb-chip {
          display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border: 0; border-radius: 999px;
          font: inherit; font-weight: 700; cursor: pointer; flex-shrink: 0;
          background: var(--fb-ok); color: #fff;
        }
        .fb-chip.off { background: var(--fb-hover); color: var(--fb-soft); }
        .fb-status p { flex: 1; margin: 0; color: var(--fb-soft); font-size: 14px; }
        .fb-help {
          margin: 0 0 16px; padding: 16px; border-radius: 14px; background: var(--fb-hover);
          font-size: 14px; line-height: 1.65;
        }
        .fb-help h3 { margin: 0 0 8px; font-size: 16px; }
        .fb-help p { margin: 0 0 8px; }
        .fb-help p:last-child { margin: 0; }
        .fb-card { padding: 18px; border: 1px solid var(--fb-border); border-radius: 18px; background: var(--fb-card); margin-bottom: 14px; }
        .fb-card h2 { margin: 0 0 6px; font-size: 18px; }
        .fb-card .fb-sub { margin: 0; color: var(--fb-soft); font-size: 14px; }
        .fb-range { width: 100%; margin: 20px 0 6px; accent-color: var(--fb-accent); height: 28px; }
        .fb-range-label { text-align: right; font-weight: 700; }
        .fb-note { margin: 0 0 14px; padding: 12px 14px; border-radius: 10px; background: var(--fb-hover); font-size: 14px; }
        .fb-list { display: grid; gap: 10px; margin-top: 14px; }
        .fb-map {
          display: flex; align-items: center; gap: 10px; padding: 16px; border: 1px solid var(--fb-border);
          border-radius: 14px; background: transparent;
        }
        .fb-map-main {
          flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; color: inherit;
          font: inherit; cursor: pointer; padding: 0; border-radius: 8px;
        }
        .fb-map-main strong { display: block; font-size: 15px; overflow-wrap: anywhere; }
        .fb-map-main span { display: block; margin-top: 6px; color: var(--fb-soft); font-size: 13px; }
        .fb-empty { color: var(--fb-soft); text-align: center; padding: 18px 8px 8px; font-size: 14px; }
        .fb-fab-wrap { position: sticky; bottom: 18px; display: flex; justify-content: flex-start; margin-top: 18px; pointer-events: none; }
        .fb-fab {
          pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; padding: 17px 24px; border: 0;
          border-radius: 18px; background: var(--fb-accent); color: var(--fb-on); font: inherit; font-size: 16px;
          font-weight: 700; cursor: pointer; box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
        }
        .fb-fab:hover { filter: brightness(1.08); }
        .fb-fab span { font-size: 24px; line-height: 1; }
        .fb-modal-bg {
          position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / 55%);
          display: grid; place-items: center; padding: 16px; overflow-y: auto;
        }
        .fb-modal { width: 100%; max-width: 460px; padding: 22px; border-radius: 20px; background: var(--fb-card); border: 1px solid var(--fb-border); }
        .fb-modal h2 { margin: 0 0 16px; font-size: 20px; }
        .fb-seg { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--fb-border); border-radius: 12px; overflow: hidden; }
        .fb-seg button {
          padding: 14px 8px; border: 0; background: transparent; color: inherit; font: inherit;
          font-weight: 600; font-size: 14px; cursor: pointer;
        }
        .fb-seg button.on { background: var(--fb-accent); color: var(--fb-on); }
        .fb-hint { margin: 10px 0 0; color: var(--fb-soft); font-size: 14px; }
        .fb-select-wrap { position: relative; margin-top: 14px; }
        .fb-select {
          width: 100%; box-sizing: border-box; appearance: none; -webkit-appearance: none; padding: 18px 44px 18px 16px;
          border: 2px solid var(--fb-border); border-radius: 12px; background: transparent; color: inherit;
          font: inherit; font-size: 16px; outline: none; cursor: pointer;
        }
        .fb-select:focus { border-color: var(--fb-accent); }
        .fb-select option { background: var(--fb-card); color: var(--fb-text, inherit); }
        .fb-caret {
          position: absolute; right: 18px; top: 50%; transform: translateY(-50%); width: 0; height: 0; pointer-events: none;
          border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 8px solid currentColor;
        }
        .fb-switch-row { display: flex; align-items: center; justify-content: space-between; margin: 22px 4px 4px; font-weight: 700; }
        .fb-switch {
          width: 54px; height: 30px; padding: 0; border-radius: 999px; cursor: pointer; position: relative;
          border: 2px solid var(--fb-border); background: var(--fb-hover); transition: background 160ms ease;
        }
        .fb-thumb {
          position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
          background: var(--fb-soft); transition: transform 160ms ease;
        }
        .fb-switch.on { background: var(--fb-accent); border-color: var(--fb-accent); }
        .fb-switch.on .fb-thumb { transform: translateX(24px); background: var(--fb-on); }
        @media (prefers-reduced-motion: reduce) { .fb-switch, .fb-thumb { transition: none; } }
        .fb-err { color: var(--fb-bad); font-weight: 600; font-size: 14px; margin: 14px 0 0; }
        .fb-row { display: flex; gap: 10px; margin-top: 20px; }
        .fb-btn {
          flex: 1; padding: 17px 0; border: 0; border-radius: 999px; background: var(--fb-accent);
          color: var(--fb-on); font: inherit; font-size: 16px; font-weight: 700; cursor: pointer;
        }
        .fb-btn.ghost { background: transparent; color: inherit; border: 2px solid var(--fb-border); }
      `}</style>

      <div className="fb-inner">
        <div className="fb-head">
          <div className="fb-head-left">
            <button className="fb-icon" onClick={onBack} aria-label="Go back">
              <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <h1>Fallback Plans</h1>
          </div>
          <button className="fb-text-btn" onClick={clearAll}>Delete all</button>
        </div>

        <p className="fb-lead">Set up an automatic backup offer.</p>
        <p className="fb-desc">
          Pair a main plan with one alternative that gets recommended in its place. "Already recommended" fires the
          moment Safaricom replies that the number already received this offer. "Purchase failed" fires only once the
          main plan has used up its auto-retries (timeouts keep retrying the same plan). You can add a waiting time so
          a verification SMS has a chance to cancel the backup. Backups that follow one another show as (FB) in
          history, with a note saying where they came from.
        </p>

        <div className="fb-status">
          <button
            className={`fb-chip ${config.active ? '' : 'off'}`}
            onClick={() => update({ ...config, active: !config.active })}
            aria-pressed={config.active}
          >
            <span aria-hidden="true">{config.active ? '✓' : '⏸'}</span>
            {config.active ? 'Active' : 'Paused'}
          </button>
          <p>{config.active ? 'The backup runs whenever the conditions match.' : 'Paused. No backup will run.'}</p>
          <button className="fb-icon" onClick={() => setHelpOpen(!helpOpen)} aria-label="What is a fallback?" aria-expanded={helpOpen}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01" /></svg>
          </button>
        </div>

        {helpOpen && (
          <div className="fb-help">
            <h3>What is a fallback?</h3>
            <p>
              A fallback is a plan B. When a customer's main offer cannot be given, the system automatically offers a
              different plan instead, so the sale is not lost.
            </p>
            <p><strong>Already recommended:</strong> the customer already received the main offer, so a different plan is sent right away.</p>
            <p><strong>Purchase failed:</strong> the main offer failed even after retrying, so the backup plan is tried.</p>
            <p>Each plan can be a primary only once, but the same plan can be the backup for many primaries.</p>
          </div>
        )}

        <div className="fb-card">
          <h2>Wait before fallback</h2>
          <p className="fb-sub">
            {delay === 0
              ? 'The backup goes out straight away, so a late verification SMS cannot cancel it.'
              : `The original job waits ${delay} min. If a verification SMS arrives in that time, the backup is cancelled.`}
          </p>
          <input
            className="fb-range"
            type="range"
            min="0"
            max={MAX_DELAY}
            step="1"
            value={delay}
            onChange={(e) => update({ ...config, delay: Number(e.target.value) })}
            aria-label="Minutes to wait before fallback"
          />
          <div className="fb-range-label">{delay === 0 ? 'Instant' : `${delay} min`}</div>
        </div>

        {notice && <p className="fb-note" role="status">{notice}</p>}

        <div className="fb-card">
          <h2>Mappings</h2>
          {config.mappings.length === 0 ? (
            <p className="fb-empty">No mappings yet. Press Map to add your first fallback.</p>
          ) : (
            <div className="fb-list">
              {config.mappings.map((m) => (
                <div className="fb-map" key={m.id}>
                  <button className="fb-map-main" onClick={() => openEdit(m)} aria-label="Edit mapping">
                    <strong>{nameOf(m.primaryId, m.primaryName)} → {nameOf(m.fallbackId, m.fallbackName)}</strong>
                    <span>Trigger: {triggerLabel(m.trigger)}{m.notify ? ' · Client notified' : ''}</span>
                  </button>
                  <button className="fb-icon" onClick={() => removeOne(m)} aria-label="Remove mapping" title="Remove">
                    <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fb-fab-wrap">
          <button className="fb-fab" onClick={openAdd}>
            <span aria-hidden="true">+</span> Map
          </button>
        </div>
      </div>

      {modal && (
        <div className="fb-modal-bg" onClick={() => setModal(null)}>
          <div className="fb-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit fallback plan' : 'Map fallback plan'}</h2>

            <div className="fb-seg" role="radiogroup" aria-label="Trigger">
              {TRIGGERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={form.trigger === t.id}
                  className={form.trigger === t.id ? 'on' : ''}
                  onClick={() => setForm({ ...form, trigger: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="fb-hint">{TRIGGERS.find((t) => t.id === form.trigger).help}</p>

            <div className="fb-select-wrap">
              <select
                className="fb-select"
                value={form.primaryId}
                onChange={(e) => {
                  const primaryId = e.target.value
                  setForm({ ...form, primaryId, fallbackId: form.fallbackId === primaryId ? '' : form.fallbackId })
                }}
                aria-label="Primary plan"
              >
                <option value="">Primary plan</option>
                {primaryOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <span className="fb-caret" />
            </div>
            {primaryOptions.length === 0 && (
              <p className="fb-hint">Every plan already has a fallback. Remove a mapping to free one up.</p>
            )}

            <div className="fb-select-wrap">
              <select
                className="fb-select"
                value={form.fallbackId}
                onChange={(e) => setForm({ ...form, fallbackId: e.target.value })}
                aria-label="Fallback plan to recommend"
              >
                <option value="">Fallback plan to recommend</option>
                {fallbackOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <span className="fb-caret" />
            </div>

            <div className="fb-switch-row">
              <span>Notify client</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.notify}
                aria-label="Notify client"
                className={`fb-switch ${form.notify ? 'on' : ''}`}
                onClick={() => setForm({ ...form, notify: !form.notify })}
              >
                <span className="fb-thumb" />
              </button>
            </div>

            {error && <p className="fb-err" role="alert">{error}</p>}

            <div className="fb-row">
              <button className="fb-btn ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="fb-btn" onClick={submit}>{editingId ? 'Save mapping' : 'Add mapping'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}