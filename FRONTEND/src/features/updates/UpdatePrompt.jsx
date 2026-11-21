import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { checkForUpdate, runInstall } from '../../engine/updates.js'
import { isNative } from '../../engine/native.js'

const POLL_MS = 60000 // how often the app looks for a new release while it is open

let dismissedCode = 0
let checking = false

export default function UpdatePrompt() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!isNative()) return undefined
    let dead = false
    let handle = null

    const run = async () => {
      if (checking) return
      checking = true
      try {
        const r = await checkForUpdate()
        if (!dead && r && r.available && r.latest.code !== dismissedCode) setInfo(r)
      } catch (e) {
        console.error('AB update check', e)
      } finally {
        checking = false
      }
    }

    const first = setTimeout(run, 1500)
    const every = setInterval(run, POLL_MS)
    const onVisible = () => { if (!document.hidden) run() }
    document.addEventListener('visibilitychange', onVisible)
    App.addListener('appStateChange', (s) => { if (s.isActive) run() })
      .then((h) => { if (dead) h.remove(); else handle = h })
      .catch(() => {})

    return () => {
      dead = true
      clearTimeout(first)
      clearInterval(every)
      document.removeEventListener('visibilitychange', onVisible)
      if (handle) handle.remove()
    }
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
        .upp-back { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.65); }
        .upp { width: 100%; max-width: 380px; padding: 28px 22px 22px; border-radius: 24px; text-align: center; background: var(--bg, #101a17); color: var(--text, #e8f1ee); border: 1px solid var(--border, #2a3a35); box-shadow: 0 20px 60px rgba(0,0,0,.45); }
        .upp-icon { width: 64px; height: 64px; margin: -52px auto 14px; display: grid; place-items: center; border-radius: 50%; font-size: 30px; background: var(--primary, #3dd6b0); box-shadow: 0 8px 24px rgba(0,0,0,.35); }
        .upp h3 { margin: 0 0 10px; font-size: 20px; font-weight: 800; letter-spacing: .02em; }
        .upp p { margin: 0 0 18px; font-size: 15px; color: var(--soft, #9aa8a3); line-height: 1.55; }
        .upp p.upp-msg { margin: 0 0 14px; font-size: 13px; }
                .upp p.upp-tag { margin: 0 0 18px; font-size: 16px; font-weight: 800; letter-spacing: .06em; color: var(--primary, #3dd6b0); }
        .upp-bar { height: 8px; border-radius: 99px; background: var(--border, #2a3a35); overflow: hidden; margin: 0 0 14px; }
        .upp-bar i { display: block; height: 100%; background: var(--primary, #3dd6b0); }
        .upp button { display: block; width: 100%; padding: 16px; border: 0; border-radius: 999px; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; }
        .upp .go { background: var(--primary, #3dd6b0); color: var(--on-primary, #04130f); }
        .upp .go:disabled { opacity: .55; cursor: wait; }
        .upp .later { margin-top: 8px; background: transparent; color: var(--soft, #9aa8a3); font-weight: 600; }
      `}</style>
      <div className="upp" role="dialog" aria-modal="true" aria-label="Update the app">
        <h3>🚀 AUTOBINGWA UPDATE AVAILABLE!</h3>
        <p>We've made AutoBingwa even better! Update now and enjoy a smoother experience.</p>
        <p className="upp-tag">AUTOBINGWA=PROFITS</p>
        {busy && <div className="upp-bar"><i style={{ width: `${pct}%` }} /></div>}
        {msg && <p className="upp-msg">{msg}</p>}
        <button className="go" onClick={install} disabled={busy}>{busy ? `Downloading ${pct}%` : 'Update now'}</button>
        {!info.latest.mandatory && <button className="later" onClick={later} disabled={busy}>Not now</button>}
      </div>
    </div>
  )
}