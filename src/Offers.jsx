import { useState } from 'react'

const blank = { category: '', name: '', ussd: '', price: '', safPrice: '', payment: 'Till SIM', execSim: 'SIM 1', notifSim: 'SIM 2', type: 'Advanced', autoRetry: false, retryCount: 1, retryPending: false, retryFailed: true, points: false, enabled: true }

function Offers({ offers = [], onSave = () => {}, onShare }) {
  const [filter, setFilter] = useState('All')
  const [editing, setEditing] = useState(null)
  const cats = ['All', ...new Set(offers.map(o => o.category))]
  const shown = filter === 'All' ? offers : offers.filter(o => o.category === filter)

  return (
    <div className="offers">
      <div className="offers-head">
        <h2>Offers</h2>
        <button className="icon-btn" onClick={() => setEditing({ ...blank })}>+</button>
      </div>

      <div className="chips">
        {cats.map(c => (
          <button key={c} className={`chip ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      {shown.length === 0 && <div className="empty"><b>No offers yet</b><br />Tap + to add your first offer</div>}

      {shown.map(o => {
        const margin = (o.price || 0) - (o.safPrice || 0)
        return (
          <div key={o.id} className="offer-card">
            <div className="offer-top">
              <div>
<b>{o.name}{o.signature && <span className="tick"> ✔</span>}</b>
                <small>{o.category}</small>
              </div>
              <button className="icon-btn" onClick={() => setEditing({ ...o })}>⋮</button>
            </div>
            <div className="pills">
              <span className={`pill ${o.enabled ? 'ok' : 'off'}`}>{o.enabled ? 'Enabled' : 'Disabled'}</span>
              <span className="pill">Points: {o.points ? 'On' : 'Off'}</span>
              <span className={`pill ${margin >= 0 ? 'ok' : 'bad'}`}>{margin >= 0 ? '+' : ''}KES {margin}</span>
            </div>
            <div className="offer-grid">
              <div><small>USSD</small><span>{o.ussd}</span></div>
              <div><small>Payment mode</small><span>{o.payment}</span></div>
              <div><small>Selling price</small><span>KES {o.price}</span></div>
              <div><small>Safaricom price</small><span>KES {o.safPrice}</span></div>
              <div><small>Execute SIM</small><span>{o.execSim}</span></div>
              <div><small>Notification SIM</small><span>{o.notifSim}</span></div>
              <div><small>Auto retry</small><span>{o.autoRetry ? `On · ${o.retryCount}x` : 'Off'}</span></div>
              <div><small>Type</small><span>{o.type}</span></div>
            </div>
            {o.updated && <small className="updated">Last updated: {o.updated}</small>}
          </div>
        )
      })}

      {onShare && <button className="fab" onClick={onShare}>Share plans</button>}
      {editing && <OfferForm start={editing} onClose={() => setEditing(null)} onSave={o => { onSave(o); setEditing(null) }} />}
    </div>
  )
}

function OfferForm({ start, onClose, onSave }) {
  const [f, setF] = useState(start)
  const [err, setErr] = useState('')
  const lock = !!start.signature

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const save = () => {
    if (!f.name.trim()) return setErr('Enter a plan name')
    if (!f.ussd.includes('pn')) return setErr('USSD must contain "pn" for the customer number')
    onSave({ ...f, price: Number(f.price) || 0, safPrice: Number(f.safPrice) || 0, retryCount: Number(f.retryCount) || 1 })
  }

  const Select = ({ label, k, options }) => (
    <label className="field"><span>{label}</span>
      <select value={f[k]} onChange={e => set(k, e.target.value)}>{options.map(x => <option key={x}>{x}</option>)}</select>
    </label>
  )

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-body">
          <h3>{start.id ? 'Edit offer' : 'Add offer'}</h3>

          <label className="switch-row">
            <div><b>Enable points for this plan</b><small>Award points on purchase and allow redeeming</small></div>
            <input type="checkbox" checked={f.points} onChange={e => set('points', e.target.checked)} />
          </label>

          <label className="field"><span>Category</span>
            <input value={f.category}disabled={lock}  onChange={e => set('category', e.target.value)} placeholder="Data, Minutes, Night bundles" />
          </label>
          <label className="field"><span>Plan name</span>
            <input value={f.name}disabled={lock}  onChange={e => set('name', e.target.value)} placeholder="1GB 1hr" />
          </label>
          <label className="field"><span>USSD</span>
            <input value={f.ussd}disabled={lock}   onChange={e => set('ussd', e.target.value)} placeholder="*544*1*pn#" />
            <small>Use "pn" for the customer number.</small>
          </label>

          <div className="two">
            <label className="field"><span>Selling price (KES)</span>
              <input type="number" inputMode="decimal" value={f.price} onChange={e => set('price', e.target.value)} /></label>
            <label className="field"><span>Safaricom price (KES)</span>
              <input type="number" inputMode="decimal" value={f.safPrice}disabled={lock}  onChange={e => set('safPrice', e.target.value)} /></label>
          </div>

          <Select label="Payment mode" k="payment" options={['Till SIM', 'Paybill', 'Other SIM']} />
          <div className="two">
            <Select label="Execute on SIM" k="execSim" options={['SIM 1', 'SIM 2']} />
            <Select label="Notification SIM" k="notifSim" options={['SIM 1', 'SIM 2']} />
          </div>
          <Select label="USSD type" k="type" options={['Simple', 'Advanced', 'Normal']} />

          <label className="switch-row">
            <div><b>Auto retry</b><small>Retry failed or pending transactions</small></div>
            <input type="checkbox" checked={f.autoRetry} onChange={e => set('autoRetry', e.target.checked)} />
          </label>

          {f.autoRetry && (
            <div className="two">
              <label className="field"><span>Retry count</span>
                <input type="number" min="1" value={f.retryCount} onChange={e => set('retryCount', e.target.value)} /></label>
              <div className="checks">
                <label><input type="checkbox" checked={f.retryPending} onChange={e => set('retryPending', e.target.checked)} /> Retry pending</label>
                <label><input type="checkbox" checked={f.retryFailed} onChange={e => set('retryFailed', e.target.checked)} /> Retry failed</label>
              </div>
            </div>
          )}

          <label className="switch-row">
            <b>Offer enabled</b>
            <input type="checkbox" checked={f.enabled} onChange={e => set('enabled', e.target.checked)} />
          </label>
          {err && <p className="err">{err}</p>}
        </div>
        <div className="sheet-bar">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save}>Save offer</button>
        </div>
      </div>
    </div>
  )
}

export default Offers