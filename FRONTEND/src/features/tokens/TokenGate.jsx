import { useEffect, useState } from 'react'
import { subscribe } from '../home/dataStore.js'
import { tokensActive } from '../../engine/tokens.js'
import { recoverTokenPayments } from '../../engine/tokenPay.js'

export default function TokenGate({ onBuy, hidden = false }) {
  const [show, setShow] = useState(() => !tokensActive())

  useEffect(() => {
    recoverTokenPayments()
    let was = tokensActive()
    const check = () => {
      const now = tokensActive()
      if (was && !now) setShow(true) // just ran out
      if (now) setShow(false)
      was = now
    }
    const off = subscribe(check)
    const need = () => setShow(true)
    window.addEventListener('ab-need-tokens', need)
    const timer = setInterval(check, 30000) // catches an unlimited plan that expires
    return () => {
      off()
      window.removeEventListener('ab-need-tokens', need)
      clearInterval(timer)
    }
  }, [])

  if (!show || hidden) return null

  return (
    <div className="tg-back">
      <style>{`
        .tg-back { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.65); }
        .tg { width: 100%; max-width: 380px; padding: 24px 20px; border-radius: 20px; background: var(--bg, #101a17); color: var(--text, #e8f1ee); border: 1px solid var(--border, #2a3a35); }
        .tg h3 { margin: 0 0 8px; font-size: 20px; }
        .tg p { margin: 0 0 18px; font-size: 14px; color: var(--soft, #9aa8a3); line-height: 1.55; }
        .tg button { display: block; width: 100%; padding: 16px; border: 0; border-radius: 999px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
        .tg .go { background: var(--primary, #3dd6b0); color: var(--on-primary, #04130f); }
        .tg .later { margin-top: 8px; background: transparent; color: var(--soft, #9aa8a3); font-weight: 600; }
      `}</style>
      <div className="tg" role="dialog" aria-modal="true" aria-label="No active token">
        <h3>You have no active token</h3>
        <p>AutoBingwa cannot process any transaction without a token. Buy one to continue automation.</p>
        <button className="go" onClick={() => { setShow(false); onBuy() }}>Buy tokens</button>
        <button className="later" onClick={() => setShow(false)}>Not now</button>
      </div>
    </div>
  )
}