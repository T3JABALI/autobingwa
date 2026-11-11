import { useEffect, useRef, useState } from 'react'
import { checkForUpdate, runInstall } from '../../engine/updates.js'
import { isNative } from '../../engine/native.js'
import './updates.css'

export default function UpdatesPage({ onBack }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState('')
  const alive = useRef(true)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const r = await checkForUpdate()
      if (alive.current) setInfo(r)
    } catch (e) {
      if (alive.current) setError('Could not check for updates. Check your internet and try again.')
    }
    if (alive.current) setLoading(false)
  }

  useEffect(() => {
    alive.current = true
    refresh()
    return () => { alive.current = false }
  }, [])

  async function install() {
    setBusy(true)
    setMsg('')
    setPct(0)
    const r = await runInstall(info.latest, setPct)
    setMsg(r.message)
    setBusy(false)
  }

  const available = Boolean(info && info.available)

  return (
    <div className="up-page">
      <div className="up-head">
        {onBack && <button className="up-back" onClick={onBack} aria-label="Go back">←</button>}
        <h1>Updates</h1>
        <button className="up-refresh" onClick={refresh} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="up-box">
        <p className="up-muted" style={{ margin: 0 }}>Current version</p>
        <strong style={{ fontSize: 22 }}>{info && info.current ? info.current.name : '—'}</strong>
        {!available && !loading && !error && isNative() && (
          <p className="up-muted" style={{ margin: '6px 0 0' }}>You are up to date</p>
        )}
      </div>

      {error && <p className="up-err">{error}</p>}

      {available && (
        <div className="up-box new">
          <div className="up-row">
            <strong>Version {info.latest.name}</strong>
            <span className="up-badge">New</span>
          </div>
          {info.latest.notes && info.latest.notes.length > 0 && (
            <ul className="up-notes-page">
              {info.latest.notes.slice(0, 4).map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          {busy && <p className="up-muted">Downloading {pct}%</p>}
          {msg && <p className="up-muted">{msg}</p>}
          <button className="up-btn" style={{ width: '100%', marginTop: 10 }} onClick={install} disabled={busy}>
            {busy ? `Downloading ${pct}%` : 'Update now'}
          </button>
        </div>
      )}
    </div>
  )
}