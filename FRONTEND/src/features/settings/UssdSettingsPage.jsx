import { useState } from 'react'
import { USSD_DEFAULTS, USSD_PROFILES, activeProfile, loadUssd, saveUssd } from '../../engine/ussdSettings.js'
import { syncNow } from '../../engine/nativeSync.js'
import { applyUssdSettings } from '../../engine/native.js'

const BOLT = <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
const GAUGE = <><path d="M4 18a9 9 0 1 1 16 0" /><path d="M12 14l4-5" /></>

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
    <div className="us-row">
      <div className="us-info"><strong>{title}</strong><small>{desc}</small></div>
      <div className="us-step">
        <button type="button" className="us-btn" aria-label={`Lower ${title}`} disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span className="us-val">{value}{unit}</span>
        <button type="button" className="us-btn" aria-label={`Raise ${title}`} disabled={value >= max}
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
        .us { padding: 0 2px 28px; }
        .us-head { display: flex; align-items: center; gap: 4px; padding: 2px 0 10px; border-bottom: 1px solid var(--st-border); }
        .us-title { flex: 1; min-width: 0; }
        .us-title h1 { margin: 0; font-size: 18px; font-weight: 700; line-height: 1.2; }
        .us-title small { display: block; margin-top: 2px; font-size: 11px; }
        .us-ico { width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; }
        .us-ico:hover { background: var(--st-hover); }
        .us-ico svg, .us-save svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .us-save { display: flex; align-items: center; gap: 6px; border: 0; border-radius: 10px; background: transparent; color: #2e9e45; font: inherit; font-size: 14px; font-weight: 700; padding: 8px 6px; cursor: pointer; }
        .us-save:disabled { opacity: .4; cursor: default; }
        .us-label { margin: 18px 4px 6px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #2e9e45; }
        .us-profiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .us-prof { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px; border: 2px solid var(--st-border); border-radius: 16px; background: var(--st-card); color: inherit; font: inherit; text-align: center; cursor: pointer; }
        .us-prof svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .us-prof strong { font-size: 14px; }
        .us-prof small { font-size: 11px; }
        .us-prof.on { border-color: #2e8b3d; background: var(--st-hover); }
        .us-prof.on svg { color: #2e8b3d; }
        .us-hint { display: block; margin: 6px 4px 0; font-size: 11px; }
        .us-card { border: 1px solid var(--st-border); border-radius: 16px; background: var(--st-card); overflow: hidden; }
        .us-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--st-border); }
        .us-row:first-child { border-top: 0; }
        .us-info { min-width: 0; }
        .us-info strong { display: block; font-size: 14px; font-weight: 600; }
        .us-info small { display: block; margin-top: 2px; font-size: 11.5px; }
        .us-step { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .us-btn { width: 34px; height: 34px; border: 0; border-radius: 50%; background: var(--st-hover); color: inherit; font-size: 20px; line-height: 1; display: grid; place-items: center; cursor: pointer; }
        .us-btn:disabled { opacity: .3; cursor: default; }
        .us-val { min-width: 56px; text-align: center; font-size: 13px; font-weight: 700; }
        .us-more { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 18px; padding: 14px; border: 1px solid var(--st-border); border-radius: 16px; background: var(--st-card); color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .us-more strong { display: block; font-size: 15px; }
        .us-more small { display: block; margin-top: 2px; font-size: 11.5px; }
        .us-more svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .app .us p.us-note { margin: 10px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--st-hover); font-size: 12.5px; }
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
        <button className="us-save" onClick={save} disabled={!dirty}>
          <svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h8V3" /><path d="M8 21v-7h8v7" /></svg>
          Save
        </button>
      </div>

      {note && <p className="us-note" role="status">{note}</p>}

      {view === 'main' && (
        <>
          <p className="us-label">Speed fix</p>
          <div className="us-profiles" role="radiogroup" aria-label="Speed fix">
            {[['quick', 'Quick', BOLT, 'Fastest, for good networks'], ['average', 'Average', GAUGE, 'Steadier, for slower networks']].map(([id, label, icon, sub]) => (
              <button key={id} type="button" role="radio" aria-checked={profile === id}
                className={`us-prof ${profile === id ? 'on' : ''}`} onClick={() => set(USSD_PROFILES[id])}>
                <svg viewBox="0 0 24 24">{icon}</svg>
                <strong>{label}</strong>
                <small>{sub}</small>
              </button>
            ))}
          </div>
          {!profile && <small className="us-hint">Custom values</small>}

          <p className="us-label">Retry policy</p>
          <div className="us-card">
            <div className="us-row">
              <div className="us-info"><strong>Auto Retry Failed</strong><small>Try again once when a USSD fails</small></div>
              <Switch on={draft.autoRetry} label="Auto Retry Failed" onChange={() => set({ autoRetry: !draft.autoRetry })} />
            </div>
          </div>

          <p className="us-label">Timeouts</p>
          <div className="us-card">{TIMEOUTS.map(rowEl)}</div>

          <p className="us-label">Queue processing</p>
          <div className="us-card">{QUEUE.map(rowEl)}</div>

          <p className="us-label">Speed</p>
          <div className="us-card">
            <div className="us-row">
              <div className="us-info"><strong>Fasten Bingwa offers</strong><small>Send the first steps of *180 offers together</small></div>
              <Switch on={draft.fasten} label="Fasten Bingwa offers" onChange={() => set({ fasten: !draft.fasten })} />
            </div>
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
          <div className="us-card">{g.rows.map(rowEl)}</div>
        </div>
      ))}
    </div>
  )
}