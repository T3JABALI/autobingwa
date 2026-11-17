import { useState } from 'react'
import { USSD_DEFAULTS, USSD_PROFILES, activeProfile, loadUssd, saveUssd } from '../../engine/ussdSettings.js'
import { syncNow } from '../../engine/nativeSync.js'
import { applyUssdSettings } from '../../engine/native.js'

const BOLT = <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
const GAUGE = <><path d="M4 18a9 9 0 1 1 16 0" /><path d="M12 14l4-5" /></>
const TURBO = <><path d="M5 5l7 7-7 7" /><path d="M12 5l7 7-7 7" /></>
const TIMEOUTS = [
  { id: 'expressTimeoutSec', title: 'Express USSD', desc: 'Express mode wait', unit: 's', step: 5, min: 20, max: 120 },
  { id: 'advancedTimeoutSec', title: 'Advanced USSD', desc: 'Dialer mode wait per screen', unit: 's', step: 5, min: 10, max: 120 },
  { id: 'stepTimeoutMs', title: 'Step Timeout', desc: 'Max wait per step', unit: 'ms', step: 50, min: 50, max: 1000 },
]
const QUEUE = [
  { id: 'betweenMs', title: 'Between Transactions', desc: 'Delay after each USSD', unit: 'ms', step: 250, min: 0, max: 10000 },
]
const MORE = [
  { group: 'Timing', rows: [
    { id: 'executionDelayMs', title: 'Execution Delay', desc: 'Wait before starting', unit: 'ms', step: 50, min: 0, max: 5000 },
    { id: 'keyInputDelayMs', title: 'Key Input Delay', desc: 'Pause before Send', unit: 'ms', step: 10, min: 0, max: 500 },
    { id: 'initialDialDelayMs', title: 'Initial Dial Delay', desc: 'Before dialing', unit: 'ms', step: 50, min: 0, max: 5000 },
  ] },
  { group: 'Reliability', rows: [
    { id: 'okButtonDelayMs', title: 'OK Button Delay', desc: 'Before clicking OK', unit: 'ms', step: 10, min: 0, max: 1000 },
    { id: 'failureCheckDelayMs', title: 'Failure Check Delay', desc: 'After each step', unit: 'ms', step: 10, min: 0, max: 1000 },
    { id: 'screenStabilityMs', title: 'Screen Stability', desc: 'Wait for a stable screen', unit: 'ms', step: 50, min: 0, max: 2000 },
  ] },
  { group: 'Accessibility service', rows: [
    { id: 'cleanupDelayMs', title: 'Cleanup Delay', desc: 'After USSD completion', unit: 'ms', step: 50, min: 0, max: 3000 },
    { id: 'inputRetries', title: 'Input Retries', desc: 'Retry failed inputs', unit: '', step: 1, min: 0, max: 6 },
    { id: 'checkIntervalMs', title: 'Screen Check Interval', desc: 'How often the USSD window is checked', unit: 'ms', step: 10, min: 30, max: 1000 },
    { id: 'inputSearchMs', title: 'Input Field Search', desc: 'How long to look for the input box', unit: 'ms', step: 50, min: 50, max: 3000 },
    { id: 'rootNodeMs', title: 'Root Node Timeout', desc: '0 = auto, 400ms recommended', unit: 'ms', step: 50, min: 0, max: 2000 },
  ] },
]

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={`st-switch ${on ? 'on' : ''}`} onClick={onChange}>
      <span className="st-thumb" />
    </button>
  )
}

function Row({ title, desc, value, unit, step, min, max, onChange }) {
  return (
    <div className="us-tile">
      <div className="us-info"><strong>{title}</strong><small>{desc}</small></div>
      <div className="us-pill">
        <button type="button" className="us-pm" aria-label={`Lower ${title}`} disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span className="us-val">{value}{unit}</span>
        <button type="button" className="us-pm" aria-label={`Raise ${title}`} disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </div>
  )
}

