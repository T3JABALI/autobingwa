import { useUpdates } from './useUpdates'
import { installUpdate } from './updates'
import './updates.css'

export default function UpdatesPage({ onBack }) {
  const { loading, error, current, releases, latest, available, refresh } = useUpdates()

  return (
    <div className="up-page">
      <div className="up-head">
        {onBack && <button className="up-back" onClick={onBack} aria-label="Go back">←</button>}
        <h1>Updates</h1>
        <button className="up-refresh" onClick={refresh} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {current && <p className="up-muted" style={{ marginBottom: 12 }}>Installed version: {current.versionName}</p>}
      {error && <p className="up-err">{error}</p>}

      {available && latest && (
        <div className="up-box new">
          <div className="up-row">
            <strong>Version {latest.version_name}</strong>
            <span className="up-badge">New</span>
          </div>
          {latest.notes && <p className="up-notes-page">{latest.notes}</p>}
          <button className="up-btn" style={{ width: '100%', marginTop: 10 }}
            onClick={() => installUpdate(latest.apk_url)}>Update now</button>
        </div>
      )}

      {!available && !loading && !error && (
        <div className="up-box"><strong>You are up to date</strong></div>
      )}

      {releases.length > 0 && <h2 className="up-sub">Release history</h2>}
      {releases.map((r) => (
        <div className="up-box" key={r.id}>
          <div className="up-row">
            <strong>Version {r.version_name}</strong>
            {current && r.version_code === current.versionCode && <span className="up-badge">Installed</span>}
          </div>
          <p className="up-muted">{new Date(r.created_at).toLocaleDateString()}</p>
          {r.notes && <p className="up-notes-page">{r.notes}</p>}
        </div>
      ))}
    </div>
  )
}