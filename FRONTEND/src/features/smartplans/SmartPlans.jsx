import { useEffect, useState } from 'react'
import { smartOffers as BUNDLED, GROUPS as BUNDLED_GROUPS } from './smartCatalog.js'
import { loadCatalog, cachedCatalog } from './catalog.js'
import VerifiedBadge from '../home/VerifiedBadge.jsx'
import { CatIcon, catOf } from '../../Offers.jsx'
const t12 = (v) => {
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const noWindow = () => ({ on: false, from: '06:00', until: '22:00', altId: '', notify: false, msg: '' })

export default function SmartPlans({ owned = [], onDownload = () => {} }) {
  const [cat, setCat] = useState(() => cachedCatalog())
  const [loaded, setLoaded] = useState(false)
  const [group, setGroup] = useState(null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const [price, setPrice] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    loadCatalog().then((c) => {
      if (!alive) return
      if (c) setCat(c)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [])

  // The server catalog. The bundled list is only used if the server was never reachable.
  const plans = cat ? cat.plans : loaded ? BUNDLED : []
  const groups = cat ? cat.groups : loaded ? BUNDLED_GROUPS : []
  const active = groups.includes(group) ? group : groups[0]

  const mine = new Map(owned.filter((o) => o.smart).map((o) => [o.sid, o]))
  // True when the admin re-learned the signature, changed the USSD, or bumped the revision
  const stale = (o) => {
    const m = mine.get(o.sid)
    if (!m) return false
    if (Number(o.rev || 0) > Number(m.catRev || 0)) return true
    if (o.ussd !== m.ussd) return true
    const a = o.sig && o.sig.learnedAt, b = m.sig && m.sig.learnedAt
    return Boolean(a) && a !== b
  }
  const list = plans.filter(
    (o) => o.group === active && o.name.toLowerCase().includes(q.toLowerCase())
  )

  const open = (o) => {
    setPick(o)
    setPrice(String(o.safPrice))
    setErr('')
  }

  const save = () => {
    const p = Number(price)
    if (!p || p <= 0) return setErr('Enter your selling price')
       const clash = owned.find((o) => Number(o.price) === p)
    if (clash) return setErr(`KES ${p} is already used by ${clash.name}. Each offer needs its own price.`)
      onDownload({
      id: Date.now(),
      sid: pick.sid,
      smart: true,
      signature: true, // shows the verified tick and locks the USSD in Offers
      sig: pick.sig || null, // the learned steps from the catalog
      sigLearned: Boolean(pick.sig),
      sigEnabled: true,
      catRev: pick.rev || 0, // lets the app keep this plan up to date by itself
      catTw: pick.tw ? { on: Boolean(pick.tw.on), from: pick.tw.from, until: pick.tw.until } : null,
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
      tw: pick.tw ? { ...noWindow(), ...pick.tw } : noWindow(),
      updated: new Date().toLocaleString(),
    })
    setPick(null)
  }
  // Replaces the old path with the new one. Keeps the user's price, SIMs and retry settings.
  const update = (o) => {
    const m = mine.get(o.sid)
    if (!m) return
    onDownload({
      ...m,
      sig: o.sig || null,
      sigLearned: Boolean(o.sig),
      sigEnabled: true,
      sigAuto: false, // the admin's signature replaces any the app learned itself
      catRev: o.rev || 0,
      catTw: o.tw ? { on: Boolean(o.tw.on), from: o.tw.from, until: o.tw.until } : null,
      category: o.group.toUpperCase(),
      name: m.custom && m.custom.name ? m.name : o.name,
      ussd: o.ussd,
      steps: o.steps,
      safPrice: m.custom && m.custom.safPrice ? m.safPrice : o.safPrice,
      tw: { ...(m.tw || noWindow()), on: Boolean(o.tw && o.tw.on), ...(o.tw ? { from: o.tw.from, until: o.tw.until } : {}) },
      updated: new Date().toLocaleString(),
    })
  }
  return (
    <div className="sig sp">
      <div className="offers-head">
        <h2>Smart Data Plans</h2>
      </div>

      <div className="chips">
        {groups.map((g) => (
          <button key={g} className={`chip ${active === g ? 'on' : ''}`} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>

      <input className="sig-search" placeholder="Search plans" value={q} onChange={(e) => setQ(e.target.value)} />

      {!loaded && !cat && <div className="empty"><b>Loading plans…</b></div>}
      {(loaded || cat) && groups.length === 0 && (
        <div className="empty">
          <b>No plans yet</b><br />
          New plans appear here as soon as they are ready
        </div>
      )}
      {groups.length > 0 && list.length === 0 && (
        <div className="empty"><b>No plans found</b></div>
      )}

      {list.map((o) => (
        <div key={o.sid} className="sp-row">
          <div className="sp-name">
            <CatIcon size={24} category={catOf({ name: o.name, category: String(o.group || '').toUpperCase() })} />
            <b>{o.name}</b>
            <VerifiedBadge />
            {o.tw && o.tw.on && <small> 🕒 {t12(o.tw.from)} to {t12(o.tw.until)}</small>}
          </div>
          <div className="sp-price">KES {o.safPrice}</div>
          <code className="sp-ussd">{o.ussd}</code>
                {stale(o) ? (
            <button className="icon-btn sp-dl" onClick={() => update(o)} aria-label={`Update ${o.name}`}>⬆ Update</button>
          ) : mine.has(o.sid) ? (
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
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CatIcon size={32} category={catOf({ name: pick.name, category: String(pick.group || '').toUpperCase() })} />
                {pick.name} <VerifiedBadge />
              </h3>
              <small className="muted-line">
                {pick.ussd} · Safaricom price KES {pick.safPrice} (locked)
              </small>
              {pick.tw && pick.tw.on && (
                <small className="muted-line">
                  Only sold between {t12(pick.tw.from)} and {t12(pick.tw.until)}. Choose what to sell outside
                  these hours in the offer's time window.
                </small>
              )}
              <label className="field">
                <span>Your selling price (KES)</span>
                <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
                            {owned.some((o) => Number(o.price) === Number(price)) && (
                <p className="err">
                  KES {price} is already used by {owned.find((o) => Number(o.price) === Number(price)).name}. Choose a different price.
                </p>
              )}
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