export default function UssdSettingsPage({ onBack }) {
  const [saved, setSaved] = useState(loadUssd)
  const [draft, setDraft] = useState(loadUssd)
  const [view, setView] = useState('main')
  const [note, setNote] = useState('')
  const [warned, setWarned] = useState(false)
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  const profile = activeProfile(draft)

  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setNote(''); setWarned(false) }
  const rowEl = (r) => (
    <Row key={r.id} title={r.title} desc={r.desc} unit={r.unit} step={r.step} min={r.min} max={r.max}
      value={draft[r.id]} onChange={(v) => set({ [r.id]: v })} />
  )

  function back() {
    if (view === 'more') return setView('main')
    if (dirty && !warned) {
      setWarned(true)
      return setNote('You have unsaved changes. Tap back again to leave without saving.')
    }
    onBack()
  }
  function reset() {
    setDraft({ ...USSD_DEFAULTS })
    setNote('Reset to Quick. Tap Save to keep it.')
  }
  async function save() {
    if (!saveUssd(draft)) return setNote('Could not save on this device.')
    setSaved(draft)
    setWarned(false)
    await applyUssdSettings(draft)
    try { await syncNow(true) } catch (e) { /* the app copy is saved either way */ }
    setNote('Saved. New transactions follow these settings.')
  }

  return (
    <div className="us">
      <style>{`
        .us { --us-g: #2e9e45; padding: 0 2px 28px; }
        .us-head { display: flex; align-items: center; gap: 6px; padding: 4px 0 12px; }
        .us-title { flex: 1; min-width: 0; }
        .us-title h1 { margin: 0; font-size: 18px; font-weight: 700; line-height: 1.2; }
        .us-title small { display: block; margin-top: 2px; font-size: 11px; }
        .us-ico { width: 38px; height: 38px; border: 1.5px solid var(--st-border); border-radius: 50%; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; }
        .us-ico:hover { background: var(--st-hover); }
        .us-ico svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .us-save { border: 0; border-radius: 999px; background: var(--us-g); color: #fff; font: inherit; font-size: 13px; font-weight: 700; padding: 9px 18px; cursor: pointer; }
        .us-save:disabled { background: var(--st-hover); color: var(--st-soft); cursor: default; }
        .us-ico:focus-visible, .us-save:focus-visible, .us-bub:focus-visible, .us-pm:focus-visible, .us-more:focus-visible { outline: 2px solid var(--us-g); outline-offset: 2px; }

        .us-label { display: flex; align-items: center; gap: 8px; margin: 20px 4px 8px; font-size: 13px; font-weight: 700; color: var(--st-soft); }
        .us-label::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--us-g); }

.us-bubbles { display: flex; gap: 5px; flex-wrap: nowrap; }
.us-bub { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 4px; padding: 5px 6px 5px 4px; border: 1.5px solid var(--st-border); border-radius: 999px; background: var(--st-card); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.us-bub .ic { width: 18px; height: 18px; border-radius: 50%; background: var(--st-hover); display: grid; place-items: center; flex-shrink: 0; }
.us-bub .ic svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.us-bub > span:last-child { min-width: 0; }
.us-bub strong { display: block; font-size: 11.5px; line-height: 1.15; }
.us-bub small { display: block; font-size: 8px; line-height: 1.15; color: var(--st-soft); white-space: nowrap; }
        .us-bub.on { border-color: var(--us-g); background: var(--st-hover); }
        .us-bub.on .ic { background: var(--us-g); color: #fff; }
        .us-hint { display: block; margin: 6px 6px 0; font-size: 11px; }

        .us-tile { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px 10px 16px; margin-bottom: 8px; border: 1px solid var(--st-border); border-radius: 20px; background: var(--st-card); }
        .us-info { min-width: 0; flex: 1; }
        .us-info strong { display: block; font-size: 14px; font-weight: 600; }
        .us-info small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--st-soft); }
        .us-pill { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: var(--st-hover); flex-shrink: 0; }
        .us-pm { width: 30px; height: 30px; border: 0; border-radius: 50%; background: var(--st-card); color: inherit; font-size: 18px; line-height: 1; display: grid; place-items: center; cursor: pointer; }
        .us-pm:disabled { opacity: .3; cursor: default; }
        .us-val { min-width: 54px; text-align: center; font-size: 13px; font-weight: 700; }

        .us-more { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 18px; padding: 12px 16px; border: 1px solid var(--st-border); border-radius: 999px; background: var(--st-card); color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .us-more strong { display: block; font-size: 14px; }
        .us-more small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--st-soft); }
        .us-more svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .app .us p.us-note { margin: 4px 0 0; padding: 10px 14px; border-radius: 14px; background: var(--st-hover); font-size: 12.5px; }
      `}</style>

      <div className="us-head">
        <button className="us-ico" onClick={back} aria-label="Back">
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div className="us-title">
          <h1>{view === 'more' ? 'More Settings' : 'USSD Settings'}</h1>
          <small>{view === 'more' ? 'Fine tuning for this phone' : 'How Express and Advanced mode dial'}</small>
        </div>
        <button className="us-ico" onClick={reset} aria-label="Reset to Quick">
          <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
        </button>
        <button className="us-save" onClick={save} disabled={!dirty}>Save</button>
      </div>

      {note && <p className="us-note" role="status">{note}</p>}

      {view === 'main' && (
        <>
          <p className="us-label">Speed fix</p>
          <div className="us-bubbles" role="radiogroup" aria-label="Speed fix">
            {[['turbo', 'Turbo', TURBO, 'Strong network'], ['quick', 'Quick', BOLT, 'Good networks'], ['average', 'Average', GAUGE, 'Slower networks']].map(([id, label, icon, sub]) => (
              <button key={id} type="button" role="radio" aria-checked={profile === id}
                className={`us-bub ${profile === id ? 'on' : ''}`} onClick={() => set(USSD_PROFILES[id])}>
                <span className="ic"><svg viewBox="0 0 24 24">{icon}</svg></span>
                <span><strong>{label}</strong><small>{sub}</small></span>
              </button>
            ))}
          </div>
          {!profile && <small className="us-hint">Custom values</small>}

          <p className="us-label">Retry policy</p>
          <div className="us-tile">
            <div className="us-info"><strong>Auto Retry Failed</strong><small>Try again once when a USSD fails</small></div>
            <Switch on={draft.autoRetry} label="Auto Retry Failed" onChange={() => set({ autoRetry: !draft.autoRetry })} />
          </div>

          <p className="us-label">Timeouts</p>
          {TIMEOUTS.map(rowEl)}

          <p className="us-label">Queue processing</p>
          {QUEUE.map(rowEl)}

          <p className="us-label">Speed</p>
          <div className="us-tile">
            <div className="us-info"><strong>Quick Bingwa Offers</strong><small>Dial *180 offers up to the phone number in one go</small></div>
            <Switch on={draft.fasten} label="Quick Bingwa Offers" onChange={() => set({ fasten: !draft.fasten })} />
          </div>

          <button className="us-more" onClick={() => setView('more')}>
            <span><strong>More Settings</strong><small>Delays, reliability and accessibility</small></span>
            <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </>
      )}

      {view === 'more' && MORE.map((g) => (
        <div key={g.group}>
          <p className="us-label">{g.group}</p>
          {g.rows.map(rowEl)}
        </div>
      ))}
    </div>
  )
}