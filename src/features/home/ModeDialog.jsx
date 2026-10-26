import { useEffect } from 'react'

const MODES = [
  { id: 'Express', label: 'Express Mode', desc: 'Processes USSDs that can be completed in one request' },
  { id: 'Advanced', label: 'Advanced Mode', desc: 'Processes USSDs that require multiple steps to complete' },
]

const CSS = `
.md-bg {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgb(0 0 0 / 55%);
  display: grid;
  place-items: center;
  padding: 16px;
}
.md-box {
  width: 100%;
  max-width: 420px;
  padding: 22px;
  border-radius: 20px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #D5DDF0);
}
.md-box h2 { margin: 0 0 6px; font-size: 20px; }
.md-sub { margin: 0 0 8px; color: var(--muted-text, #4A5568); font-size: 14px; }
.md-opt {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
  padding: 14px 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.md-opt:hover { background: var(--muted-bg, #E6EDFF); }
.md-opt:focus-visible,
.md-close:focus-visible {
  outline: 2px solid var(--accent-color, #1F5EFF);
  outline-offset: 2px;
}
.md-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--border-color, #D5DDF0);
  flex-shrink: 0;
  margin-top: 2px;
  display: grid;
  place-items: center;
}
.md-opt.on .md-dot { border-color: var(--accent-color, #1F5EFF); }
.md-opt.on .md-dot::after {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-color, #1F5EFF);
}
.md-name { display: block; font-size: 17px; font-weight: 700; }
.md-desc {
  display: block;
  margin-top: 4px;
  color: var(--muted-text, #4A5568);
  font-size: 14px;
  line-height: 1.5;
}
.md-close {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 15px 0;
  border: 2px solid var(--border-color, #D5DDF0);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
`

export default function ModeDialog({ mode, onSelect, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="md-bg" onClick={onClose}>
      <div
        className="md-box"
        role="dialog"
        aria-modal="true"
        aria-label="Processing mode"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{CSS}</style>

        <h2>Processing mode</h2>
        <p className="md-sub">Choose how transactions are processed.</p>

        <div role="radiogroup" aria-label="Processing mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              className={`md-opt ${mode === m.id ? 'on' : ''}`}
              onClick={() => onSelect(m.id)}
            >
              <span className="md-dot" />
              <span>
                <span className="md-name">{m.label}</span>
                <span className="md-desc">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <button className="md-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}