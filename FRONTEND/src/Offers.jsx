import { useRef, useState } from 'react'
import { applyEdit, checkUssd, normalizeUssd } from './engine/offerRules.js'
import { learnSignature, ussdServiceEnabled, isNative } from './engine/native.js'
import { parseMenu } from './engine/signature.js'
import { loadConfig } from './engine/config.js'
const CATS = ['ALL', 'DATA', 'TUNUKIWA', 'MINUTES', 'SMS']
const PICK = ['DATA', 'MINUTES', 'SMS', 'TUNUKIWA'] // the four categories an offer can be added under
const DEFAULT_NOTIFY = 'Hi {name}, your {offer} has been sent. Thank you for buying!'

// The offer's category: the one picked, otherwise worked out from its name
const catOf = (o) => {
  if (PICK.includes(o.category)) return o.category
  const s = `${o.name || ''} ${o.category || ''}`.toLowerCase()
  if (/sms/.test(s)) return 'SMS'
  if (/minutes|mins?(\s|$)/.test(s)) return 'MINUTES'
  if (/tunukiwa/.test(s)) return 'TUNUKIWA'
  return 'DATA'
}
const isVerified = (o) => Boolean(o.smart || o.signature || (o.sigLearned && o.sigEnabled))
const isLocked = (o) => Boolean(o.smart || o.signature)
const t12 = (v) => {
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const defaultWindow = () => ({ on: false, from: '06:00', until: '22:00', altId: '', notify: false, msg: '' })
const blank = () => ({
  id: Date.now(), isNew: true, name: '', category: 'DATA', ussd: '', price: '', safPrice: '',
  payment: 'Till SIM', execSim: 'SIM 1', notifSim: 'SIM 2', type: 'Advanced',
  autoRetry: false, retryCount: 1, retryPending: false, retryFailed: true,
  autoReschedule: false, rescheduleTime: '06:00',
  notifyOn: false, notifyMsg: '',
  points: false, enabled: true, tw: defaultWindow(),
})

// The settings an Edit can change, in one clean shape (used to save and to see whether anything changed)
const toPatch = (s, lock) => {
  const p = {
    name: String(s.name || '').trim(),
    ussd: normalizeUssd(s.ussd),
    price: Number(s.price),
    safPrice: Number(s.safPrice) || 0,
    autoRetry: Boolean(s.autoRetry),
    retryCount: Math.min(10, Math.max(1, Number(s.retryCount) || 1)),
    retryPending: Boolean(s.retryPending),
    retryFailed: s.retryFailed !== false,
    autoReschedule: Boolean(s.autoReschedule),
    rescheduleTime: s.rescheduleTime || '06:00',
    notifyOn: Boolean(s.notifyOn),
    notifyMsg: String(s.notifyMsg || '').trim(),
  }
  if (!lock) p.category = catOf(s)
  return p
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    try {
      const t = document.createElement('textarea')
      t.value = text
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(t)
      return ok
    } catch (e2) {
      return false
    }
  }
}

