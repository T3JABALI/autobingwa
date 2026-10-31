import { useEffect, useState } from 'react'
import { getCurrentVersion, checkForUpdate, runInstall } from '../../engine/updates.js'
import { isNative } from '../../engine/native.js'

export default function UpdatesPage({ onBack }) {
  const [current, setCurrent] = useState(null)
  const [info, setInfo] = useState(null)
  const [phase, setPhase] = useState('checking') // checking | idle | downloading
  const [pct, setPct] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function check() {
    setPhase('checking')
    setError('')
    setMessage('')
    try {
      setInfo(await checkForUpdate())
    } catch (e) {
      setInfo(null)
      setError(e && e.message ? e.message : String(e))
    } finally {
      setPhase('idle')
    }
  }

  useEffect(() => {
    getCurrentVersion().then(setCurrent)
    check()
  }, [])

  async function install() {
    if (!info || !info.available) return
    setPhase('downloading')
    setPct(0)
    setError('')
    setMessage('')
    const r = await runInstall(info.latest, setPct)
    if (r.ok) setMessage(r.message)
    else setError(r.message)
    setPhase('idle')
  }

  const available = Boolean(info && info.available)
  const canInstall = available && phase === 'idle' && isNative()
  const status =
    phase === 'checking' ? 'Checking for updates...'
      : error && !info ? 'Could not check for updates'
        : available ? `Update available: version ${info.latest.name}`
          : 'Your App is Up To Date'

  return (
    <div className="up-page">
      <style>{`
        .up-page { min-height: 78vh; display: flex; flex-direction: column; box-sizing: border-box; padding: 4px 4px 24px; }
        .up-head { display: flex; align-items: center; gap: 10px; }
        .up-head h1 { margin: 0; font-size: 22px; font-weight: 600; }
        .up-back { width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; }
        .up-back svg, .up-refresh svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .up-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; padding: 24px 12px; }
        .up-refresh { width: 84px; height: 84px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; }
        .up-refresh svg { width: 56px; height: 56px; stroke-width: 1.8; }
        .up-refresh:disabled { cursor: default; }
        .up-refresh.spin svg { animation: up-rot 1s linear infinite; }
        @keyframes up-rot { to { transform: rotate(360deg); } }
        .up-status { margin: 0; font-size: 19px; }
        .up-version { margin: 0; font-size: 14px; color: var(--soft, var(--muted-text, #8a94a6)); }
        .up-notes { margin: 0; padding: 0; list-style: none; font-size: 14px; color: var(--soft, var(--muted-text, #8a94a6)); line-height: 1.7; }
        .up-err { margin: 0; color: var(--red, var(--danger, #e5534b)); font-weight: 600; font-size: 14px; max-width: 320px; }
        .up-msg { margin: 0; color: var(--primary, var(--accent-color, #3dd6b0)); font-weight: 600; font-size: 14px; max-width: 320px; }
        .up-bar { width: min(320px, 80vw); height: 10px; border-radius: 99px; background: var(--border, #2a3a35); overflow: hidden; }
        .up-bar i { display: block; height: 100%; background: var(--primary, var(--accent-color, #3dd6b0)); transition: width 150ms; }
        .up-install { width: calc(100% - 24px); max-width: 540px; align-self: center; padding: 22px 0; border: 0; border-radius: 999px; font: inherit; font-size: 17px; font-weight: 700; cursor: pointer; background: var(--primary, var(--accent-color, #3dd6b0)); color: var(--on-primary, #04130f); }
        .up-install:disabled { background: rgb(128 128 128 / 22%); color: rgb(128 128 128 / 70%); cursor: not-allowed; }
      `}</style>

      <header className="up-head">
        <button className="up-back" onClick={onBack} aria-label="Go back">
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <h1>Check For Updates</h1>
      </header>

      <div className="up-body">
        <button className={`up-refresh ${phase === 'checking' ? 'spin' : ''}`} onClick={check}
          disabled={phase !== 'idle'} aria-label="Check for updates again">
          <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></svg>
        </button>

        <p className="up-status" role="status">{status}</p>

        {available && info.latest.notes.length > 0 && (
          <ul className="up-notes">{info.latest.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>
        )}

        <p className="up-version">
          Your version: {current ? `${current.name} (build ${current.code})` : '...'}
        </p>

        {phase === 'downloading' && (
          <>
            <div className="up-bar" aria-label="Download progress"><i style={{ width: `${pct}%` }} /></div>
            <p className="up-version">Downloading {pct}%</p>
          </>
        )}
        {error && <p className="up-err" role="alert">{error}</p>}
        {message && <p className="up-msg" role="status">{message}</p>}
        {available && !isNative() && <p className="up-version">Updates install only inside the Android app.</p>}
      </div>

      <button className="up-install" onClick={install} disabled={!canInstall}>
        {phase === 'downloading' ? 'Downloading...' : 'Install Update'}
      </button>
    </div>
  )
}