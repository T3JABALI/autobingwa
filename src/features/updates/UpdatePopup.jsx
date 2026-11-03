import { useState } from 'react'
import { useUpdates } from './useUpdates'
import { installUpdate } from './updates'
import './updates.css'

export default function UpdatePopup() {
  const { available, latest, mandatory, current } = useUpdates()
  const [hidden, setHidden] = useState(false)

  if (!available || !latest || (hidden && !mandatory)) return null

  return (
    <div className="up-overlay" role="dialog" aria-modal="true" aria-labelledby="up-title">
      <div className="up-card">
        <h2 id="up-title" className="up-title">Update available</h2>
        <p className="up-ver">
          Version {latest.version_name}{current ? ` (you have ${current.versionName})` : ''}
        </p>
        {latest.notes && <p className="up-notes">{latest.notes}</p>}
        <button className="up-btn" onClick={() => installUpdate(latest.apk_url)}>Update now</button>
        {!mandatory && <button className="up-link" onClick={() => setHidden(true)}>Later</button>}
      </div>
    </div>
  )
}