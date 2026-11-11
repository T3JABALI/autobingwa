import { useUpdates } from './useUpdates'
import { installUpdate } from './updates'
import './updates.css'

export default function UpdatesPage({ onBack }) {
  const { loading, error, current, latest, available, refresh } = useUpdates()

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
        <strong style={{ fontSize: 22 }}>{current ? current.versionName : '—'}</strong>
        {!available && !loading && !error && (
          <p className="up-muted" style={{ margin: '6px 0 0' }}>You are up to date</p>
        )}
      </div>

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
    </div>
  )
}