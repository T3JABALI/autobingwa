import { useEffect, useState } from 'react'
import { registerHost } from './dialog.js'

export default function DialogHost() {
  const [queue, setQueue] = useState([])
  useEffect(() => registerHost((req) => setQueue((q) => [...q, req])), [])

  const cur = queue[0]
  if (!cur) return null

  function pick(id) {
    cur.resolve(id)
    setQueue((q) => q.slice(1))
  }

  return (
    <div className="dg-back" onClick={() => pick('dismiss')}>
      <style>{`
        .dg-back { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.6); }
        .dg { width: 100%; max-width: 380px; padding: 24px 22px 18px; border-radius: 20px; font: inherit; background: var(--bg, #101a17); color: var(--text, #e8f1ee); border: 1px solid var(--border, #2a3a35); }
        .dg h3 { margin: 0 0 10px; font-size: 20px; font-weight: 700; }
        .dg p { margin: 0 0 22px; font-size: 14.5px; line-height: 1.55; color: var(--soft, #9aa8a3); white-space: pre-line; }
        .dg-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
        .dg-btn { padding: 12px 20px; border: 0; border-radius: 14px; font: inherit; font-size: 15.5px; font-weight: 700; cursor: pointer; background: transparent; color: var(--primary, #3dd6b0); }
        .dg-btn.primary { background: var(--primary, #3dd6b0); color: var(--on-primary, #04130f); }
        .dg-btn.danger { background: var(--red, #e5534b); color: #fff; }
        .dg-btn.ghost { border: 2px solid var(--border, #2a3a35); color: inherit; }
        .dg-btn:focus-visible { outline: 2px solid var(--primary, #3dd6b0); outline-offset: 2px; }
      `}</style>
      <div className="dg" role="alertdialog" aria-modal="true" aria-label={cur.title} onClick={(e) => e.stopPropagation()}>
        <h3>{cur.title}</h3>
        {cur.message && <p>{cur.message}</p>}
        <div className="dg-actions">
          {cur.choices.map((c) => (
            <button key={c.id} className={`dg-btn ${c.kind || 'text'}`} onClick={() => pick(c.id)}>{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}