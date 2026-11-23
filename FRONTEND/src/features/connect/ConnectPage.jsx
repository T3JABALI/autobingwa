import { useEffect, useState } from 'react'
import { loadConfig, setPortal } from '../../engine/config.js'
import { getPairing, PAIR_EVENT } from './pairing.js'

const ID_KEY = 'connect:id'
const ISSUED_KEY = 'connect:issued'
// No 0/O or 1/I so IDs are easy to read out and type.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function readText(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch (e) {
    console.error('Could not read ' + key, e)
    return ''
  }
}

function writeText(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    console.error('Could not save ' + key, e)
  }
}

function issuedIds() {
  try {
    const v = JSON.parse(localStorage.getItem(ISSUED_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

function randomCode(length) {
  const bytes = new Uint32Array(length)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join('')
}

// Creates a new AUB-XXXXX id that has not been issued on this device before.
export function generateConnectId() {
  const used = issuedIds()
  let id = ''
  for (let i = 0; i < 50; i++) {
    id = 'AUB-' + randomCode(5)
    if (!used.includes(id)) break
  }
  writeText(ISSUED_KEY, JSON.stringify([...used, id]))
  return id
}

// Read the saved id from other pages: getConnectId()
export function getConnectId() {
  return readText(ID_KEY)
}

export default function ConnectPage({ onBack, onScan }) {
  const [connectId, setConnectId] = useState(() => readText(ID_KEY))
  const [live, setLive] = useState(
    () => Boolean(loadConfig().portal) && Boolean(readText(ID_KEY))
  )
  const [notice, setNotice] = useState('')
  const [pair, setPair] = useState(() => getPairing())

  // Follows the pairing with a Connect phone
  useEffect(() => {
    const sync = () => setPair(getPairing())
    window.addEventListener(PAIR_EVENT, sync)
    return () => window.removeEventListener(PAIR_EVENT, sync)
  }, [])

  // Follows the Settings switch and the portal
  useEffect(() => {
    const sync = () =>
      setLive(Boolean(loadConfig().portal) && Boolean(readText(ID_KEY)))
    window.addEventListener('ab-connect', sync)
    return () => window.removeEventListener('ab-connect', sync)
  }, [])

  // Sends the person to Home, where the QR scanner opens by itself
  function scan() {
    try { sessionStorage.setItem('ab-scan-pair', '1') } catch (e) { /* ignore */ }
    if (onScan) onScan()
  }

  function handleGenerate() {
    const id = generateConnectId()
    writeText(ID_KEY, id)
    setConnectId(id)
    setNotice('Your Connect ID is ready')
  }

  function toggleLive() {
    if (!connectId) {
      setNotice('Generate your Connect ID first')
      return
    }
    const next = !live
    setPortal(next)
    setLive(next)
    setNotice(next ? 'Portal is on' : 'Portal is off')
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(connectId)
      setNotice('Connect ID copied')
    } catch (e) {
      const box = document.createElement('textarea')
      box.value = connectId
      document.body.appendChild(box)
      box.select()
      try {
        document.execCommand('copy')
        setNotice('Connect ID copied')
      } catch (err) {
        setNotice('Could not copy. Select the ID and copy it by hand.')
      }
      box.remove()
    }
  }

  async function shareId() {
    const text = `Join me on Autobingwa Connect. My Connect ID is ${connectId}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Autobingwa Connect ID', text })
      } catch (e) {
        if (e && e.name !== 'AbortError') setNotice('Could not open sharing')
      }
    } else {
      try {
        await navigator.clipboard.writeText(text)
        setNotice('Sharing is not available here, so the message was copied')
      } catch (e) {
        setNotice('Sharing is not available on this device')
      }
    }
  }

  return (
    <div className="cn-page">
      <style>{`
        .cn-page {
          --cn-accent: var(--accent-color, #1F5EFF);
          --cn-card: var(--card-bg, #FFFFFF);
          --cn-border: var(--border-color, #D5DDF0);
          --cn-soft: var(--muted-text, #4A5568);
          --cn-hover: var(--muted-bg, #E6EDFF);
          --cn-on: var(--on-primary, #FFFFFF);
          --cn-ok: var(--success, #0A7D4B);
          --cn-bad: var(--danger, #D32F2F);
          width: 100%; box-sizing: border-box; padding: 4px 4px 32px;
        }
        .cn-inner { max-width: 520px; margin: 0 auto; min-height: 70vh; display: flex; flex-direction: column; }
        .cn-head { display: flex; align-items: center; gap: 8px; }
        .cn-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .cn-icon {
          width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; display: grid; place-items: center; flex-shrink: 0;
        }
        .cn-icon:hover { background: var(--cn-hover); }
        .cn-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .cn-icon:focus-visible, .cn-btn:focus-visible, .cn-switch:focus-visible { outline: 2px solid var(--cn-accent); outline-offset: 3px; }
        .cn-status { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 18px; font-size: 14px; font-weight: 600; }
        .cn-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--cn-bad); flex-shrink: 0; }
        .cn-dot.on { background: var(--cn-ok); }
        .cn-switch {
          width: 58px; height: 32px; padding: 0; border-radius: 999px; cursor: pointer; position: relative;
          border: 2px solid var(--cn-border); background: var(--cn-hover); transition: background 160ms ease, border-color 160ms ease;
        }
        .cn-thumb {
          position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
          background: var(--cn-soft); transition: transform 160ms ease, background 160ms ease;
        }
        .cn-switch.on { background: var(--cn-accent); border-color: var(--cn-accent); }
        .cn-switch.on .cn-thumb { transform: translateX(26px); background: var(--cn-on); }
        @media (prefers-reduced-motion: reduce) { .cn-switch, .cn-thumb { transition: none; } }
        .cn-note { margin: 16px 0 0; padding: 12px 14px; border-radius: 10px; background: var(--cn-hover); font-size: 14px; }
        .cn-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 24px 8px; }
        .cn-text { font-size: 17px; line-height: 1.7; margin: 0; }
        .cn-label { color: var(--cn-soft); font-size: 15px; margin: 0 0 8px; }
        .cn-id-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .cn-id { font-size: 32px; font-weight: 800; letter-spacing: 0.04em; margin-right: 8px; overflow-wrap: anywhere; }
        .cn-hint { color: var(--cn-soft); font-size: 14px; margin: 18px 0 0; line-height: 1.6; }
        .cn-btn {
          display: block; width: 100%; padding: 22px 0; border: 0; border-radius: 999px;
          background: var(--cn-accent); color: var(--cn-on); font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
        }
        .cn-btn:hover { filter: brightness(1.08); }
        .cn-pair { margin-top: 18px; padding: 16px; border-radius: 14px; border: 1px solid var(--cn-border); background: var(--cn-card); display: grid; gap: 12px; }
        .cn-pair-top { display: flex; align-items: center; gap: 10px; font-size: 16px; }
        .cn-btn-ok { background: var(--cn-ok); cursor: default; }
        .cn-btn-ok:hover { filter: none; }
      `}</style>

      <div className="cn-inner">
        <div className="cn-head">
          <button className="cn-icon" onClick={onBack} aria-label="Go back">
            <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h1>Autobingwa Connect</h1>
        </div>

        <div className="cn-status">
          <span>{live ? 'Portal on' : 'Portal off'}</span>
          <span className={`cn-dot ${live ? 'on' : ''}`} aria-hidden="true" />
          <button
            type="button"
            role="switch"
            aria-checked={live}
            aria-label={live ? 'Turn the portal off' : 'Turn the portal on'}
            className={`cn-switch ${live ? 'on' : ''}`}
            onClick={toggleLive}
          >
            <span className="cn-thumb" />
          </button>
        </div>

        {notice && <p className="cn-note" role="status">{notice}</p>}

        <div className="cn-pair">
          <div className="cn-pair-top">
            <span className={`cn-dot ${pair ? 'on' : ''}`} aria-hidden="true" />
            <b>{pair ? 'Connected to Connect' : 'Not connected to Connect'}</b>
          </div>
          <p className="cn-hint" style={{ margin: 0 }}>
            {pair
              ? `Linked with your Connect account since ${new Date(pair.pairedAt).toLocaleDateString()}.`
              : 'Open the Pair screen on your Connect phone, then scan its QR code here.'}
          </p>
          {pair ? (
            <button className="cn-btn cn-btn-ok" disabled>Connected ✓</button>
          ) : (
            <button className="cn-btn" onClick={scan}>Connect</button>
          )}
        </div>

        <div className="cn-body">
          {connectId ? (
            <>
              <p className="cn-label">Your Connect ID</p>
              <div className="cn-id-row">
                <span className="cn-id">{connectId}</span>
                <button className="cn-icon" onClick={copyId} aria-label="Copy Connect ID" title="Copy">
                  <svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                </button>
                <button className="cn-icon" onClick={shareId} aria-label="Share Connect ID" title="Share">
                  <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" /></svg>
                </button>
              </div>
              <p className="cn-hint">
                Share this ID with your team so they can connect to this device. For best performance, keep this device on WiFi or a WiFi hotspot.
              </p>
            </>
          ) : (
            <p className="cn-text">
              Connect multiple devices with Autobingwa Connect. For best performance, make sure this device is connected to WiFi or WiFi Hotspot.
            </p>
          )}
        </div>

        {!connectId && (
          <button className="cn-btn" onClick={handleGenerate}>
            Generate Connect ID
          </button>
        )}
      </div>
    </div>
  )
}