function Switch({ on, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`of-switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  )
}

function Sheet({ title, onClose, children, footer }) {
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <h3>{title}</h3>
          {children}
        </div>
        <div className="sheet-bar">{footer}</div>
      </div>
    </div>
  )
}

export default function Offers({ offers = [], onSave = () => {}, onDelete = () => {} }) {
  const [cat, setCat] = useState('ALL')
  const [menu, setMenu] = useState(false)
  const [cardMenu, setCardMenu] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [note, setNote] = useState('')
  const fileRef = useRef(null)

  const shown = cat === 'ALL' ? offers : offers.filter((o) => catOf(o) === cat)
  const enabledCount = offers.filter((o) => o.enabled).length

  const flash = (m) => {
    setNote(m)
    setTimeout(() => setNote(''), 3000)
  }
  const save = (o) => {
    onSave(o)
    setSheet(null)
    flash('Saved')
  }
  const toggle = (o) => onSave({ ...o, enabled: !o.enabled })
  const remove = (o) => {
    setCardMenu(null)
    if (window.confirm(`Delete ${o.name}? This cannot be undone.`)) {
      onDelete(o.id)
      flash('Offer deleted')
    }
  }
  const copyUssd = async (o) => {
    setCardMenu(null)
    flash((await copyText(o.ussd)) ? 'USSD copied' : 'Could not copy the USSD')
  }

  function exportOffers() {
    const blob = new Blob([JSON.stringify(offers, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'autobingwa-offers.json'
    a.click()
    URL.revokeObjectURL(url)
    flash(`Exported ${offers.length} offers`)
  }

  function importOffers(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        const list = (Array.isArray(data) ? data : data.offers) || []
        const ok = list.filter((o) => o && o.name && !checkUssd(o.ussd))
        ok.forEach((o, i) => onSave({ ...o, id: o.id || Date.now() + i }))
        flash(`Imported ${ok.length} of ${list.length} offers`)
      } catch (err) {
        flash('That file could not be read')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="of">
      <div className="of-head">
        <h2>Offers</h2>
        <span className="of-count">{enabledCount}/{offers.length}</span>
        <div className="of-menuwrap">
          <button className="of-dots" aria-label="Import or export offers" onClick={() => setMenu(!menu)}>⋮</button>
          {menu && (
            <>
              <button className="of-scrim" aria-label="Close menu" onClick={() => setMenu(false)} />
              <div className="of-pop">
                <button onClick={() => { setMenu(false); fileRef.current && fileRef.current.click() }}>
                  <span>📥</span> Import offers
                </button>
                <button onClick={() => { setMenu(false); exportOffers() }}>
                  <span>📤</span> Export offers
                </button>
              </div>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importOffers} />
      </div>

      <div className="of-cats" role="tablist">
        {CATS.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            className={`of-cat ${cat === c ? 'on' : ''}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {note && <p className="of-note" role="status">{note}</p>}

      {shown.length === 0 && (
        <div className="empty">
          <b>No offers here</b><br />
          Download plans from Smart Data Plans or tap + to add one
        </div>
      )}

      {shown.map((o) => (
        <div key={o.id} className={`of-card ${o.enabled ? '' : 'off'}`}>
          <div className="of-top">
            <div className="of-title">
              <b>{o.name}</b>
              {isVerified(o) && <span className="tick" title="Verified">✔</span>}
            </div>
            <Switch on={o.enabled} onChange={() => toggle(o)} label={`Turn ${o.name} ${o.enabled ? 'off' : 'on'}`} />
          </div>

          <div className="of-mid">
            <span className="of-price">KES {o.price}</span>
            <code className="of-ussd">{o.ussd}</code>
          </div>

          <div className="of-bottom">
            <button
              className="of-win"
              aria-label="Time window"
              onClick={() => setSheet({ type: 'window', offer: o })}
            >
              <span>🕒</span>
              {o.tw && o.tw.on ? <small>{t12(o.tw.from)} to {t12(o.tw.until)}</small> : null}
            </button>

            <div className="of-menuwrap">
              <button
                className="of-dots"
                aria-label={`More actions for ${o.name}`}
                onClick={() => setCardMenu(cardMenu === o.id ? null : o.id)}
              >
                ⋮
              </button>
              {cardMenu === o.id && (
                <>
                  <button className="of-scrim" aria-label="Close menu" onClick={() => setCardMenu(null)} />
                  <div className="of-pop up">
                    <button onClick={() => { setCardMenu(null); setSheet({ type: 'edit', offer: o }) }}>
                      <span>✎</span> Edit
                    </button>
                    <button onClick={() => copyUssd(o)}>
                      <span>⧉</span> Copy USSD
                    </button>
                    <button onClick={() => { setCardMenu(null); setSheet({ type: 'signature', offer: o }) }}>
                      <span>✍</span> Signature
                    </button>
                    <button className="danger" onClick={() => remove(o)}>
                      <span>🗑</span> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      <button className="fab" aria-label="Add offer" onClick={() => setSheet({ type: 'edit', offer: blank() })}>+</button>

      {sheet && sheet.type === 'edit' && (
        <EditSheet start={sheet.offer} onClose={() => setSheet(null)} onSave={save} />
      )}
      {sheet && sheet.type === 'window' && (
        <WindowSheet start={sheet.offer} offers={offers} onClose={() => setSheet(null)} onSave={save} />
      )}
      {sheet && sheet.type === 'signature' && (
        <SignatureSheet start={sheet.offer} onClose={() => setSheet(null)} onSave={save} />
      )}
    </div>
  )
}

function EditSheet({ start, onClose, onSave }) {
  const [f, setF] = useState(() => ({
    ...start,
    category: catOf(start),
    notifyOn: Boolean(start.notifyOn),
    notifyMsg: start.notifyMsg || '',
  }))
  const [err, setErr] = useState('')
  const lock = isLocked(start)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  function turnNotify(on) {
    setF((p) => ({ ...p, notifyOn: on, notifyMsg: on && !p.notifyMsg ? DEFAULT_NOTIFY : p.notifyMsg }))
  }

  function save() {
    const patch = toPatch(f, lock)
    if (!patch.name) return setErr('Enter the offer name')
    const bad = checkUssd(patch.ussd)
    if (bad) return setErr(bad)
    if (!patch.price || patch.price <= 0) return setErr('Enter the amount')
    if (patch.notifyOn && !patch.notifyMsg) return setErr('Write the SMS message for the customer')
    const stamp = new Date().toLocaleString()

    if (start.isNew) {
      const { isNew, ...rest } = f
      return onSave({ ...rest, ...patch, updated: stamp })
    }
    // Nothing changed: just close, so the signature is not switched off for no reason
    if (JSON.stringify(patch) === JSON.stringify(toPatch(start, lock))) return onClose()
    // Smart offers keep their USSD and signature. A manual offer's signature is switched off, so it is learnt again.
    onSave({ ...applyEdit(start, patch), updated: stamp })
  }

  return (
    <Sheet
      title={start.isNew ? 'Add offer' : 'Edit offer'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save}>Save</button>
        </>
      }
    >
      {lock && <p className="of-hint">This is a verified Smart plan. Only the amount and the settings below can be changed.</p>}
      {!lock && !start.isNew && start.sigLearned && (
        <p className="of-hint">Saving a change switches this offer's signature off. You will need to learn it again.</p>
      )}

      <label className="field"><span>Offer name</span>
        <input value={f.name} disabled={lock} onChange={(e) => set('name', e.target.value)} placeholder="1GB 1HR" />
      </label>

      <label className="field"><span>Category</span>
        <select value={f.category} disabled={lock} onChange={(e) => set('category', e.target.value)}>
          {PICK.map((c) => (
            <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </label>

      <label className="field"><span>USSD code</span>
        <input value={f.ussd} disabled={lock} onChange={(e) => set('ussd', e.target.value)} placeholder="*180*5*2*AB*1*1#" />
        <small>Use AB where the customer phone number goes.</small>
      </label>

      <div className="two">
        <label className="field"><span>Amount (KES)</span>
          <input type="number" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
        </label>
        <label className="field"><span>Safaricom price (KES)</span>
          <input type="number" inputMode="decimal" value={f.safPrice} disabled={lock} onChange={(e) => set('safPrice', e.target.value)} />
        </label>
      </div>

      <div className="switch-row">
        <div><b>Auto retry</b><small>Try again if the purchase fails or is pending</small></div>
        <Switch on={Boolean(f.autoRetry)} onChange={(v) => set('autoRetry', v)} label="Auto retry" />
      </div>
      {f.autoRetry && (
        <>
          <div className="two">
            <label className="field"><span>Retry count</span>
              <input type="number" min="1" max="10" value={f.retryCount} onChange={(e) => set('retryCount', e.target.value)} />
            </label>
            <div className="checks">
              <label><input type="checkbox" checked={Boolean(f.retryPending)} onChange={(e) => set('retryPending', e.target.checked)} /> Retry pending</label>
              <label><input type="checkbox" checked={f.retryFailed !== false} onChange={(e) => set('retryFailed', e.target.checked)} /> Retry failed</label>
            </div>
          </div>
          {f.retryPending && (
            <p className="of-hint">
              Pending means the last step was sent but nothing confirmed it. Retrying it can buy the offer twice if the first try had already sold.
            </p>
          )}
        </>
      )}

      <div className="switch-row">
        <div><b>Auto reschedule to the next day</b><small>If a purchase fails, save it for tomorrow and try again then</small></div>
        <Switch on={Boolean(f.autoReschedule)} onChange={(v) => set('autoReschedule', v)} label="Auto reschedule next day" />
      </div>
      {f.autoReschedule && (
        <label className="field"><span>Time the next day</span>
          <input type="time" value={f.rescheduleTime || '06:00'} onChange={(e) => set('rescheduleTime', e.target.value)} />
        </label>
      )}

      <div className="switch-row">
        <div><b>Notify the customer</b><small>Send an SMS after this offer is bought</small></div>
        <Switch on={Boolean(f.notifyOn)} onChange={turnNotify} label="Notify the customer" />
      </div>
      {f.notifyOn && (
        <label className="field"><span>SMS message</span>
          <textarea className="of-area" rows="3" value={f.notifyMsg} onChange={(e) => set('notifyMsg', e.target.value)} />
          <small>You can use {'{name}'}, {'{offer}'}, {'{amount}'} and {'{phone}'}.</small>
        </label>
      )}

      {err && <p className="err">{err}</p>}
    </Sheet>
  )
}

function WindowSheet({ start, offers, onClose, onSave }) {
  const [w, setW] = useState({ ...defaultWindow(), ...(start.tw || {}) })
  const [err, setErr] = useState('')
  const set = (k, v) => setW((p) => ({ ...p, [k]: v }))
  const alternatives = offers.filter((x) => x.id !== start.id && x.enabled)

  function save() {
    if (w.on) {
      if (!w.from || !w.until) return setErr('Choose the start and end time')
      if (w.from === w.until) return setErr('The start and end time cannot be the same')
      if (!w.altId) return setErr('Choose an alternative offer for outside the window')
    }
    const alt = w.altId ? offers.find((x) => String(x.id) === String(w.altId)) : null
    onSave({ ...start, tw: { ...w, altId: alt ? alt.id : '' }, updated: new Date().toLocaleString() })
  }

  return (
    <Sheet
      title="Time window"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save}>Save</button>
        </>
      }
    >
      <p className="of-hint"><b>{start.name}</b> · KES {start.price}</p>

      <div className="switch-row">
        <div><b>Restrict to a time window</b><small>Only sell this offer between the hours below</small></div>
        <Switch on={w.on} onChange={(v) => set('on', v)} label="Restrict to a time window" />
      </div>

      {w.on && (
        <>
          <div className="two">
            <label className="field"><span>Available from</span>
              <input type="time" value={w.from} onChange={(e) => set('from', e.target.value)} />
            </label>
            <label className="field"><span>Available until</span>
              <input type="time" value={w.until} onChange={(e) => set('until', e.target.value)} />
            </label>
          </div>

          <label className="field"><span>Alternative offer outside this window (required)</span>
            <select value={w.altId} onChange={(e) => set('altId', e.target.value)}>
              <option value="">Choose an offer</option>
              {alternatives.map((x) => (
                <option key={x.id} value={x.id}>{x.name} · KES {x.price}</option>
              ))}
            </select>
            {alternatives.length === 0 && <small>Add or enable another offer first.</small>}
          </label>

          <div className="switch-row">
            <div><b>Notify the customer</b><small>Send an SMS when the alternative offer is used</small></div>
            <Switch on={w.notify} onChange={(v) => set('notify', v)} label="Notify the customer" />
          </div>
          {w.notify && (
            <label className="field"><span>SMS message</span>
              <textarea
                className="of-area"
                rows="3"
                value={w.msg}
                onChange={(e) => set('msg', e.target.value)}
                placeholder="This offer is not available now, so we sent you an alternative."
              />
            </label>
          )}
        </>
      )}

      {err && <p className="err">{err}</p>}
    </Sheet>
  )
}

function SignatureSheet({ start, onClose, onSave }) {
  const smart = Boolean(start.smart)
  const saved = start.sig && start.sig.steps ? start.sig : null
  const locked = smart && Boolean(saved) // a built-in signature cannot be changed
  const [learned, setLearned] = useState(null) // { signature, screens } from this session
  const [enable, setEnable] = useState(smart ? true : Boolean(start.sigEnabled))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const sig = learned ? learned.signature : saved

  async function learn() {
    setErr('')
    setMsg('')
    const bad = checkUssd(start.ussd)
    if (bad) return setErr(bad)
    if (!isNative()) return setErr('Learning only works in the Android app, on a phone with a SIM.')
    setBusy(true)
    try {
      if (!(await ussdServiceEnabled())) throw new Error('Turn on the AutoBingwa accessibility service first.')
      const slot = loadConfig().bingwaSim === 'SIM 1' ? 0 : 1
      const res = await learnSignature({ ussd: start.ussd, slot })
      setLearned(res)
      setEnable(res.signature.complete)
    } catch (e) {
      setErr(String(e && e.message ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const canSave = !locked && !busy && (
    (learned && learned.signature.complete) ||
    (!learned && saved && saved.complete && enable !== Boolean(start.sigEnabled))
  )

  function save() {
    onSave({
      ...start,
      sig,
      sigLearned: true,
      sigEnabled: smart ? true : enable,
      updated: new Date().toLocaleString(),
    })
  }

  async function copySig() {
    const ok = await copyText(JSON.stringify(sig))
    setMsg(ok ? 'Signature copied. Paste it as sig: on this plan in smartCatalog.js.' : 'Could not copy the signature.')
  }

  const rows = sig
    ? sig.steps.map((s, i) => {
        if (s.kind === 'input') return { ok: true, text: "Types the customer's phone number" }
        if (s.kind === 'literal') {
          return s.unmatched
            ? { ok: false, text: `Option ${s.value} was not found on the screen` }
            : { ok: true, text: `Types ${s.value}` }
        }
        const raw = learned ? (parseMenu(learned.screens[i]).find((o) => o.n === s.hint) || {}).text : ''
        return { ok: true, text: `Picks "${raw || s.label}" (option ${s.hint} today)` }
      })
    : []

  return (
    <Sheet
      title="Signature"
      onClose={busy ? () => {} : onClose}
      footer={
        locked ? (
          <button className="btn" onClick={onClose}>Close</button>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={!canSave}>Save signature</button>
          </>
        )
      }
    >
      <p className="of-hint">
        The signature remembers what each step of this offer should contain, so it still buys the right plan if Safaricom reorders the menu.
      </p>
      <p className="of-hint"><b>{start.name}</b> · <code>{start.ussd}</code></p>

      {locked ? (
        <p className="of-hint"><span className="tick">✔</span> This is a verified Smart plan. Its signature is built in and locked.</p>
      ) : (
        <>
          {smart && !saved && (
            <p className="of-hint">
              This plan has no saved signature yet. Learn it once here. Then copy it into the catalog so every user gets it.
            </p>
          )}
          <div className="switch-row">
            <div>
              <b>Enable signature</b>
              <small>{sig && sig.complete ? 'Turn on to use the saved steps' : 'Learn the steps first, then enable'}</small>
            </div>
            <Switch on={enable} onChange={setEnable} label="Enable signature" disabled={busy || !sig || !sig.complete} />
          </div>
          <button className="btn ghost of-learn" onClick={learn} disabled={busy}>
            {busy ? 'Learning…' : sig ? 'Learn again' : 'Learn signature'}
          </button>
          <p className="of-hint">
            {busy
              ? 'Dialing the steps with the test number 0700000000. This can take up to 90 seconds. Keep the phone unlocked.'
              : 'Learning dials every step with the test number 0700000000 and stops before the last step, so nothing is bought. Stop automation first so a customer payment does not wait behind it.'}
          </p>
        </>
      )}

      {sig && (
        <>
          <b>{learned ? 'Steps found' : 'Saved steps'}</b>
          <ol className="of-steps">
            {rows.map((r, i) => <li key={i}>{r.ok ? '' : '⚠ '}{r.text}</li>)}
          </ol>
          {learned && sig.complete && (
            <p className="of-hint">The last step is the purchase. It was not sent.</p>
          )}
          {learned && !sig.complete && (
            <p className="of-hint">
              Some steps could not be matched, so this signature cannot be saved. Check the USSD code, then learn again.
            </p>
          )}
        </>
      )}

      {learned && (
        <details>
          <summary>What the phone showed at each step</summary>
          {learned.screens.map((s, i) => (
            <pre key={i} style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '6px 0' }}>{`Step ${i + 1}\n${s}`}</pre>
          ))}
        </details>
      )}

      {smart && sig && (
        <button className="btn ghost of-learn" onClick={copySig}>Copy signature</button>
      )}

      {msg && <p className="of-hint">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </Sheet>
  )
}