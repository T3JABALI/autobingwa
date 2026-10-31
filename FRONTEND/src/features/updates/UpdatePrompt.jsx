import { useEffect, useState } from 'react'
import { checkForUpdate, runInstall } from '../../engine/updates.js'
import { isNative } from '../../engine/native.js'

let dismissedCode = 0
let cached = null
let lastCheck = 0

export default function UpdatePrompt() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!isNative()) return undefined
    let dead = false
    const show = (r) => { if (!dead && r && r.available && r.latest.code !== dismissedCode) setInfo(r) }
    const timer = setTimeout(async () => {
      if (cached && Date.now() - lastCheck < 30 * 60000) return show(cached)
      try {
        cached = await checkForUpdate()
        lastCheck = Date.now()
        show(cached)
      } catch (e) {
        console.error('AB update check', e)
      }
    }, 3000)
    return () => { dead = true; clearTimeout(timer) }
  }, [])

  if (!info) return null

  async function install() {
    setBusy(true)
    setMsg('')
    setPct(0)
    const r = await runInstall(info.latest, setPct)
    setMsg(r.message)
    setBusy(false)
  }

  function later() {
    dismissedCode = info.latest.code
    setInfo(null)
  }

  return (
    <div className="upp-back">
      <style>{`
        .upp-back { position: fixed; inset: 0; z-index: 55; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.6); }
        .upp { width: 100%; max-width: 380px; padding: 24px 20px; border-radius: 20px; background: var(--bg, #101a17); color: var(--text, #e8f1ee); border: 1px solid var(--border, #2a3a35); }
        .upp h3 { margin: 0 0 8px; font-size: 20px; }
        .upp p { margin: 0 0 14px; font-size: 14px; color: var(--soft, #9aa8a3); line-height: 1.5; }
        .upp ul { margin: 0 0 16px; padding-left: 18px; font-size: 14px; color: var(--soft, #9aa8a3); line-height: 1.7; }
        .upp-bar { height: 8px; border-radius: 99px; background: var(--border, #2a3a35); overflow: hidden; margin: 0 0 14px; }
        .upp-bar i { display: block; height: 100%; background: var(--primary, #3dd6b0); }
        .upp button { display: block; width: 100%; padding: 16px; border: 0; border-radius: 999px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
        .upp .go { background: var(--primary, #3dd6b0); color: var(--on-primary, #04130f); }
        .upp .go:disabled { opacity: .55; cursor: wait; }
        .upp .later { margin-top: 8px; background: transparent; color: var(--soft, #9aa8a3); font-weight: 600; }
      `}</style>
      <div className="upp" role="dialog" aria-modal="true" aria-label="Update available">
        <h3>Update the app to enjoy more features</h3>
        <p>Version {info.latest.name} is ready. You have {info.current.name}.</p>
        {info.latest.notes.length > 0 && <ul>{info.latest.notes.slice(0, 4).map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {busy && <div className="upp-bar"><i style={{ width: `${pct}%` }} /></div>}
        {msg && <p>{msg}</p>}
        <button className="go" onClick={install} disabled={busy}>{busy ? `Downloading ${pct}%` : 'Install update'}</button>
        {!info.latest.mandatory && <button className="later" onClick={later} disabled={busy}>Later</button>}
      </div>
    </div>
  )
}