import { useState } from 'react'
import { signatureOffers } from './signatureCatalog.js'

function Signature({ owned = [], onDownload = () => {}, onBack }) {
  const [pick, setPick] = useState(null)
  const [price, setPrice] = useState('')
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  const have = new Set(owned.filter(o => o.signature).map(o => o.sid))
  const list = signatureOffers.filter(o => o.name.toLowerCase().includes(q.toLowerCase()))

  const open = o => { setPick(o); setPrice(String(o.safPrice)); setErr('') }

  const confirm = () => {
    const p = Number(price)
    if (!p || p <= 0) return setErr('Enter a selling price')
    onDownload({
      id: Date.now(), sid: pick.sid, signature: true,
      category: pick.category, name: pick.name, ussd: pick.ussd,
      price: p, safPrice: pick.safPrice,
      payment: 'Till SIM', execSim: 'SIM 1', notifSim: 'SIM 2', type: 'Advanced',
      autoRetry: false, retryCount: 1, retryPending: false, retryFailed: true,
      points: false, enabled: true, updated: new Date().toLocaleString(),
    })
    setPick(null)
  }

  return (
    <div className="sig">
      <div className="offers-head">
        <h2>{onBack && <button className="icon-btn" onClick={onBack}>←</button>} Signature Offers</h2>
      </div>
      <input className="sig-search" placeholder="Search offers" value={q} onChange={e => setQ(e.target.value)} />

      {list.length === 0 && <div className="empty"><b>No signature offers yet</b><br />New offers will appear here</div>}

      {list.map(o => (
        <div key={o.sid} className="sig-card">
          <div className="sig-icon">🌐</div>
          <div className="sig-main">
            <div className="sig-title"><b>{o.name}</b><span className="tick" title="Verified transaction">✔</span></div>
            <code>{o.ussd}</code>
          </div>
          <div className="sig-side">
            <b>KES {o.safPrice}</b>
            <div className="sig-actions">
              <span title="USSD and Safaricom price are locked">🔒</span>
              {have.has(o.sid)
                ? <span className="pill ok">Added</span>
                : <button className="icon-btn" onClick={() => open(o)}>⬇</button>}
            </div>
          </div>
        </div>
      ))}

      {pick && (
        <div className="sheet-back" onClick={() => setPick(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-body">
              <h3>{pick.name} <span className="tick">✔</span></h3>
              <small className="muted-line">USSD {pick.ussd} · Safaricom KES {pick.safPrice} (locked)</small>
              <label className="field"><span>Your selling price (KES)</span>
                <input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
              </label>
              {err && <p className="err">{err}</p>}
            </div>
            <div className="sheet-bar">
              <button className="btn ghost" onClick={() => setPick(null)}>Cancel</button>
              <button className="btn" onClick={confirm}>Download to my offers</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Signature