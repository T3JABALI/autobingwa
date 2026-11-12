import { useCallback, useEffect, useState } from 'react'
import {
  AutoBingwa, isNative, askPermissions, ussdServiceEnabled, openAccessibilitySettings,
  batteryExempt, requestBatteryExemption, requestNotifications,
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

const ITEMS = [
  { key: 'sms', icon: '💬', title: 'SMS access', desc: 'Read incoming M-Pesa payments', act: () => askPermissions(), required: true },
  { key: 'phone', icon: '📞', title: 'Phone & SIM', desc: 'Dial USSD codes and detect your SIMs', act: () => askPermissions(), required: true },
  { key: 'contacts', icon: '👥', title: 'Contacts', desc: 'Save your customers automatically', act: () => askPermissions() },
  {
    key: 'notif', icon: '🔔', title: 'Notifications', desc: 'Get an alert for every transaction',
    act: async () => { await requestNotifications(); localStorage.setItem('ab-notif', '1') },
  },
  { key: 'access', icon: '♿', title: 'Accessibility service', desc: 'Find AutoBingwa in the list and switch it on', act: () => openAccessibilitySettings() },
  { key: 'battery', icon: '🔋', title: 'Unrestricted battery', desc: 'Keeps automation running while minimized', act: () => requestBatteryExemption() },
]

export default function Onboarding({ onDone }) {
  const [st, setSt] = useState({})

  const refresh = useCallback(async () => setSt(await readStatus()), [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 1500)
    const vis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [refresh])

  const ready = ITEMS.every((i) => !i.required || st[i.key])
  const done = ITEMS.filter((i) => st[i.key]).length

  async function run(item) {
    try { await item.act() } catch (e) { console.error('onboarding', e) }
    refresh()
  }
  function finish() {
    try { localStorage.setItem(ONBOARD_KEY, '1') } catch (e) { /* ignore */ }
    onDone()
  }

  return (
    <div className="ob">
      <style>{`
        .ob { --ob-card: rgba(127,127,127,.09); --ob-ic: rgba(127,127,127,.18);
          height: 100dvh; box-sizing: border-box; display: flex; flex-direction: column;
          padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px calc(env(safe-area-inset-bottom, 0px) + 14px); }
        @supports (background: color-mix(in srgb, red 10%, blue)) {
          .ob { --ob-card: color-mix(in srgb, var(--primary) 7%, var(--bg));
                --ob-ic: color-mix(in srgb, var(--primary) 18%, var(--bg)); }
        }
        .ob-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .ob-logo { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
          background: var(--primary); color: var(--on-primary, var(--bg)); font-size: 19px; font-weight: 800; }
        .ob-brand { font-size: 18px; font-weight: 800; color: var(--primary) !important; }
        .ob-count { margin-left: auto; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
          background: var(--ob-ic); color: var(--primary); }
        .ob h1 { margin: 0 0 4px; font-size: 20px; line-height: 1.25; font-weight: 800; }
        .app .ob-lead { margin: 0 0 12px; font-size: 13px; line-height: 1.5; font-weight: 400; color: var(--soft) !important; }
        .ob-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
        .ob-card { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin-bottom: 7px;
          border-radius: 14px; background: var(--ob-card); border: 1px solid var(--border); }
        .ob-ic { width: 38px; height: 38px; border-radius: 50%; background: var(--ob-ic);
          display: grid; place-items: center; font-size: 17px; flex-shrink: 0; }
        .ob-txt { flex: 1; min-width: 0; }
        .ob-txt strong { display: block; font-size: 14px; line-height: 1.25; }
        .app .ob-txt span { display: block; margin-top: 2px; color: var(--soft); font-size: 11.5px; line-height: 1.35; }
        .ob-check { width: 26px; height: 26px; border-radius: 50%; background: var(--primary);
          color: var(--on-primary, var(--bg)); display: grid; place-items: center; font-size: 13px; font-weight: 800; flex-shrink: 0; }
        .ob-on { padding: 7px 14px; border-radius: 999px; border: 1.5px solid var(--primary);
          background: transparent; color: var(--primary); font: inherit; font-size: 12px; font-weight: 700;
          cursor: pointer; flex-shrink: 0; }
        .ob-on:active { background: var(--ob-ic); }
        .app .ob-tip { margin: 2px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--soft) !important; }
        .ob-foot { padding-top: 10px; }
        .ob-next { width: 100%; padding: 13px; border: 0; border-radius: 999px; background: var(--primary);
          color: var(--on-primary, var(--bg)); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
        .ob-next:disabled { opacity: .4; cursor: not-allowed; }
      `}</style>

      <div className="ob-head">
        <div className="ob-logo">A</div>
        <div className="ob-brand">AutoBingwa</div>
        <span className="ob-count">{done} of {ITEMS.length} ready</span>
      </div>

      <h1>Set up AutoBingwa</h1>
      <p className="ob-lead">Allow the access below so payments are read and offers are delivered for you. SMS and Phone are required.</p>

      <div className="ob-list">
        {ITEMS.map((i) => (
          <div className="ob-card" key={i.key}>
            <span className="ob-ic">{i.icon}</span>
            <div className="ob-txt"><strong>{i.title}{i.required ? ' *' : ''}</strong><span>{i.desc}</span></div>
            {st[i.key]
              ? <span className="ob-check">✓</span>
              : <button className="ob-on" onClick={() => run(i)}>Turn on</button>}
          </div>
        ))}
        <p className="ob-tip">If accessibility switches itself off, open AutoBingwa and tap the warning on the Home screen to turn it back on.</p>
      </div>

      <div className="ob-foot">
        <button className="ob-next" disabled={!ready} onClick={finish}>Continue</button>
      </div>
    </div>
  )
}