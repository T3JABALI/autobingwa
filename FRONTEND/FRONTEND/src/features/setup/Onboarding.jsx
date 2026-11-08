import { useCallback, useEffect, useState } from 'react'
import {
  AutoBingwa, isNative, askPermissions, ussdServiceEnabled, openAccessibilitySettings,
  batteryExempt, requestBatteryExemption, requestNotifications, openAppInfo,
} from '../../engine/native.js'

export const ONBOARD_KEY = 'ab-onboarded'
export const isOnboarded = () => {
  try { return localStorage.getItem(ONBOARD_KEY) === '1' } catch { return false }
}

async function readStatus() {
  if (!isNative()) return { sms: true, phone: true, contacts: true, notif: true, access: true, battery: true }
  let p = {}
  try { p = await AutoBingwa.checkPermissions() } catch (e) { /* ignore */ }
  let access = false
  try { access = await ussdServiceEnabled() } catch (e) { /* ignore */ }
  return {
    sms: p.sms === 'granted',
    phone: p.phone === 'granted',
    contacts: p.contacts === 'granted',
    notif: localStorage.getItem('ab-notif') === '1',
    access,
    battery: await batteryExempt(),
  }
}

const STEPS = [
  {
    title: 'Welcome to our USSD Automation',
    sub: 'Allow the access below so payments are read and offers are delivered for you. The app cannot work without it.',
    items: [
      { key: 'sms', icon: '💬', title: 'SMS access', desc: 'Read incoming M-Pesa payments', act: () => askPermissions(), required: true },
      { key: 'phone', icon: '📞', title: 'Phone & SIM', desc: 'Dial USSD codes and detect your SIMs', act: () => askPermissions(), required: true },
      { key: 'contacts', icon: '👥', title: 'Contacts', desc: 'Save your customers automatically', act: () => askPermissions() },
      {
        key: 'notif', icon: '🔔', title: 'Notifications', desc: 'Get an alert for every transaction',
        act: async () => { await requestNotifications(); localStorage.setItem('ab-notif', '1') },
      },
    ],
  },
  {
    title: 'Let AutoBingwa dial for you',
    sub: 'Accessibility lets the app read the USSD menu and press the options. It is needed for Advanced mode.',
    items: [
      { key: 'access', icon: '♿', title: 'Accessibility service', desc: 'Find AutoBingwa in the list and switch it on', act: () => openAccessibilitySettings() },
    ],
    note: {
      title: 'If it switches itself off',
      text: 'Force-stopping the app or a phone cleaner can turn accessibility off. When that happens, open AutoBingwa and tap the warning on the Home screen to switch it back on.',
    },
  },
  {
    title: 'Keep it running',
    sub: 'Phones love to close apps in the background. These steps stop that.',
    items: [
      { key: 'battery', icon: '🔋', title: 'Unrestricted battery', desc: 'Lets automation run while minimized', act: () => requestBatteryExemption() },
      { key: 'lock', icon: '🔒', title: 'Autostart and lock in recents', desc: 'Open App info, allow Autostart, then lock the app in Recent apps', act: () => openAppInfo(), info: true },
    ],
  },
]

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0)
  const [st, setSt] = useState({})

  const refresh = useCallback(async () => setSt(await readStatus()), [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 1500)
    const vis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [refresh])

  const cur = STEPS[step]
  const ready = cur.items.every((i) => !i.required || st[i.key])
  const last = step === STEPS.length - 1

  async function run(item) {
    try { await item.act() } catch (e) { console.error('onboarding', e) }
    refresh()
  }
  function next() {
    if (!last) return setStep(step + 1)
    try { localStorage.setItem(ONBOARD_KEY, '1') } catch (e) { /* ignore */ }
    onDone()
  }

  return (
    <div className="ob">
      <style>{`
        .ob { --ob-card: rgba(127,127,127,.09); --ob-ic: rgba(127,127,127,.18);
          min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column;
          padding: calc(env(safe-area-inset-top, 0px) + 22px) 18px calc(env(safe-area-inset-bottom, 0px) + 24px); }
        @supports (background: color-mix(in srgb, red 10%, blue)) {
          .ob { --ob-card: color-mix(in srgb, var(--primary) 7%, var(--bg));
                --ob-ic: color-mix(in srgb, var(--primary) 18%, var(--bg)); }
        }
        .ob-bars { display: flex; gap: 8px; margin-bottom: 26px; }
        .ob-bar { flex: 1; height: 5px; border-radius: 9px; background: var(--border); }
        .ob-bar.on { background: var(--primary); }
        .ob-head { display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }
        .ob-logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
          background: var(--primary); color: var(--bg); font-size: 22px; font-weight: 800; }
        .ob-brand { font-size: 22px; font-weight: 800; letter-spacing: .3px; color: var(--primary); }
        .ob h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.25; font-weight: 800; }
        .app .ob-sub { margin: 0 0 20px; color: var(--soft) !important; font-size: 14px; line-height: 1.55; }
        .ob-card { display: flex; align-items: center; gap: 13px; padding: 14px; margin-bottom: 11px;
          border-radius: 18px; background: var(--ob-card); border: 1px solid var(--border); }
        .ob-ic { width: 48px; height: 48px; border-radius: 50%; background: var(--ob-ic);
          display: grid; place-items: center; font-size: 21px; flex-shrink: 0; }
        .ob-txt { flex: 1; min-width: 0; }
        .ob-txt strong { display: block; font-size: 15px; }
        .app .ob-txt span { display: block; margin-top: 3px; color: var(--soft); font-size: 12.5px; line-height: 1.4; }
        .ob-check { width: 32px; height: 32px; border-radius: 50%; background: var(--primary);
          color: var(--bg); display: grid; place-items: center; font-weight: 800; flex-shrink: 0; }
        .ob-on { padding: 10px 18px; border-radius: 999px; border: 1.5px solid var(--primary);
          background: transparent; color: var(--primary); font: inherit; font-size: 13px; font-weight: 700;
          cursor: pointer; flex-shrink: 0; }
        .ob-on:active { background: var(--ob-ic); }
        .ob-note { padding: 14px 16px; margin-top: 4px; border-radius: 18px; background: var(--ob-card);
          border: 1px solid var(--border); }
        .ob-note strong { display: block; margin-bottom: 6px; font-size: 14px; }
        .app .ob-note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--soft) !important; }
        .ob-foot { margin-top: auto; padding-top: 18px; }
        .ob-next { width: 100%; padding: 16px; border: 0; border-radius: 999px; background: var(--primary);
          color: var(--bg); font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
        .ob-next:disabled { opacity: .4; cursor: not-allowed; }
        .ob-skip { width: 100%; margin-top: 8px; padding: 12px; border: 0; background: transparent;
          color: var(--soft); font: inherit; cursor: pointer; }
      `}</style>

      <div className="ob-bars">{STEPS.map((_, i) => <span key={i} className={`ob-bar ${i <= step ? 'on' : ''}`} />)}</div>

      <div className="ob-head">
        <div className="ob-logo">A</div>
        <div className="ob-brand">AutoBingwa</div>
      </div>

      <h1>{cur.title}</h1>
      <p className="ob-sub">{cur.sub}</p>

      {cur.items.map((i) => (
        <div className="ob-card" key={i.key}>
          <span className="ob-ic">{i.icon}</span>
          <div className="ob-txt"><strong>{i.title}</strong><span>{i.desc}</span></div>
          {st[i.key] && !i.info
            ? <span className="ob-check">✓</span>
            : <button className="ob-on" onClick={() => run(i)}>{i.info ? 'Open' : 'Turn on'}</button>}
        </div>
      ))}

      {cur.note && (
        <div className="ob-note">
          <strong>{cur.note.title}</strong>
          <p>{cur.note.text}</p>
        </div>
      )}

      <div className="ob-foot">
        <button className="ob-next" disabled={!ready} onClick={next}>{last ? 'Start using AutoBingwa' : 'Continue'}</button>
        {step > 0 && <button className="ob-skip" onClick={() => setStep(step - 1)}>Back</button>}
      </div>
    </div>
  )
}