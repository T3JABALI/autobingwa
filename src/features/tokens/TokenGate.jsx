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
        .tg-back { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.7); }
        .tg { width: 100%; max-width: 400px; padding: 26px 20px 20px; border-radius: 24px; background: #121829; color: #fff; border: 1px solid #1f2740; }
        .tg-badge { width: 58px; height: 58px; margin: 0 auto 14px; border-radius: 50%; background: #13301d; display: grid; place-items: center; font-size: 26px; }
        .tg h3 { margin: 0 0 6px; text-align: center; font-size: 21px; }
        .tg > p { margin: 0 0 22px; text-align: center; font-size: 14px; color: #9aa4bd; line-height: 1.5; }
        .tg-step { display: flex; gap: 14px; align-items: flex-start; padding: 12px 14px; margin-bottom: 10px; border-radius: 16px; background: #0d1322; }
        .tg-n { width: 30px; height: 30px; border-radius: 50%; background: #2e9e45; display: grid; place-items: center; font-weight: 800; font-size: 14px; flex-shrink: 0; }
        .tg-step strong { display: block; font-size: 15px; }
        .tg-step span { display: block; margin-top: 2px; color: #9aa4bd; font-size: 13px; line-height: 1.4; }
        .tg button { display: block; width: 100%; padding: 16px; border: 0; border-radius: 999px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
        .tg .go { margin-top: 18px; background: #2e9e45; color: #fff; }
        .tg .later { margin-top: 6px; background: transparent; color: #9aa4bd; font-weight: 600; }
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