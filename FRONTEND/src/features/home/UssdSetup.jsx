import { useEffect, useRef, useState } from 'react'
import {
  isNative, ussdServiceEnabled, openAccessibilitySettings, openAppInfo,
  requestBatteryExemption, restrictedStatus, batteryExempt,
} from '../../engine/native.js'

export default function UssdSetup() {
  const [on, setOn] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [bat, setBat] = useState(false)
  const [open, setOpen] = useState(false)
  const asked = useRef(false)
  const tried = useRef(false)
  const autoInfo = useRef(false)

  const check = async () => {
    if (!isNative()) return
    try {
      const enabled = await ussdServiceEnabled()
      setOn(enabled)
      if (enabled) { setOpen(false); return }
      const b = await restrictedStatus()
      setBlocked(b)
      try { setBat(await batteryExempt()) } catch (e) { /* ignore */ }
      if (!asked.current) { asked.current = true; setOpen(true) }
      // Back from Accessibility and still off while Android blocks it: open App info for the user
      if (tried.current && b && !autoInfo.current) {
        autoInfo.current = true
        setOpen(true)
        openAppInfo()
      }
    } catch (e) {
      console.error('AB setup check', e)
    }
  }

  useEffect(() => {
    check()
    const onShow = () => { if (!document.hidden) check() }
    const need = () => { setOpen(true); check() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('ab-need-setup', need)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('ab-need-setup', need)
    }
  }, [])

  if (!isNative() || on) return null

  return (
    <>
      <style>{`
        .us-banner { width: 100%; text-align: left; cursor: pointer; padding: 12px 14px; margin-bottom: 12px;
          border-radius: 14px; border: 1px solid #f07a63; background: transparent;
          color: #f07a63; font: inherit; font-size: 13px; font-weight: 600; }
        .us-back { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end;
          justify-content: center; background: rgba(0, 0, 0, 0.62); }
        .us-sheet { --us-card: rgba(127,127,127,.09); --us-ic: rgba(127,127,127,.18);
          width: 100%; max-width: 520px; max-height: 92vh; overflow-y: auto; box-sizing: border-box;
          padding: 20px 16px calc(env(safe-area-inset-bottom, 0px) + 18px);
          border-radius: 22px 22px 0 0; background: var(--bg); color: var(--text); border: 1px solid var(--border); }
        @supports (background: color-mix(in srgb, red 10%, blue)) {
          .us-sheet { --us-card: color-mix(in srgb, var(--primary) 7%, var(--bg));
                      --us-ic: color-mix(in srgb, var(--primary) 18%, var(--bg)); }
        }
        .us-head { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
        .us-logo { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
          background: var(--primary); color: var(--bg); font-size: 21px; font-weight: 800; }
        .us-brand { font-size: 20px; font-weight: 800; color: var(--primary); }
        .us-sheet h3 { margin: 0 0 6px; font-size: 21px; font-weight: 800; color: var(--text); }
        .us-sub { margin: 0 0 16px; font-size: 13.5px; line-height: 1.55; color: var(--soft); }
        .us-card { display: flex; align-items: center; gap: 12px; padding: 13px; margin-bottom: 10px;
          border-radius: 18px; background: var(--us-card); border: 1px solid var(--border); }
        .us-card.hot { border-color: #f07a63; }
        .us-num { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
          background: var(--us-ic); color: var(--primary); font-weight: 800; }
        .us-txt { flex: 1; min-width: 0; }
        .us-txt strong { display: block; font-size: 14.5px; color: var(--text); }
        .us-txt span { display: block; margin-top: 3px; font-size: 12.5px; line-height: 1.45; color: var(--soft); }
        .us-txt span.warn { color: #f07a63; font-weight: 700; }
        .us-go { padding: 9px 16px; border-radius: 999px; border: 1.5px solid var(--primary); background: transparent;
          color: var(--primary); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
        .us-go:active { background: var(--us-ic); }
        .us-ok { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
          background: var(--primary); color: var(--bg); font-weight: 800; }
        .us-close { width: 100%; margin-top: 6px; padding: 13px; border: 0; background: transparent;
          color: var(--soft); font: inherit; font-size: 14px; cursor: pointer; }
      `}</style>

      <button className="us-banner" onClick={() => setOpen(true)}>
        ⚠ USSD automation is not active yet. Tap to finish setup.
      </button>

      {open && (
        <div className="us-back" onClick={() => setOpen(false)}>
          <div className="us-sheet" role="dialog" aria-label="USSD setup" onClick={(e) => e.stopPropagation()}>
            <div className="us-head">
              <div className="us-logo">A</div>
              <div className="us-brand">AutoBingwa</div>
            </div>
            <h3>Let the app dial for you</h3>
            <p className="us-sub">
              Complete these steps one time. Advanced mode stays locked until the first one is done.
            </p>

            <div className="us-card">
              <span className="us-num">1</span>
              <div className="us-txt">
                <strong>Switch on the service</strong>
                <span>Open Accessibility, pick AutoBingwa USSD and turn it on. If Android shows a "Restricted setting" notice, tap OK and return here.</span>
              </div>
              <button
                className="us-go"
                onClick={() => { tried.current = true; autoInfo.current = false; openAccessibilitySettings() }}
              >
                Open
              </button>
            </div>

            <div className={`us-card ${blocked ? 'hot' : ''}`}>
              <span className="us-num">2</span>
              <div className="us-txt">
                <strong>Unlock restricted settings</strong>
                {blocked && <span className="warn">Android is blocking the service right now.</span>}
                <span>Open App info, tap ⋮ at the top right, choose Allow restricted settings, then repeat step 1.</span>
              </div>
              <button className="us-go" onClick={() => openAppInfo()}>Open</button>
            </div>

            <div className="us-card">
              <span className="us-num">3</span>
              <div className="us-txt">
                <strong>Keep it running in the background</strong>
                <span>Choose Allow so Android does not cut a purchase off halfway.</span>
              </div>
              {bat
                ? <span className="us-ok">✓</span>
                : <button className="us-go" onClick={() => requestBatteryExemption()}>Allow</button>}
            </div>

            <button className="us-close" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}