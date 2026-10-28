import { useEffect, useState } from 'react'
import { parsePhone } from '../quickdial/ussd'

const KEY = 'clients:list'
const DAY = 24 * 60 * 60 * 1000

// ---- Change these numbers to change the category rules ----
const AT_RISK_MIN_DAYS = 2   // at risk starts after this many days of silence
const AT_RISK_MAX_DAYS = 3   // 4+ days is treated as churned, so not "at risk"
const NEW_DAYS = 7           // "New Last 7 Days"
const RETURNING_MIN_PURCHASES = 2
const RETURNING_ACTIVE_DAYS = 7

const TABS = [
  { id: 'all', label: 'All Clients' },
  { id: 'today', label: 'New Today' },
  { id: 'week', label: 'New Last 7 Days' },
  { id: 'risk', label: 'At risk' },
  { id: 'returning', label: 'Returning' },
]

function loadClients() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch (e) {
    console.error('Could not read clients', e)
    return []
  }
}

function saveClients(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Could not save clients', e)
  }
}

// Call this from your transaction code later:
//   recordClientPurchase('0712345678', 50)
export function recordClientPurchase(phone, amount, name = '') {
  const clean = parsePhone(String(phone || ''))
  if (!clean) return
  const list = loadClients()
  const now = Date.now()
  let client = list.find((c) => c.phone === clean)
  if (!client) {
    client = {
      id: now + Math.random(),
      name: name || clean,
      phone: clean,
      createdAt: now,
      lastActive: now,
      totalSpent: 0,
      purchases: 0,
      blacklisted: false,
    }
    list.push(client)
  }
  client.totalSpent += Number(amount) || 0
  client.purchases += 1
  client.lastActive = now
  saveClients(list)
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function matches(client, tab, now) {
  const idleDays = (now - client.lastActive) / DAY
  switch (tab) {
    case 'today':
      return client.createdAt >= startOfToday()
    case 'week':
      return now - client.createdAt <= NEW_DAYS * DAY
    case 'risk':
      return (
        client.purchases > 0 &&
        idleDays >= AT_RISK_MIN_DAYS &&
        idleDays < AT_RISK_MAX_DAYS + 1
      )
    case 'returning':
      return client.purchases >= RETURNING_MIN_PURCHASES && idleDays <= RETURNING_ACTIVE_DAYS
    default:
      return true
  }
}

function ago(ts, now) {
  const mins = Math.max(0, Math.floor((now - ts) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}

function demoClients() {
  const now = Date.now()
  const mk = (name, phone, createdDays, idleHours, spent, purchases) => ({
    id: now + Math.random(),
    name,
    phone,
    createdAt: now - createdDays * DAY,
    lastActive: now - idleHours * 3600000,
    totalSpent: spent,
    purchases,
    blacklisted: false,
  })
  return [
    mk('Faith Simiyu', '0704590730', 0, 1, 50, 1),
    mk('Ruth Mogaka', '0759461380', 3, 60, 150, 3),
    mk('Purity Bowen', '0769010855', 20, 30, 300, 6),
    mk('Sydney Wangwe', '0797609585', 40, 96, 90, 2),
    mk('Imran Ahmed', '0180723954'.replace(/^018/, '071'), 60, 500, 190, 4),
  ]
}

export default function ClientsPage({ onBack }) {
  const [clients, setClients] = useState(loadClients)
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [menuId, setMenuId] = useState(null)
  const [modal, setModal] = useState(null) // null | { id: number|null }
  const [form, setForm] = useState({ name: '', phone: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  function update(list) {
    setClients(list)
    saveClients(list)
  }

  const counts = {}
  TABS.forEach((t) => {
    counts[t.id] = clients.filter((c) => matches(c, t.id, now)).length
  })

  const q = query.trim().toLowerCase()
  const visible = clients
    .filter((c) => matches(c, tab, now))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\s/g, '')))
    .sort((a, b) => b.lastActive - a.lastActive)

  function openAdd() {
    setForm({ name: '', phone: '' })
    setError('')
    setModal({ id: null })
    setMenuId(null)
  }

  function openEdit(c) {
    setForm({ name: c.name, phone: c.phone })
    setError('')
    setModal({ id: c.id })
    setMenuId(null)
  }

  function saveForm() {
    const name = form.name.trim()
    const phone = parsePhone(form.phone)
    if (!name) return setError('Enter the client name')
    if (!phone) return setError('Enter a valid phone number')
    if (clients.some((c) => c.phone === phone && c.id !== modal.id))
      return setError('A client with this number already exists')

    if (modal.id) {
      update(clients.map((c) => (c.id === modal.id ? { ...c, name, phone } : c)))
      setNotice('Client updated')
    } else {
      const t = Date.now()
      update([
        ...clients,
        {
          id: t + Math.random(),
          name,
          phone,
          createdAt: t,
          lastActive: t,
          totalSpent: 0,
          purchases: 0,
          blacklisted: false,
        },
      ])
      setNotice('Client added')
    }
    setModal(null)
  }

  function toggleBlacklist(c) {
    update(clients.map((x) => (x.id === c.id ? { ...x, blacklisted: !x.blacklisted } : x)))
    setNotice(c.blacklisted ? `${c.name} removed from blacklist` : `${c.name} blacklisted`)
    setMenuId(null)
  }

  async function syncContacts() {
    setNotice('')
    if (!('contacts' in navigator) || !navigator.contacts?.select) {
      setNotice('Contact sync works in Chrome on Android over a secure (https) link. Use the add button for now.')
      return
    }
    try {
      const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true })
      const list = [...clients]
      let added = 0
      const t = Date.now()
      picked.forEach((p) => {
        const phone = (p.tel || []).map((n) => parsePhone(n)).find(Boolean)
        if (!phone || list.some((c) => c.phone === phone)) return
        list.push({
          id: t + Math.random(),
          name: (p.name && p.name[0]) || phone,
          phone,
          createdAt: t,
          lastActive: t,
          totalSpent: 0,
          purchases: 0,
          blacklisted: false,
        })
        added += 1
      })
      update(list)
      setNotice(added ? `${added} contact(s) synced` : 'No new contacts to add')
    } catch (e) {
      if (e && e.name !== 'AbortError') setNotice('Could not read your contacts')
    }
  }

  function loadDemo() {
    update([...clients, ...demoClients()])
    setNotice('Demo clients loaded')
  }

  function go(url) {
    setMenuId(null)
    window.location.href = url
  }

  return (
    <div className="cl-page">
      <style>{`
        .cl-page {
          --cl-accent: var(--accent-color, #1F5EFF);
          --cl-card: var(--card-bg, #FFFFFF);
          --cl-border: var(--border-color, #D5DDF0);
          --cl-soft: var(--muted-text, #4A5568);
          --cl-hover: var(--muted-bg, #E6EDFF);
          --cl-on: var(--on-primary, #FFFFFF);
          --cl-bad: var(--danger, #D32F2F);
          width: 100%; box-sizing: border-box; padding: 4px 4px 32px;
        }
        .cl-inner { max-width: 640px; margin: 0 auto; }
        .cl-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
        .cl-head-left { display: flex; align-items: center; gap: 6px; }
        .cl-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .cl-head-icons { display: flex; align-items: center; gap: 6px; }
        .cl-icon {
          width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; display: grid; place-items: center;
        }
        .cl-icon:hover { background: var(--cl-hover); }
        .cl-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .cl-icon:focus-visible, .cl-tab:focus-visible, .cl-btn:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 3px; }
        .cl-search {
          width: 100%; box-sizing: border-box; padding: 15px 16px; border: 2px solid var(--cl-border);
          border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .cl-search:focus { border-color: var(--cl-accent); }
        .cl-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 14px 0 6px; }
        .cl-tab {
          flex: 0 0 auto; padding: 11px 16px; border: 1px solid var(--cl-border); border-radius: 999px;
          background: var(--cl-card); color: inherit; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .cl-tab.on { background: var(--cl-accent); color: var(--cl-on); border-color: var(--cl-accent); }
        .cl-note { margin: 12px 0 0; padding: 12px 14px; border-radius: 10px; background: var(--cl-hover); font-size: 14px; }
        .cl-list { display: grid; gap: 12px; margin-top: 14px; }
        .cl-card {
          position: relative; display: flex; align-items: center; gap: 14px; padding: 16px;
          border: 1px solid var(--cl-border); border-radius: 16px; background: var(--cl-card);
        }
        .cl-avatar {
          width: 48px; height: 48px; border-radius: 50%; background: var(--cl-accent); color: var(--cl-on);
          display: grid; place-items: center; font-weight: 700; flex-shrink: 0;
        }
        .cl-info { flex: 1; min-width: 0; }
        .cl-name { font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
        .cl-meta { color: var(--cl-soft); font-size: 13px; margin-top: 3px; }
        .cl-badge {
          display: inline-block; margin-left: 8px; padding: 2px 9px; border-radius: 999px;
          background: var(--cl-bad); color: #fff; font-size: 11px; font-weight: 700; vertical-align: middle;
        }
        .cl-dots-wrap { position: relative; }
        .cl-menu {
          position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; width: 190px; padding: 6px;
          border: 1px solid var(--cl-border); border-radius: 12px; background: var(--cl-card);
          box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
        }
        .cl-menu button {
          display: block; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: transparent;
          color: inherit; font: inherit; font-size: 15px; text-align: left; cursor: pointer;
        }
        .cl-menu button:hover { background: var(--cl-hover); }
        .cl-menu .bad { color: var(--cl-bad); }
        .cl-backdrop { position: fixed; inset: 0; z-index: 20; background: transparent; border: 0; }
        .cl-empty { text-align: center; padding: 36px 16px; color: var(--cl-soft); }
        .cl-btn {
          padding: 14px 22px; border: 0; border-radius: 999px; background: var(--cl-accent);
          color: var(--cl-on); font: inherit; font-weight: 700; cursor: pointer;
        }
        .cl-btn.ghost { background: transparent; color: inherit; border: 2px solid var(--cl-border); }
        .cl-modal-bg {
          position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / 55%);
          display: grid; place-items: center; padding: 16px;
        }
        .cl-modal {
          width: 100%; max-width: 420px; padding: 22px; border-radius: 18px;
          background: var(--cl-card); border: 1px solid var(--cl-border);
        }
        .cl-modal h2 { margin: 0 0 14px; font-size: 20px; }
        .cl-field {
          width: 100%; box-sizing: border-box; margin-top: 12px; padding: 15px; border: 2px solid var(--cl-border);
          border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .cl-field:focus { border-color: var(--cl-accent); }
        .cl-err { color: var(--cl-bad); font-weight: 600; font-size: 14px; margin: 12px 0 0; }
        .cl-row { display: flex; gap: 10px; margin-top: 20px; }
        .cl-row .cl-btn { flex: 1; }
      `}</style>

      <div className="cl-inner">
        <div className="cl-head">
          <div className="cl-head-left">
            <button className="cl-icon" onClick={onBack} aria-label="Go back">
              <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <h1>Clients</h1>
          </div>
          <div className="cl-head-icons">
            <button className="cl-icon" onClick={syncContacts} aria-label="Sync contacts" title="Sync contacts">
              <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8M3 3v5h5M3 12a9 9 0 0 0 15.5 6.2L21 16M21 21v-5h-5" /></svg>
            </button>
            <button className="cl-icon" onClick={openAdd} aria-label="Add contact" title="Add contact">
              <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6" /></svg>
            </button>
          </div>
        </div>

        <input
          className="cl-search"
          placeholder="Search by name or number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />

        <div className="cl-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`cl-tab ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} ({counts[t.id]})
            </button>
          ))}
        </div>

        {notice && <p className="cl-note" role="status">{notice}</p>}

        {visible.length === 0 ? (
          <div className="cl-empty">
            {clients.length === 0 ? (
              <>
                <p>No clients yet. Add one, sync your contacts, or load sample clients to test.</p>
                <button className="cl-btn" onClick={loadDemo}>Load demo clients</button>
              </>
            ) : (
              <p>No clients in this category.</p>
            )}
          </div>
        ) : (
          <div className="cl-list">
            {visible.map((c) => (
              <article className="cl-card" key={c.id}>
                <div className="cl-avatar">{initials(c.name)}</div>
                <div className="cl-info">
                  <div className="cl-name">
                    {c.name}
                    {c.blacklisted && <span className="cl-badge">Blacklisted</span>}
                  </div>
                  <div className="cl-meta">{c.phone}</div>
                  <div className="cl-meta">
                    Average spent: KES {c.purchases ? Math.round(c.totalSpent / c.purchases) : 0}
                  </div>
                  <div className="cl-meta">Last active: {ago(c.lastActive, now)}</div>
                </div>

                <div className="cl-dots-wrap">
                  <button
                    className="cl-icon"
                    aria-label={`More actions for ${c.name}`}
                    aria-expanded={menuId === c.id}
                    onClick={() => setMenuId(menuId === c.id ? null : c.id)}
                  >
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                  </button>
                  {menuId === c.id && (
                    <>
                      <button className="cl-backdrop" aria-label="Close menu" onClick={() => setMenuId(null)} />
                      <div className="cl-menu">
                        <button onClick={() => go(`tel:${c.phone}`)}>Call</button>
                        <button onClick={() => go(`sms:${c.phone}`)}>Text</button>
                        <button onClick={() => openEdit(c)}>Edit</button>
                        <button className="bad" onClick={() => toggleBlacklist(c)}>
                          {c.blacklisted ? 'Remove from blacklist' : 'Blacklist'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <div className="cl-modal-bg" onClick={() => setModal(null)}>
          <div className="cl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{modal.id ? 'Edit client' : 'Add client'}</h2>
            <input
              className="cl-field"
              placeholder="Client name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-label="Client name"
            />
            <input
              className="cl-field"
              type="tel"
              inputMode="tel"
              placeholder="Phone number"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              aria-label="Phone number"
            />
            {error && <p className="cl-err" role="alert">{error}</p>}
            <div className="cl-row">
              <button className="cl-btn ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="cl-btn" onClick={saveForm}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}