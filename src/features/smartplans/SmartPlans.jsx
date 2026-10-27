import { useState } from 'react'
import { smartOffers, GROUPS } from './smartCatalog.js'

export default function SmartPlans({ owned = [], onDownload = () => {} }) {
  const [group, setGroup] = useState(GROUPS[0])
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const [price, setPrice] = useState('')
  const [err, setErr] = useState('')

  const have = new Set(owned.filter((o) => o.smart).map((o) => o.sid))
  const list = smartOffers.filter(
    (o) => o.group === group && o.name.toLowerCase().includes(q.toLowerCase())
  )

  const open = (o) => {
    setPick(o)
    setPrice(String(o.safPrice))
    setErr('')
  }

  const save = () => {
    const p = Number(price)
    if (!p || p <= 0) return setErr('Enter your selling price')
    onDownload({
      id: Date.now(),
      sid: pick.sid,
      smart: true,
      signature: true, // shows the verified tick and locks the USSD in Offers
      category: pick.group.toUpperCase(),
      name: pick.name,
      ussd: pick.ussd,
      steps: pick.steps,
      price: p,
      safPrice: pick.safPrice,
      payment: 'Till SIM',
      execSim: 'SIM 1',
      notifSim: 'SIM 2',
      type: 'Advanced',
      autoRetry: false,
      retryCount: 1,
      retryPending: false,
      retryFailed: true,
      points: false,
      enabled: true,
      updated: new Date().toLocaleString(),
    })
    setPick(null)
  }

  return (
    <div className="sig sp">
      <div className="offers-head">
        <h2>Smart Data Plans</h2>
      </div>

      <div className="chips">
        {GROUPS.map((g) => (
          <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>

      <input className="sig-search" placeholder="Search plans" value={q} onChange={(e) => setQ(e.target.value)} />

      {list.length === 0 && (
        <div className="empty"><b>No plans found</b></div>
      )}

           {list.map((o) => (
        <div key={o.sid} className="sp-row">
          <div className="sp-name">
            <b>{o.name}</b>
            <span className="tick" title="Verified plan">✔</span>
          </div>
          <div className="sp-price">KES {o.safPrice}</div>
          <code className="sp-ussd">{o.ussd}</code>
          {have.has(o.sid) ? (
            <span className="pill ok sp-added">Added</span>
          ) : (
            <button className="icon-btn sp-dl" onClick={() => open(o)} aria-label={`Download ${o.name}`}>⬇</button>
          )}
        </div>
      ))}
      

      {pick && (
        <div className="sheet-back" onClick={() => setPick(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-body">
              <h3>{pick.name} <span className="tick">✔</span></h3>
              <small className="muted-line">
                {pick.ussd} · Safaricom price KES {pick.safPrice} (locked)
              </small>
              <label className="field">
                <span>Your selling price (KES)</span>
                <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
              {err && <p className="err">{err}</p>}
            </div>
            <div className="sheet-bar">
              <button className="btn ghost" onClick={() => setPick(null)}>Cancel</button>
              <button className="btn" onClick={save}>Save to my offers</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}