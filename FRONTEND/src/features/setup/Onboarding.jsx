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
    title: 'Welcome to our speedspace',
    sub: 'These let the app read payments and deliver bundles. Nothing works without them.',
    items: [
      { key: 'sms', icon: '💬', title: 'SMS permissions', desc: 'Read M-Pesa messages', act: () => askPermissions(), required: true },
      { key: 'phone', icon: '📞', title: 'Phone & SIM', desc: 'Dial USSD codes and list your SIMs', act: () => askPermissions(), required: true },
      { key: 'contacts', icon: '👥', title: 'Contacts', desc: 'Save your customers automatically', act: () => askPermissions() },
      {
        key: 'notif', icon: '🔔', title: 'Notifications', desc: 'Show transaction alerts',
        act: async () => { await requestNotifications(); localStorage.setItem('ab-notif', '1') },
      },
    ],
  },
  {
    title: 'Let AutoBingwa dial for you',
    sub: 'Accessibility lets the app read the USSD menu and press the options. Needed for Advanced mode.',
    items: [
      { key: 'access', icon: '♿', title: 'Accessibility service', desc: 'Find AutoBingwa in the list and switch it on', act: () => openAccessibilitySettings() },
    ],
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
        .ob { min-height: 100vh; box-sizing: border-box; padding: 28px 20px 32px; background: #0b0f1a; color: #fff; display: flex; flex-direction: column; }
        .ob-bars { display: flex; gap: 10px; margin-bottom: 36px; }
        .ob-bar { flex: 1; height: 5px; border-radius: 9px; background: #1f2740; }
        .ob-bar.on { background: #2e9e45; }
        .ob-brand { font-size: 13px; font-weight: 800; letter-spacing: .18em; color: #2e9e45; }
        .ob h1 { margin: 8px 0 10px; font-size: 28px; line-height: 1.2; }
        .ob-sub { margin: 0 0 24px; color: #9aa4bd; font-size: 15px; line-height: 1.5; }
        .ob-card { display: flex; align-items: center; gap: 14px; padding: 16px; margin-bottom: 12px; border-radius: 18px; background: #121829; }
        .ob-ic { width: 52px; height: 52px; border-radius: 50%; background: #13301d; display: grid; place-items: center; font-size: 22px; flex-shrink: 0; }
        .ob-txt { flex: 1; min-width: 0; }
        .ob-txt strong { display: block; font-size: 16px; }
        .ob-txt span { display: block; margin-top: 3px; color: #9aa4bd; font-size: 13px; line-height: 1.4; }
        .ob-check { width: 34px; height: 34px; border-radius: 50%; background: #2e9e45; display: grid; place-items: center; font-weight: 800; flex-shrink: 0; }
        .ob-on { padding: 12px 20px; border-radius: 999px; border: 2px solid #26304d; background: transparent; color: #2e9e45; font: inherit; font-weight: 700; cursor: pointer; flex-shrink: 0; }
        .ob-foot { margin-top: auto; padding-top: 20px; }
        .ob-next { width: 100%; padding: 18px; border: 0; border-radius: 999px; background: #2e9e45; color: #fff; font: inherit; font-size: 17px; font-weight: 700; cursor: pointer; }
        .ob-next:disabled { opacity: .4; cursor: not-allowed; }
        .ob-skip { width: 100%; margin-top: 10px; padding: 12px; border: 0; background: transparent; color: #9aa4bd; font: inherit; cursor: pointer; }
      `}</style>

      <div className="ob-bars">{STEPS.map((_, i) => <span key={i} className={`ob-bar ${i <= step ? 'on' : ''}`} />)}</div>
      <div className="ob-brand">AUTOBINGWA</div>
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

      <div className="ob-foot">
        <button className="ob-next" disabled={!ready} onClick={next}>{last ? 'Start using AutoBingwa' : 'Continue'}</button>
        {step > 0 && <button className="ob-skip" onClick={() => setStep(step - 1)}>Back</button>}
      </div>
    </div>
  )
}