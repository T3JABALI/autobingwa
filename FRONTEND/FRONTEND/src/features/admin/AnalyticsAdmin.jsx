import { useEffect, useState } from 'react'
import { adminFetch } from './adminApi'

const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

export default function AnalyticsAdmin() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('open')
  const [busy, setBusy] = useState('')

  async function load() {
    try { setD(await adminFetch('/admin/analytics')); setErr('') }
    catch (e) { setErr(e.message) }
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  async function resolve(key) {
    setBusy(key)
    try { await adminFetch('/admin/analytics/resolve', { method: 'POST', body: { key } }); await load() }
    catch (e) { setErr(e.message) }
    setBusy('')
  }

  const list = (d ? d.errors : []).filter((e) => filter === 'all' || (filter === 'done') === e.done)

  return (
    <>
      <div className="ux-health">
        <div className="ux-stat"><small>Success rate</small><b>{d ? (d.successRate === null ? '—' : d.successRate + '%') : '—'}</b><small>today</small></div>
        <div className="ux-stat red"><small>Open errors</small><b>{d ? d.open : '—'}</b><small>need action</small></div>
        <div className="ux-stat green"><small>Resolved</small><b>{d ? d.resolvedWeek : '—'}</b><small>this week</small></div>
      </div>
      <div className="ux-chips">
        {[['open', 'Open'], ['done', 'Resolved'], ['all', 'All']].map(([id, label]) => (
          <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      {err && <p className="in-err">{err}</p>}
      {!d && !err && <p className="in-msg">Loading…</p>}
      {d && list.length === 0 && <p className="in-msg">No errors here. The app is running smoothly.</p>}
      <div className="ux-list">
        {list.map((e) => (
          <div key={e.key} className={'ux-card ux-err ' + (e.done ? 'done' : e.sev)}>
            <div className="ux-row">
              <div className="ux-main">
                <b>{e.kind}</b>
                <span>{[e.phone, when(e.ts)].filter(Boolean).join(' · ')}</span>
              </div>
              <span className={'ux-pill ' + (e.done ? 'ok' : e.sev === 'warn' ? 'warn' : 'bad')}>
                {e.done ? 'Resolved' : e.sev === 'warn' ? 'Warning' : 'Failed'}
              </span>
            </div>
            <div className="ux-msg">{e.msg}</div>
            <div className="ux-ref">{e.source}{e.ref ? ' · ' + e.ref : ''}</div>
            {!e.done && (
              <div className="ux-actions">
                <button className="ux-btn primary" disabled={busy === e.key} onClick={() => resolve(e.key)}>
                  {busy === e.key ? 'Saving…' : 'Mark resolved'}
                </button>
                {e.phone && <a className="ux-btn" href={'tel:' + e.phone}>Call user</a>}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}