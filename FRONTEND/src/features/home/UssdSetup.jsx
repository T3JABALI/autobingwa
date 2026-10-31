import { useEffect, useRef, useState } from 'react'
import {
  isNative, ussdServiceEnabled, openAccessibilitySettings, openAppInfo,
  requestBatteryExemption, restrictedStatus,
} from '../../engine/native.js'

export default function UssdSetup() {
  const [on, setOn] = useState(true)
  const [blocked, setBlocked] = useState(false)
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
      <button
        className="hm-note"
        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid #f07a63', color: '#f07a63', background: 'transparent' }}
        onClick={() => setOpen(true)}
      >
        ⚠ USSD automation is off. Tap to set it up.
      </button>

      {open && (
        <div className="hm-modal-back" onClick={() => setOpen(false)}>
          <div className="hm-modal" role="dialog" aria-label="Set up USSD" onClick={(e) => e.stopPropagation()}>
            <h3>Set up USSD automation</h3>
            <p>Do these once. Advanced mode cannot run until step 1 is done.</p>

            <button
              className="hm-simbtn"
              onClick={() => { tried.current = true; autoInfo.current = false; openAccessibilitySettings() }}
            >
              1. Turn on the service
              <small>Installed apps → AutoBingwa USSD → On. If Android says "Restricted setting", press OK and come back here.</small>
            </button>

            <button className="hm-simbtn" onClick={() => openAppInfo()}>
              2. Allow restricted settings
              <small>
                {blocked ? 'Android is blocking it. ' : ''}
                App info → ⋮ (top right) → Allow restricted settings. Then repeat step 1.
              </small>
            </button>

            <button className="hm-simbtn" onClick={() => requestBatteryExemption()}>
              3. Allow background running
              <small>Choose Allow so Android does not stop a transaction halfway.</small>
            </button>

            <button className="hm-cancel" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}