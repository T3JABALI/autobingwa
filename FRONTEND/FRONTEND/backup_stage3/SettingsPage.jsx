import { useRef, useState } from 'react'
import { normalizePhone } from "../../engine/engine.js";
import { PROFILE_KEY, CONFIG_KEY, CLIENTS_KEY, readJson, writeJson, loadConfig, savedContactName } from "../../engine/config.js";


// Other pages import these from here, so they stay available
export { loadConfig, savedContactName }

const MODES = [
  { id: 'Express', label: 'Express Mode', desc: 'Processes USSDs that can be completed in one request' },
  { id: 'Advanced', label: 'Advanced Mode', desc: 'Processes USSDs that require multiple steps to complete' },
]

// ---- Helpers other pages can import ----
export function loadProfile() {
  return { fullName: '', phone: '', business: '', photo: '', ...readJson(PROFILE_KEY, {}) }
}

export function loadMode() {
  return loadConfig().mode
}

export function isPortalOn() {
  return loadConfig().portal
}

// Time-of-day greeting from the device clock, so it follows the timezone.
export function greetingFor(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export function firstNameOf(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || ''
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : ''
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('image'))
      img.onload = () => {
        const size = 256
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={`st-switch ${on ? 'on' : ''}`} onClick={onChange}>
      <span className="st-thumb" />
    </button>
  )
}

