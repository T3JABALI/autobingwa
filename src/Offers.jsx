import { useRef, useState } from 'react'

const CATS = ['ALL', 'DATA', 'TUNUKIWA', 'MINUTES', 'SMS']
const AB_OK = /\*AB(?=[*#])/

// Sorts every offer into a category from its name
const autoCat = (o) => {
  const s = `${o.name || ''} ${o.category || ''}`.toLowerCase()
  if (/sms/.test(s)) return 'SMS'
  if (/minutes|mins?(\s|$)/.test(s)) return 'MINUTES'
  if (/tunukiwa/.test(s)) return 'TUNUKIWA'
  return 'DATA'
}
const isVerified = (o) => Boolean(o.smart || o.signature || (o.sigLearned && o.sigEnabled))
const isLocked = (o) => Boolean(o.smart || o.signature)
const normUssd = (u) => String(u || '').trim().replace(/\*ab(?=[*#])/gi, '*AB')
const t12 = (v) => {
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const defaultWindow = () => ({ on: false, from: '06:00', until: '22:00', altId: '', notify: false, msg: '' })
const blank = () => ({
  id: Date.now(), isNew: true, name: '', ussd: '', price: '', safPrice: '',
  payment: 'Till SIM', execSim: 'SIM 1', notifSim: 'SIM 2', type: 'Advanced',
  autoRetry: false, retryCount: 1, retryPending: false, retryFailed: true,
  autoReschedule: false, rescheduleTime: '06:00',
  points: false, enabled: true, tw: defaultWindow(),
})

function stepsFrom(ussd) {
  const parts = String(ussd).replace(/^\*/, '').replace(/#$/, '').split('*')
  const out = [`Dial *${parts[0]}#`]
  parts.slice(1).forEach((p) => out.push(p === 'AB' ? 'Enter the phone number 0700000000' : `Reply ${p}`))
  return out
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

  const shown = cat === 'ALL' ? offers : offers.filter((o) => autoCat(o) === cat)
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
        const ok = list.filter((o) => o && o.name && AB_OK.test(o.ussd || ''))
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
  const [f, setF] = useState({ ...start })
  const [err, setErr] = useState('')
  const lock = isLocked(start)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  function save() {
    const ussd = normUssd(f.ussd)
    const price = Number(f.price)
    if (!String(f.name || '').trim()) return setErr('Enter the offer name')
    if (!AB_OK.test(ussd)) return setErr('The USSD code must use AB where the phone number goes')
    if (!price || price <= 0) return setErr('Enter the amount')
    const { isNew, ...rest } = f
    const changedUssd = start.sigLearned && ussd !== start.ussd
    onSave({
      ...rest,
      name: String(f.name).trim(),
      ussd,
      price,
      safPrice: Number(f.safPrice) || 0,
      retryCount: Number(f.retryCount) || 1,
      sigLearned: changedUssd ? false : f.sigLearned,
      sigEnabled: changedUssd ? false : f.sigEnabled,
      updated: new Date().toLocaleString(),
    })
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

      <label className="field"><span>Offer name</span>
        <input value={f.name} disabled={lock} onChange={(e) => set('name', e.target.value)} placeholder="1GB 1HR" />
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
        <div className="two">
          <label className="field"><span>Retry count</span>
            <input type="number" min="1" max="10" value={f.retryCount} onChange={(e) => set('retryCount', e.target.value)} />
          </label>
          <div className="checks">
            <label><input type="checkbox" checked={Boolean(f.retryPending)} onChange={(e) => set('retryPending', e.target.checked)} /> Retry pending</label>
            <label><input type="checkbox" checked={Boolean(f.retryFailed)} onChange={(e) => set('retryFailed', e.target.checked)} /> Retry failed</label>
          </div>
        </div>
      )}

      <div className="switch-row">
        <div><b>Auto reschedule to the next day</b><small>If it still fails, the customer gets a time they can pick</small></div>
        <Switch on={Boolean(f.autoReschedule)} onChange={(v) => set('autoReschedule', v)} label="Auto reschedule next day" />
      </div>
      {f.autoReschedule && (
        <label className="field"><span>Default time the next day</span>
          <input type="time" value={f.rescheduleTime || '06:00'} onChange={(e) => set('rescheduleTime', e.target.value)} />
          <small>The customer can choose a different time.</small>
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
    onSave({ ...start, tw: { ...w, altId: w.altId ? Number(w.altId) : '' }, updated: new Date().toLocaleString() })
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
  const builtIn = isLocked(start)
  const [steps, setSteps] = useState(start.sigSteps || null)
  const [enable, setEnable] = useState(Boolean(start.sigEnabled))
  const [err, setErr] = useState('')

  function learn() {
    if (!AB_OK.test(start.ussd || '')) return setErr('Edit the offer first. Its USSD code must use AB.')
    setErr('')
    setSteps(stepsFrom(start.ussd))
  }

  function save() {
    onSave({ ...start, sigSteps: steps, sigLearned: true, sigEnabled: enable, updated: new Date().toLocaleString() })
  }

  const list = builtIn ? stepsFrom(start.ussd) : steps

  return (
    <Sheet
      title="Signature"
      onClose={onClose}
      footer={
        builtIn ? (
          <button className="btn" onClick={onClose}>Close</button>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={save} disabled={!steps}>Save signature</button>
          </>
        )
      }
    >
      <p className="of-hint">
        The signature remembers the menu steps of this offer, so it still works if Safaricom reorders the menu.
      </p>
      <p className="of-hint"><b>{start.name}</b> · <code>{start.ussd}</code></p>

      {builtIn ? (
        <p className="of-hint"><span className="tick">✔</span> This is a verified Smart plan. Its signature is built in and locked.</p>
      ) : (
        <>
          <div className="switch-row">
            <div><b>Enable signature</b><small>{steps ? 'Turn on to use the saved steps' : 'Learn the steps first, then enable'}</small></div>
            <Switch on={enable} onChange={setEnable} label="Enable signature" disabled={!steps} />
          </div>
          <button className="btn ghost of-learn" onClick={learn}>
            {steps ? 'Learn again' : 'Learn signature'}
          </button>
          <p className="of-hint">
            Learning runs this offer once with the test number 0700000000 and lists the steps it found.
            In this preview the steps come from the USSD code. The real run happens in the Android app.
          </p>
        </>
      )}

      {list && (
        <>
          <b>Steps found</b>
          <ol className="of-steps">
            {list.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </>
      )}

      {err && <p className="err">{err}</p>}
    </Sheet>
  )
}