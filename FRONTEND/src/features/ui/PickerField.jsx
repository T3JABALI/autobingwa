import { useState } from 'react'

export default function PickerField({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const chosen = options.find((o) => o.value === value)

  return (
    <>
      <style>{`
        .pf-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; box-sizing: border-box; margin-top: 14px; padding: 16px; border: 2px solid var(--border, #2a3a35); border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; text-align: left; cursor: pointer; }
        .pf-field .pf-ph { color: var(--soft, #9aa8a3); }
        .pf-caret { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid currentColor; flex-shrink: 0; }
        .pf-back { position: fixed; inset: 0; z-index: 90; display: grid; align-items: end; background: rgba(0,0,0,.6); }
        .pf-sheet { max-height: 78vh; display: flex; flex-direction: column; padding: 18px 16px 14px; border-radius: 22px 22px 0 0; font: inherit; background: var(--bg, #101a17); color: var(--text, #e8f1ee); border: 1px solid var(--border, #2a3a35); }
        .pf-sheet h3 { margin: 0 0 8px; font-size: 17px; }
        .pf-list { overflow-y: auto; }
        .pf-opt { display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 6px; border: 0; border-bottom: 1px solid var(--border, #2a3a35); background: transparent; color: inherit; font: inherit; font-size: 15.5px; text-align: left; cursor: pointer; }
        .pf-dot { width: 22px; height: 22px; border-radius: 50%; border: 3px solid var(--border, #2a3a35); flex-shrink: 0; display: grid; place-items: center; }
        .pf-opt.on .pf-dot { border-color: var(--primary, #3dd6b0); }
        .pf-opt.on .pf-dot::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--primary, #3dd6b0); }
        .pf-empty { padding: 16px 6px; color: var(--soft, #9aa8a3); }
        .pf-close { margin-top: 10px; padding: 14px; border: 0; border-radius: 14px; background: transparent; color: var(--primary, #3dd6b0); font: inherit; font-size: 15.5px; font-weight: 700; cursor: pointer; }
      `}</style>

      <button type="button" className="pf-field" onClick={() => setOpen(true)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={chosen ? '' : 'pf-ph'}>{chosen ? chosen.label : label}</span>
        <i className="pf-caret" />
      </button>

      {open && (
        <div className="pf-back" onClick={() => setOpen(false)}>
          <div className="pf-sheet" role="listbox" aria-label={label} onClick={(e) => e.stopPropagation()}>
            <h3>{label}</h3>
            <div className="pf-list">
              {options.length === 0 && <p className="pf-empty">Nothing to choose from.</p>}
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`pf-opt ${o.value === value ? 'on' : ''}`}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                >
                  <span className="pf-dot" />
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <button type="button" className="pf-close" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}