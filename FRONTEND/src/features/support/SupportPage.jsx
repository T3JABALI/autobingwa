import { useEffect, useRef, useState } from 'react'
import { loadProfile } from '../settings/SettingsPage.jsx'

const PHONE = '+254797411114'
const WHATSAPP = '254797411114'
const EMAIL = 'Hybrixprimeservices@gmail.com'

// The server address that receives chat messages for the admin dashboard.
// Leave it empty until the server route exists. The chat then shows "Not sent".
const SUPPORT_URL = ''

const THREAD_KEY = 'support:thread'
const DEVICE_KEY = 'support:deviceId'

const FAQ = [
  {
    q: 'A customer paid but the bundle was not sent',
    a: 'Open Transactions and tap the payment. If it shows Failed or Pending, press Retry. If the customer already got the bundle, press Complete so the record is correct. If it keeps failing, check your airtime balance and that automation is running.',
  },
  {
    q: 'Accessibility says enabled but automation does not run',
    a: 'Turn the Accessibility service for AutoBingwa off, then on again. Then close the app, open it, and hold the Start button for one second. Open Phone Setup in the menu for the full checklist.',
  },
  {
    q: 'Basic or Advanced mode: which should I use?',
    a: 'Advanced follows the USSD menus step by step and needs the Accessibility service turned on. Basic is simpler and does not need it. If your plans have several menu steps, use Advanced.',
  },
  {
    q: 'Transactions are queued but nothing is dialling',
    a: 'Check three things: automation is started (hold the Start button for 1 second), you have an active token, and the right SIM is chosen in Settings. Also make sure your SIM has airtime.',
  },
  {
    q: 'Do I need to keep the app open?',
    a: 'No, but do not swipe it away from recent apps. Leave automation running and allow the app to run in the background without battery limits in your phone settings.',
  },
  {
    q: 'My offers duplicated or went missing',
    a: 'Close the app fully and open it again, then check the Offers page. If an offer is still missing, add it again. If duplicates remain, delete the extra copy from the offer menu.',
  },
  {
    q: 'My tokens ran out. How do I top up?',
    a: 'Open Tokens from the menu or tap the Tokens card on Home, then choose a plan. If you have a coupon code, enter it on the same page to get a free token.',
  },
  {
    q: 'How do I stop a customer from buying?',
    a: 'Open the customer\u2019s transaction and tap Blacklist. Their future payments will not be processed. You can also select several transactions by pressing and holding a row.',
  },
]

const ICONS = {
  back: <path d="M15 5l-7 7 7 7" />,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  call: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  whatsapp: <><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 8 19.5z" /><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 .7c-.8-.4-1.6-1.2-2-2l.7-1-1-2z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  send: <><path d="M4 12l16-8-6 16-3-7z" /><path d="M11 13l9-9" /></>,
}
const Ic = ({ name, size = 22 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
)

const readThread = () => {
  try {
    const v = JSON.parse(localStorage.getItem(THREAD_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}
const writeThread = (list) => {
  try { localStorage.setItem(THREAD_KEY, JSON.stringify(list.slice(-100))) } catch (e) { /* storage full */ }
}
const deviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch (e) {
    return 'unknown'
  }
}

async function postToAdmin(text) {
  if (!SUPPORT_URL) throw new Error('not connected')
  const profile = loadProfile() || {}
  const res = await fetch(SUPPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId(), name: profile.fullName || '', text, at: Date.now() }),
  })
  if (!res.ok) throw new Error(`server ${res.status}`)
}

