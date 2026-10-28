import { useState } from 'react'

const ID_KEY = 'connect:id'
const LIVE_KEY = 'connect:live'
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

export default function ConnectPage({ onBack }) {
  const [connectId, setConnectId] = useState(() => readText(ID_KEY))
  const [live, setLive] = useState(() => readText(LIVE_KEY) === '1' && Boolean(readText(ID_KEY)))
  const [notice, setNotice] = useState('')

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
    setLive(next)
    writeText(LIVE_KEY, next ? '1' : '0')
    setNotice(next ? 'Connect is live' : 'Connect is disabled')
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
        .cn-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--cn-bad); }
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
      `}</style>

      <div className="cn-inner">
        <div className="cn-head">
          <button className="cn-icon" onClick={onBack} aria-label="Go back">
            <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h1>Autobingwa Connect</h1>
        </div>

        <div className="cn-status">
          <span>{live ? 'Connected' : 'Disconnected'}</span>
          <span className={`cn-dot ${live ? 'on' : ''}`} aria-hidden="true" />
          <button
            type="button"
            role="switch"
            aria-checked={live}
            aria-label={live ? 'Disable Connect' : 'Make Connect live'}
            className={`cn-switch ${live ? 'on' : ''}`}
            onClick={toggleLive}
          >
            <span className="cn-thumb" />
          </button>
        </div>

        {notice && <p className="cn-note" role="status">{notice}</p>}

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