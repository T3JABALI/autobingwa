import { useEffect, useState } from 'react'
import { subscribe } from '../home/dataStore.js'
import { tokensActive } from '../../engine/tokens.js'
import { recoverTokenPayments } from '../../engine/tokenPay.js'
import { autoRenewOn, startAutoRenew } from '../../engine/autoRenew.js'

const STEPS = [
  ['Buy a token', 'Open Tokens and choose the plan that suits your sales.'],
  ['Pay with M-Pesa', 'Your token activates as soon as the payment is confirmed.'],
  ['Start automation', 'Go to Home and hold the green button for 1 second.'],
]

export default function TokenGate({ onBuy, hidden = false }) {
  const [show, setShow] = useState(() => !tokensActive() && !autoRenewOn())

  useEffect(() => {
      recoverTokenPayments()
    const stopAuto = startAutoRenew()
    let was = tokensActive()
    const check = () => {
      const now = tokensActive()
      if (was && !now && !autoRenewOn()) setShow(true) // just ran out
      if (now) setShow(false)
      was = now
    }
    const off = subscribe(check)
    const need = () => setShow(true)
    window.addEventListener('ab-need-tokens', need)
    const timer = setInterval(check, 30000) // catches an unlimited plan that expires
    return () => {
      off()
      stopAuto()
      window.removeEventListener('ab-need-tokens', need)
      clearInterval(timer)
    }
  }, [])

  if (!show || hidden) return null

  return (
    <div className="tg-back">
       <style>{`
        .tg-back { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.65); }
        .tg { width: 100%; max-width: 360px; padding: 20px 16px 14px; border-radius: 22px;
          background: var(--card, #0A2F2C); color: var(--text, #E6F7F1); border: 1px solid var(--border, #1B4D47); box-shadow: var(--shadow, none); }
        .tg-badge { width: 48px; height: 48px; margin: 0 auto 10px; border-radius: 50%; background: var(--hover, #0F3B37);
          display: grid; place-items: center; font-size: 22px; }
        .tg h3 { margin: 0 0 4px; text-align: center; font-size: 18px; line-height: 1.3; }
        .app .tg > p { margin: 0 0 14px; text-align: center; font-size: 13px; line-height: 1.5; color: var(--soft, #8FB8AE) !important; }
        .tg-step { display: flex; gap: 10px; align-items: center; padding: 9px 12px; margin-bottom: 8px; border-radius: 14px;
          background: var(--bg, #031F1D); border: 1px solid var(--border, #1B4D47); }
        .tg-n { width: 26px; height: 26px; border-radius: 50%; background: var(--primary, #3CD6B5); color: var(--on-primary, #03241F);
          display: grid; place-items: center; font-weight: 800; font-size: 13px; flex-shrink: 0; }
        .tg-step strong { display: block; font-size: 14px; line-height: 1.3; }
        .app .tg-step div span { display: block; margin-top: 1px; font-size: 12px; line-height: 1.4; color: var(--soft, #8FB8AE) !important; }
        .tg button { display: block; width: 100%; padding: 13px; border: 0; border-radius: 999px; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
        .tg .go { margin-top: 12px; background: var(--primary, #3CD6B5); color: var(--on-primary, #03241F); }
        .tg .later { margin-top: 4px; background: transparent; color: var(--soft, #8FB8AE); font-weight: 600; }
      `}</style>
      <div className="tg" role="dialog" aria-modal="true" aria-label="No active token">
        <div className="tg-badge">⚡</div>
        <h3>Activate your automation</h3>
        <p>You have no active token. AutoBingwa cannot process any transaction without one.</p>
        {STEPS.map(([title, desc], i) => (
          <div className="tg-step" key={title}>
            <span className="tg-n">{i + 1}</span>
            <div><strong>{title}</strong><span>{desc}</span></div>
          </div>
        ))}
        <button className="go" onClick={() => { setShow(false); onBuy() }}>Buy tokens</button>
        <button className="later" onClick={() => setShow(false)}>Not now</button>
      </div>
    </div>
  )
}