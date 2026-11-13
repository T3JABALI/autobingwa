import { useEffect, useState } from 'react'
import {
  AutoBingwa, isNative, getSims, ussdServiceEnabled, restrictedStatus, accessibilityConflicts,
  openAppInfo, openAccessibilitySettings, requestBatteryExemption, askPermissions, deviceInfo, batteryExempt,
} from '../../engine/native.js'

// Menu names differ between phone versions, so these are guides, not exact paths
const BRAND_TIPS = {
  samsung: [
    'Settings > Battery > Background usage limits: turn off "Put unused apps to sleep".',
    'Add AutoBingwa to "Never sleeping apps".',
    'Settings > Apps > AutoBingwa > Battery > choose Unrestricted.',
  ],
  xiaomi: [
    'Settings > Apps > Manage apps > AutoBingwa > Battery saver > No restrictions.',
    'Allow "Display pop-up windows while running in the background" if offered.',
  ],
  transsion: [
    'Settings > Battery > App battery management > AutoBingwa > No restrictions.',
    'Turn off any "Power saving" or "Ultra power saving" mode.',
  ],
  oppo: [
    'Settings > Battery > AutoBingwa > allow background activity and turn off battery optimisation.',
  ],
  vivo: [
    'Settings > Battery > Background power consumption management: allow AutoBingwa.',
  ],
  other: [
    'Settings > Battery: set AutoBingwa to unrestricted / not optimised.',
  ],
}
function brandKey(info) {
  const s = `${info.manufacturer} ${info.brand}`.toLowerCase()
  if (/samsung/.test(s)) return 'samsung'
  if (/xiaomi|redmi|poco/.test(s)) return 'xiaomi'
  if (/tecno|infinix|itel|transsion/.test(s)) return 'transsion'
  if (/oppo|realme|oneplus/.test(s)) return 'oppo'
  if (/vivo|iqoo/.test(s)) return 'vivo'
  return 'other'
}

export default function PhoneSetupPage({ onBack }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const info = (await deviceInfo()) || { manufacturer: '', brand: '', model: '', sdk: 0, release: '' }
    let perms = {}
    try { perms = await AutoBingwa.checkPermissions() } catch (e) { /* not available */ }
    let sims = []
    try { sims = await getSims() } catch (e) { /* no permission yet */ }
    setState({
      info,
      perms,
      sims,
      service: await ussdServiceEnabled(),
      blocked: info.sdk >= 33 ? await restrictedStatus() : false,
      battery: await batteryExempt(),
      conflicts: (await accessibilityConflicts()).apps || [],
    })
    setBusy(false)
  }

  useEffect(() => { if (isNative()) run() }, [])

  async function askAll() {
    await askPermissions()
    run()
  }

  const rows = state ? [
    {
      title: 'Phone, SMS and contacts permission',
      ok: state.perms.sms === 'granted' && state.perms.phone === 'granted' && state.perms.contacts === 'granted',
      detail: 'AutoBingwa needs these to read payments and dial USSD.',
      label: 'Allow', act: askAll,
    },
    {
      title: 'SIM card',
      ok: state.sims.length > 0,
      detail: state.sims.length === 1
        ? 'One SIM found. It will be used for everything.'
        : state.sims.length > 1 ? `${state.sims.length} SIMs found.` : 'No SIM found, or the phone permission is missing.',
    },
    {
      title: 'AutoBingwa accessibility service',
      ok: state.service,
      detail: 'Needed for Advanced mode and signatures.',
      label: 'Open settings', act: openAccessibilitySettings,
    },
    ...(state.info.sdk >= 33 ? [{
      title: 'Restricted settings',
      ok: !state.blocked,
      detail: 'Android may block accessibility for apps installed outside Play Store. In App info, tap the three dots at the top right and choose "Allow restricted settings".',
      label: 'Open App info', act: openAppInfo,
    }] : []),
    {
      title: 'Battery not limited',
      ok: state.battery,
      detail: 'Without this the phone can stop AutoBingwa when the screen is off.',
      label: 'Allow', act: async () => { await requestBatteryExemption(); setTimeout(run, 1500) },
    },
    {
      title: 'No other accessibility apps in the way',
      ok: state.conflicts.length === 0,
      detail: state.conflicts.length
        ? 'Switch these off: ' + state.conflicts.map((a) => a.label || a.package).join(', ')
        : 'None found.',
      label: 'Open settings', act: openAccessibilitySettings,
    },
  ] : []

  const key = state ? brandKey(state.info) : 'other'
  const passed = rows.filter((r) => r.ok).length

  return (
    <div className="ps-page">
      <style>{`
        .ps-page { width: 100%; box-sizing: border-box; padding: 4px 4px 32px; max-width: 560px; margin: 0 auto; }
        .ps-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .ps-head h1 { margin: 0; font-size: 19px; }
        .ps-back { width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
        .ps-sum { margin: 0 0 12px; font-size: 14px; color: var(--soft, #9aa8a3); }
        .ps-row { display: flex; align-items: flex-start; gap: 10px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--border, #2a3a35); border-radius: 14px; }
        .ps-dot { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 14px; font-weight: 800; color: #fff; background: var(--red, #e5534b); }
        .ps-dot.ok { background: #1faa59; }
        .ps-main { flex: 1; min-width: 0; }
        .ps-main b { display: block; font-size: 14px; }
        .ps-main span { display: block; margin-top: 3px; font-size: 12.5px; line-height: 1.45; color: var(--soft, #9aa8a3); }
        .ps-act { flex-shrink: 0; padding: 9px 14px; border: 0; border-radius: 999px; background: var(--primary, #3dd6b0); color: var(--on-primary, #04130f); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
        .ps-tips { margin: 16px 0 0; padding: 14px; border-radius: 14px; background: rgb(128 128 128 / 12%); }
        .ps-tips h2 { margin: 0 0 6px; font-size: 15px; }
        .ps-tips ol { margin: 8px 0 0; padding-left: 20px; font-size: 13px; line-height: 1.6; }
        .ps-btn { display: block; width: 100%; margin-top: 14px; padding: 14px; border: 2px solid var(--border, #2a3a35); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
      `}</style>

      <div className="ps-head">
        <button className="ps-back" onClick={onBack} aria-label="Go back">←</button>
        <h1>Phone Setup Check</h1>
      </div>

      {!isNative() && <p className="ps-sum">This check only works inside the Android app.</p>}

      {state && (
        <>
          <p className="ps-sum">
            {state.info.manufacturer} {state.info.model} · Android {state.info.release} · {passed} of {rows.length} ready
          </p>
          {rows.map((r) => (
            <div className="ps-row" key={r.title}>
              <span className={`ps-dot ${r.ok ? 'ok' : ''}`}>{r.ok ? '✓' : '!'}</span>
              <div className="ps-main"><b>{r.title}</b><span>{r.detail}</span></div>
              {!r.ok && r.act && <button className="ps-act" onClick={r.act}>{r.label}</button>}
            </div>
          ))}

          <div className="ps-tips">
            <h2>Keep AutoBingwa running on your {state.info.manufacturer || 'phone'}</h2>
            <span style={{ fontSize: 12.5 }}>Menu names change between versions, so look for the closest match.</span>
            <ol>{BRAND_TIPS[key].map((t) => <li key={t}>{t}</li>)}</ol>
          </div>
        </>
      )}

      {isNative() && (
        <button className="ps-btn" onClick={run} disabled={busy}>{busy ? 'Checking…' : 'Check again'}</button>
      )}
    </div>
  )
}