const fmtStamp = (ts) => {
  const d = new Date(ts)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

const CSS = `
.hs { display: grid; gap: 14px; padding: 6px 12px 28px; align-content: start; }
.hs-top { display: flex; align-items: center; gap: 10px; }
.hs-back { display: grid; place-items: center; width: 38px; height: 38px; border: 0; border-radius: 50%; background: transparent; color: var(--text); cursor: pointer; }
.hs-back:hover { background: var(--muted-bg); }
.hs-top h2 { margin: 0; font-size: 20px; line-height: 1.2; }
.hs-top small { display: block; color: var(--soft); font-size: 12px; }

.hs-chat-card { display: flex; align-items: center; gap: 14px; width: 100%; padding: 16px; border: 0; border-radius: 18px; background: var(--primary); color: var(--on-primary); font: inherit; text-align: left; cursor: pointer; box-shadow: var(--shadow); }
.hs-chat-ico { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; background: rgba(255, 255, 255, 0.2); flex-shrink: 0; }
.hs-chat-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.app .hs .hs-chat-card .hs-chat-title { display: block; font-size: 16px; font-weight: 800; color: var(--on-primary) !important; opacity: 1 !important; }
.app .hs .hs-chat-card .hs-chat-sub { display: block; font-size: 12.5px; font-weight: 500; line-height: 1.35; color: var(--on-primary) !important; opacity: 1 !important; }

.hs-label { margin: 4px 0 -4px; font-size: 12px; font-weight: 700; color: var(--soft); text-transform: uppercase; }
.hs-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.hs-tile { display: grid; justify-items: center; gap: 6px; padding: 14px 4px; border: 1px solid var(--border); border-radius: 16px; background: var(--card); color: var(--text); font: inherit; font-size: 12px; font-weight: 700; text-decoration: none; }
.hs-tile span.ic { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--muted-bg); color: var(--primary); }
.hs-tile small { color: var(--soft); font-size: 10px; font-weight: 500; }

.hs-faq { border: 1px solid var(--border); border-radius: 18px; background: var(--card); overflow: hidden; }
.hs-faq-item + .hs-faq-item { border-top: 1px solid var(--border); }
.hs-q { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 14px 16px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 14px; font-weight: 700; text-align: left; cursor: pointer; }
.hs-q svg { flex-shrink: 0; color: var(--soft); transition: transform 0.15s; }
.hs-faq-item.open .hs-q svg { transform: rotate(180deg); color: var(--primary); }
.hs-a { margin: 0; padding: 0 16px 16px; color: var(--soft); font-size: 13px; line-height: 1.6; }

.hs-thread { display: flex; flex-direction: column; gap: 8px; min-height: 240px; max-height: calc(100dvh - 250px); overflow-y: auto; padding: 4px 2px; overscroll-behavior: contain; }
.hs-empty { margin: auto; text-align: center; color: var(--soft); font-size: 13px; line-height: 1.6; padding: 20px; }
.hs-msg { align-self: flex-end; max-width: 82%; padding: 10px 12px; border-radius: 16px 16px 4px 16px; background: var(--primary); color: var(--on-primary); font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.hs-msg.failed { background: var(--danger-bg); color: var(--text); border: 1px solid var(--danger); }
.hs-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 10px; opacity: 0.85; }
.hs-meta button { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
.hs-compose { display: flex; align-items: flex-end; gap: 8px; }
.hs-compose textarea { flex: 1; min-width: 0; box-sizing: border-box; padding: 12px; border: 1px solid var(--border); border-radius: 16px; background: var(--card); color: var(--text); font: inherit; font-size: 15px; resize: none; }
.hs-send { display: grid; place-items: center; width: 46px; height: 46px; flex-shrink: 0; border: 0; border-radius: 50%; background: var(--primary); color: var(--on-primary); cursor: pointer; }
.hs-send:disabled { opacity: 0.45; cursor: not-allowed; }
.hs-note { margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--muted-bg); color: var(--text); font-size: 12px; line-height: 1.5; }
`

export default function SupportPage({ onBack }) {
  const [view, setView] = useState('main')
  const [openQ, setOpenQ] = useState(-1)
  const [thread, setThread] = useState(readThread)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    if (view === 'chat' && endRef.current) endRef.current.scrollIntoView({ block: 'end' })
  }, [thread, view])

  function update(list) {
    setThread(list)
    writeThread(list)
  }

  async function deliver(id, body) {
    setBusy(true)
    setNote('')
    try {
      await postToAdmin(body)
      update(readThread().map((m) => (m.id === id ? { ...m, status: 'sent' } : m)))
    } catch (e) {
      update(readThread().map((m) => (m.id === id ? { ...m, status: 'failed' } : m)))
      setNote(
        SUPPORT_URL
          ? 'Could not send. Check your internet and tap Retry.'
          : 'Could not send: chat is not connected to the server yet. Please call or use WhatsApp for now.'
      )
    } finally {
      setBusy(false)
    }
  }

  function send() {
    const body = text.trim()
    if (!body || busy) return
    const msg = { id: Date.now(), text: body, at: Date.now(), status: 'sending' }
    update([...readThread(), msg])
    setText('')
    deliver(msg.id, body)
  }

  function retry(m) {
    if (busy) return
    update(readThread().map((x) => (x.id === m.id ? { ...x, status: 'sending' } : x)))
    deliver(m.id, m.text)
  }

  const goBack = () => (view === 'chat' ? setView('main') : onBack && onBack())

  return (
    <div className="hs">
      <style>{CSS}</style>

      <div className="hs-top">
        <button className="hs-back" onClick={goBack} aria-label="Back"><Ic name="back" /></button>
        <div>
          <h2>{view === 'chat' ? 'Chat with support' : 'Help & Support'}</h2>
          <small>{view === 'chat' ? 'Your message goes straight to our team' : 'Answers, or a human when you need one'}</small>
        </div>
      </div>

      {view === 'main' && (
        <>
          <button className="hs-chat-card" onClick={() => { setNote(''); setView('chat') }}>
            <span className="hs-chat-ico"><Ic name="chat" size={24} /></span>
            <span className="hs-chat-text">
              <span className="hs-chat-title">Chat with support</span>
              <span className="hs-chat-sub">Send us a message. We usually reply the same day</span>
            </span>
            <Ic name="chevron" />
          </button>

          <p className="hs-label">Reach us directly</p>
          <div className="hs-tiles">
            <a className="hs-tile" href={`tel:${PHONE}`}>
              <span className="ic"><Ic name="call" /></span>
              Call us
              <small>{PHONE}</small>
            </a>
            <a className="hs-tile" href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer">
              <span className="ic"><Ic name="whatsapp" /></span>
              WhatsApp
              <small>Text us</small>
            </a>
            <a className="hs-tile" href={`mailto:${EMAIL}`}>
              <span className="ic"><Ic name="mail" /></span>
              Email us
              <small>We read all mail</small>
            </a>
          </div>

          <p className="hs-label">Common questions</p>
          <div className="hs-faq">
            {FAQ.map((item, i) => (
              <div key={item.q} className={`hs-faq-item ${openQ === i ? 'open' : ''}`}>
                <button className="hs-q" onClick={() => setOpenQ(openQ === i ? -1 : i)} aria-expanded={openQ === i}>
                  <span>{item.q}</span>
                  <Ic name="down" size={20} />
                </button>
                {openQ === i && <p className="hs-a">{item.a}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'chat' && (
        <>
          <div className="hs-thread">
            {thread.length === 0 ? (
              <p className="hs-empty">
                No messages yet.<br />
                Tell us what happened and include the customer's phone number if it is about a payment.
              </p>
            ) : (
              thread.map((m) => (
                <div key={m.id} className={`hs-msg ${m.status === 'failed' ? 'failed' : ''}`}>
                  {m.text}
                  <div className="hs-meta">
                    <span>{fmtStamp(m.at)}</span>
                    <span>
                      {m.status === 'sent' ? 'Sent' : m.status === 'sending' ? 'Sending…' : 'Not sent'}
                    </span>
                    {m.status === 'failed' && <button onClick={() => retry(m)}>Retry</button>}
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          {note && <p className="hs-note" role="status">{note}</p>}

          <div className="hs-compose">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your message"
              aria-label="Message to support"
            />
            <button className="hs-send" onClick={send} disabled={busy || !text.trim()} aria-label="Send">
              <Ic name="send" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}