export default function SettingsPage({ onBack, onProfileChange, onModeChange }) {
  const [screen, setScreen] = useState('main')
  const [profile, setProfile] = useState(loadProfile)
  const [config, setConfig] = useState(loadConfig)
  const [form, setForm] = useState(profile)
  const [blocked, setBlocked] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const galleryRef = useRef(null)
  const cameraRef = useRef(null)

  function updateConfig(patch) {
    const next = { ...config, ...patch }
    setConfig(next)
    writeJson(CONFIG_KEY, next)
  }

  // One SIM runs payments, USSD, airtime balance and commission. One SIM sends replies.
  function chooseSim(field, sim) {
    if (field === 'bingwaSim') {
      updateConfig({ bingwaSim: sim, receiveSims: [sim], ussdSims: [sim] })
      setNotice(`${sim} will receive payments, run USSDs and read airtime and commission`)
    } else {
      updateConfig({ replySim: sim, replySims: [sim] })
      setNotice(`${sim} will send auto-replies`)
    }
  }

  function chooseMode(id) {
    updateConfig({ mode: id })
    if (onModeChange) onModeChange(id)
    setNotice(`${id} Mode selected`)
  }

  function openEdit() {
    setForm(profile)
    setError('')
    setNotice('')
    setScreen('edit')
  }

  async function pickPhoto(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Choose an image file')
    try {
      const photo = await compressPhoto(file)
      setForm((f) => ({ ...f, photo }))
      setError('')
    } catch (err) {
      setError('Could not read that photo. Try another one.')
    }
  }

  function saveProfile() {
    const fullName = form.fullName.trim()
    if (!fullName) return setError('Enter your full name')
    let phone = ''
    if (form.phone.trim()) {
      const n = normalizePhone(form.phone)
      if (!n || n.masked) return setError('Enter a valid phone number, e.g. 0712345678')
      phone = n.phone
    }
    const next = { fullName, phone, business: form.business.trim(), photo: form.photo }
    if (!writeJson(PROFILE_KEY, next)) return setError('Could not save. The photo may be too large.')
    setProfile(next)
    if (onProfileChange) onProfileChange(next)
    setNotice('Profile saved')
    setScreen('main')
  }

  function openBlacklist() {
    setBlocked(readJson(CLIENTS_KEY, []).filter((c) => c.blacklisted))
    setNotice('')
    setScreen('blacklist')
  }

  function unblock(client) {
    const all = readJson(CLIENTS_KEY, []).map((c) => (c.id === client.id ? { ...c, blacklisted: false } : c))
    writeJson(CLIENTS_KEY, all)
    setBlocked(all.filter((c) => c.blacklisted))
    setNotice(`${client.name} unblocked`)
  }

  const blockedCount = readJson(CLIENTS_KEY, []).filter((c) => c.blacklisted).length
  const suffix = config.saveSuffix.trim()
  const displayName = profile.fullName || 'Add your name'

  const simPicker = (title, desc, field) => (
    <>
      <h3 className="st-sub">{title}</h3>
      {desc && <p className="st-desc">{desc}</p>}
      <div role="radiogroup" aria-label={title}>
        {['SIM 1', 'SIM 2'].map((sim) => (
          <button key={sim} role="radio" aria-checked={config[field] === sim}
            className={`st-radio ${config[field] === sim ? 'on' : ''}`} onClick={() => chooseSim(field, sim)}>
            <span className="st-dot" />
            <span><strong>{sim}</strong></span>
          </button>
        ))}
      </div>
    </>
  )

  const toggleRow = (label, field) => (
    <div className="st-row">
      <span className="st-row-label">{label}</span>
      <Switch on={config[field]} onChange={() => updateConfig({ [field]: !config[field] })} label={label} />
    </div>
  )

  return (
    <div className="st-page">
      <style>{`
        .st-page {
          --st-accent: var(--accent-color, #1F5EFF);
          --st-card: var(--card-bg, #FFFFFF);
          --st-border: var(--border-color, #D5DDF0);
          --st-soft: var(--muted-text, #4A5568);
          --st-hover: var(--muted-bg, #E6EDFF);
          --st-on: var(--on-primary, #FFFFFF);
          --st-bad: var(--danger, #D32F2F);
          width: 100%; box-sizing: border-box; padding: 4px 4px 40px;
        }
        .st-inner { max-width: 560px; margin: 0 auto; }
        .st-head { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
        .st-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .st-icon {
          width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; display: grid; place-items: center; flex-shrink: 0;
        }
        .st-icon:hover { background: var(--st-hover); }
        .st-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .st-icon:focus-visible, .st-btn:focus-visible, .st-switch:focus-visible, .st-link:focus-visible,
        .st-radio:focus-visible, .st-chip:focus-visible { outline: 2px solid var(--st-accent); outline-offset: 3px; }
        .st-profile { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--st-border); }
        .st-avatar {
          width: 76px; height: 76px; border-radius: 50%; background: var(--st-hover); color: var(--st-soft);
          display: grid; place-items: center; overflow: hidden; flex-shrink: 0;
        }
        .st-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .st-avatar svg { width: 44px; height: 44px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
        .st-who { flex: 1; min-width: 0; }
        .st-who strong { display: block; font-size: 19px; overflow-wrap: anywhere; }
        .st-who span { display: block; color: var(--st-soft); font-size: 14px; margin-top: 3px; overflow-wrap: anywhere; }
        .st-section { margin: 30px 0 6px; font-size: 22px; font-weight: 800; color: var(--st-accent); }
        .st-sub { margin: 20px 0 4px; font-size: 16px; font-weight: 600; }
        .st-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; }
        .st-row-label { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 16px; }
        .st-switch {
          width: 56px; height: 32px; padding: 0; border-radius: 999px; cursor: pointer; position: relative; flex-shrink: 0;
          border: 2px solid var(--st-border); background: var(--st-hover); transition: background 160ms ease, border-color 160ms ease;
        }
        .st-thumb {
          position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: 50%;
          background: var(--st-soft); transition: transform 160ms ease, background 160ms ease;
        }
        .st-switch.on { background: var(--st-accent); border-color: var(--st-accent); }
        .st-switch.on .st-thumb { transform: translateX(24px); background: var(--st-on); }
        @media (prefers-reduced-motion: reduce) { .st-switch, .st-thumb { transition: none; } }
        .st-note { margin: 0 0 14px; padding: 12px 14px; border-radius: 10px; background: var(--st-hover); font-size: 14px; }
        .st-desc { margin: -4px 0 0; color: var(--st-soft); font-size: 14px; line-height: 1.5; }
        .st-link {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 14px 0;
          border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 8px;
        }
        .st-link strong { display: block; font-size: 16px; }
        .st-link span.d { display: block; margin-top: 4px; color: var(--st-soft); font-size: 14px; }
        .st-link svg { width: 24px; height: 24px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .st-field {
          width: 100%; box-sizing: border-box; margin-top: 8px; padding: 15px; border: 2px solid var(--st-border);
          border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .st-field:focus { border-color: var(--st-accent); }
        .st-label { display: block; margin-top: 18px; font-weight: 600; font-size: 14px; }
        .st-preview { margin: 10px 0 0; padding: 12px 14px; border-radius: 10px; background: var(--st-hover); font-size: 14px; }
        .st-radio {
          display: flex; align-items: flex-start; gap: 16px; width: 100%; padding: 14px 4px; border: 0;
          background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 10px;
        }
        .st-dot {
          width: 26px; height: 26px; border-radius: 50%; border: 3px solid var(--st-border); flex-shrink: 0; margin-top: 2px;
          display: grid; place-items: center;
        }
        .st-radio.on .st-dot { border-color: var(--st-accent); }
        .st-radio.on .st-dot::after { content: ''; width: 12px; height: 12px; border-radius: 50%; background: var(--st-accent); }
        .st-radio strong { display: block; font-size: 17px; }
        .st-radio span.d { display: block; margin-top: 4px; color: var(--st-soft); font-size: 14px; line-height: 1.5; }
        .st-btn {
          display: block; width: 100%; margin-top: 22px; padding: 19px 0; border: 0; border-radius: 999px;
          background: var(--st-accent); color: var(--st-on); font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
        }
        .st-btn:hover { filter: brightness(1.08); }
        .st-btn.ghost { background: transparent; color: inherit; border: 2px solid var(--st-border); margin-top: 12px; }
        .st-err { color: var(--st-bad); font-weight: 600; font-size: 14px; margin: 14px 0 0; }
        .st-photo { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 8px 0 8px; }
        .st-photo .st-avatar { width: 110px; height: 110px; }
        .st-chips { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
        .st-chip {
          padding: 10px 16px; border: 2px solid var(--st-border); border-radius: 999px; background: transparent;
          color: inherit; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .st-block { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--st-border); border-radius: 14px; background: var(--st-card); margin-top: 10px; }
        .st-block-info { flex: 1; min-width: 0; }
        .st-block-info strong { display: block; overflow-wrap: anywhere; }
        .st-block-info span { color: var(--st-soft); font-size: 14px; }
        .st-empty { text-align: center; color: var(--st-soft); padding: 30px 12px; }
      `}</style>

      <div className="st-inner">
        {screen === 'main' && (
          <>
            <div className="st-head">
              <button className="st-icon" onClick={onBack} aria-label="Go back">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <h1>Settings</h1>
            </div>

            <div className="st-profile">
              <div className="st-avatar">
                {profile.photo ? (
                  <img src={profile.photo} alt="Your profile" />
                ) : (
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
                )}
              </div>
              <div className="st-who">
                <strong>{displayName}</strong>
                {profile.business && <span>{profile.business}</span>}
                {profile.phone && <span>{profile.phone}</span>}
              </div>
              <button className="st-icon" onClick={openEdit} aria-label="Edit profile" title="Edit profile">
                <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              </button>
            </div>

            {notice && <p className="st-note" role="status" style={{ marginTop: 16 }}>{notice}</p>}

            <h2 className="st-section">SIM Setup</h2>
            {simPicker(
              'Bingwa SIM',
              'Receives payments and runs USSDs. Airtime balance and Safaricom commission messages are read from this SIM.',
              'bingwaSim',
            )}
            {simPicker('Send Auto-Replies Using', 'This SIM sends every message the app sends.', 'replySim')}

            <h2 className="st-section">Message Processing</h2>
            {toggleRow('Process M-Pesa Messages', 'processMpesa')}
            {toggleRow('Process Till Messages', 'processTill')}
            {toggleRow('Process Paybill Messages', 'processPaybill')}
            {toggleRow('Process SiteLink Messages', 'processSitelink')}

            <h2 className="st-section">My Customers</h2>
            {toggleRow('Auto-Save Contacts', 'autoSave')}
            {config.autoSave && (
              <div>
                <label className="st-label" htmlFor="st-suffix">Common ending for saved names</label>
                <input id="st-suffix" className="st-field" value={config.saveSuffix} maxLength={30}
                  placeholder="e.g. AutoBingwa"
                  onChange={(e) => updateConfig({ saveSuffix: e.target.value })} />
                <p className="st-preview">
                  Every customer is saved to your phone as: <strong>Faith Simiyu{suffix ? ` ${suffix}` : ''}</strong>
                </p>
              </div>
            )}
            <button className="st-link" onClick={openBlacklist}>
              <span>
                <strong>BlackList ({blockedCount})</strong>
                <span className="d">Blacklisted customers are not processed and not saved to contacts</span>
              </span>
              <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
            </button>

            <h2 className="st-section">AutoBingwa Portal</h2>
            <div className="st-row">
              <span>
                <span className="st-row-label">AutoBingwa Portal</span>
                <p className="st-desc">View and manage transactions remotely</p>
              </span>
              <Switch on={config.portal} onChange={() => updateConfig({ portal: !config.portal })}
                label="AutoBingwa Portal" />
            </div>
            {!config.portal && (
              <p className="st-desc">Switch this on first. The portal will not work while it is off.</p>
            )}

            <h2 className="st-section">Processing Mode</h2>
            <div role="radiogroup" aria-label="Processing mode">
              {MODES.map((m) => (
                <button key={m.id} role="radio" aria-checked={config.mode === m.id}
                  className={`st-radio ${config.mode === m.id ? 'on' : ''}`} onClick={() => chooseMode(m.id)}>
                  <span className="st-dot" />
                  <span>
                    <strong>{m.label}</strong>
                    <span className="d">{m.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {screen === 'edit' && (
          <>
            <div className="st-head">
              <button className="st-icon" onClick={() => setScreen('main')} aria-label="Back to settings">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <h1>Edit profile</h1>
            </div>

            <div className="st-photo">
              <div className="st-avatar">
                {form.photo ? (
                  <img src={form.photo} alt="Profile preview" />
                ) : (
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
                )}
              </div>
              <div className="st-chips">
                <button className="st-chip" onClick={() => galleryRef.current && galleryRef.current.click()}>
                  Choose from gallery
                </button>
                <button className="st-chip" onClick={() => cameraRef.current && cameraRef.current.click()}>
                  Take photo
                </button>
                {form.photo && (
                  <button className="st-chip" onClick={() => setForm({ ...form, photo: '' })}>Remove</button>
                )}
              </div>
              <input ref={galleryRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
            </div>

            <label className="st-label" htmlFor="st-name">Full name</label>
            <input id="st-name" className="st-field" value={form.fullName} placeholder="e.g. Jabali Otieno"
              onChange={(e) => setForm({ ...form, fullName: e.target.value })} />

            <label className="st-label" htmlFor="st-phone">Phone number</label>
            <input id="st-phone" className="st-field" type="tel" inputMode="tel" value={form.phone}
              placeholder="e.g. 0712345678"
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />

            <label className="st-label" htmlFor="st-biz">Business name (optional)</label>
            <input id="st-biz" className="st-field" value={form.business} placeholder="e.g. AutoBingwa"
              onChange={(e) => setForm({ ...form, business: e.target.value })} />

            {error && <p className="st-err" role="alert">{error}</p>}

            <button className="st-btn" onClick={saveProfile}>Save profile</button>
            <button className="st-btn ghost" onClick={() => setScreen('main')}>Cancel</button>
          </>
        )}

        {screen === 'blacklist' && (
          <>
            <div className="st-head">
              <button className="st-icon" onClick={() => setScreen('main')} aria-label="Back to settings">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <h1>BlackList ({blocked.length})</h1>
            </div>
            <p className="st-desc">Blacklisted customers are not processed and not saved to contacts.</p>
            {notice && <p className="st-note" role="status" style={{ marginTop: 14 }}>{notice}</p>}
            {blocked.length === 0 ? (
              <p className="st-empty">No blocked contacts. Block a client from the Clients page and they will appear here.</p>
            ) : (
              blocked.map((c) => (
                <div className="st-block" key={c.id}>
                  <div className="st-block-info">
                    <strong>{c.name}</strong>
                    <span>{c.phone}</span>
                  </div>
                  <button className="st-chip" onClick={() => unblock(c)}>Unblock</button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}