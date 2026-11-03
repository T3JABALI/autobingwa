import { useEffect, useState } from 'react'
import { parsePhone } from '../quickdial/ussd'
import { AutoBingwa, isNative, listContacts, askPermissions } from '../../engine/native.js'
import { last9, loadConfig } from '../../engine/config.js'
import {
  loadClients, saveClients, recordClientPurchase, purchaseDays, dayKey, CLIENTS_EVENT, DAY,
} from '../../engine/clientsStore.js'

export { recordClientPurchase }

const SHOW_MAX = 200

const TABS = [
  { id: 'all', label: 'All Clients' },
  { id: 'today', label: 'New Today' },
  { id: 'week', label: 'New Last 7 Days' },
  { id: 'risk', label: 'At risk' },
  { id: 'returning', label: 'Returning' },
]

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Categories are worked out fresh from each client's purchase days, so they roll over at midnight by themselves.
//  New Today / New Last 7 Days: first seen as a customer in that time
//  At risk: has bought before, but not in the last 3 days
//  Returning: bought yesterday and today
function matches(client, tab, now) {
  const today = startOfToday()
  switch (tab) {
    case 'today':
      return client.createdAt >= today
    case 'week':
      return client.createdAt > 0 && now - client.createdAt <= 7 * DAY
    case 'risk': {
      if (!(client.purchases > 0) || !client.lastActive) return false
      const last = new Date(client.lastActive)
      last.setHours(0, 0, 0, 0)
      return Math.round((today - last.getTime()) / DAY) >= 3
    }
    case 'returning': {
      const days = purchaseDays(client)
      return days.includes(dayKey(now)) && days.includes(dayKey(now - DAY))
    }
    default:
      return true
  }
}

function ago(ts, now) {
  if (!ts) return 'No purchase yet'
  const mins = Math.max(0, Math.floor((now - ts) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}

// Saves to the phone's own contact list (Android app only)
async function saveToPhone(name, phone) {
  if (!isNative()) return 'browser'
  try {
    await askPermissions()
    const r = await AutoBingwa.saveContact({ name, phone })
    return r && r.saved === false ? 'exists' : 'saved'
  } catch (e) {
    console.error('saveToPhone', e)
    return 'failed'
  }
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
  const [syncing, setSyncing] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    // The engine records purchases while this page is open, so reload when it does
    const reload = () => setClients(loadClients())
    window.addEventListener(CLIENTS_EVENT, reload)
    return () => {
      clearInterval(t)
      window.removeEventListener(CLIENTS_EVENT, reload)
    }
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
  const filtered = clients
    .filter((c) => matches(c, tab, now))
    .filter((c) => !q || String(c.name).toLowerCase().includes(q) || c.phone.includes(q.replace(/\s/g, '')))
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0) || String(a.name).localeCompare(String(b.name)))
  const visible = filtered.slice(0, SHOW_MAX)

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

  async function saveForm() {
    const name = form.name.trim()
    const phone = parsePhone(form.phone)
    if (!name) return setError('Enter the client name')
    if (!phone) return setError('Enter a valid phone number')
    if (clients.some((c) => last9(c.phone) === last9(phone) && c.id !== modal.id))
      return setError('A client with this number already exists')

    if (modal.id) {
      update(clients.map((c) => (c.id === modal.id ? { ...c, name, phone } : c)))
      setNotice('Client updated')
      setModal(null)
      return
    }
    const t = Date.now()
    update([
      ...clients,
      { id: t + Math.random(), name, phone, createdAt: t, lastActive: 0, totalSpent: 0, purchases: 0, blacklisted: false, days: [] },
    ])
    setModal(null)
    const r = await saveToPhone(name, phone)
    setNotice(
      r === 'saved' ? 'Client added and saved to your phone contacts'
        : r === 'exists' ? 'Client added. That number was already in your phone contacts'
          : r === 'failed' ? 'Client added, but could not save to the phone contacts (check the Contacts permission)'
            : 'Client added'
    )
  }

  function toggleBlacklist(c) {
    update(loadClients().map((x) => (x.id === c.id ? { ...x, blacklisted: !x.blacklisted } : x)))
    setNotice(
      c.blacklisted
        ? `${c.name} removed from the blacklist`
        : `${c.name} blacklisted. Their payments will not be processed`
    )
    setMenuId(null)
  }

  async function syncContacts() {
    setNotice('')
    if (!isNative()) return setNotice('Syncing contacts only works inside the Android app.')
    setSyncing(true)
    try {
      await askPermissions()
      const phoneList = await listContacts()
      const suffix = String(loadConfig().saveSuffix || '').trim()
      const list = loadClients()
      const known = new Set(list.map((c) => last9(c.phone)))
      let added = 0
      phoneList.forEach((p) => {
        const phone = parsePhone(String(p.phone || ''))
        if (!phone) return
        const k = last9(phone)
        if (known.has(k)) return
        known.add(k)
        let name = String(p.name || '').trim()
        if (suffix && name.endsWith(' ' + suffix)) name = name.slice(0, -suffix.length).trim()
        // createdAt 0: synced contacts are not "new customers" until they buy
        list.push({
          id: Date.now() + Math.random(), name: name || phone, phone,
          createdAt: 0, lastActive: 0, totalSpent: 0, purchases: 0, blacklisted: false, days: [],
        })
        added += 1
      })
      update(list)
      setNotice(added ? `${added} contact(s) synced from your phone` : 'No new contacts to add')
    } catch (e) {
      setNotice(`Could not read your contacts: ${e && e.message ? e.message : e}`)
    } finally {
      setSyncing(false)
    }
  }

  function go(url) {
    setMenuId(null)
    window.location.href = url
  }

  const intl = (p) => '254' + p.slice(1)

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
        .cl-icon:disabled { opacity: 0.5; cursor: wait; }
        .cl-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .cl-spin svg { animation: cl-rot 1s linear infinite; }
        @keyframes cl-rot { to { transform: rotate(360deg); } }
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
          position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; width: 200px; padding: 6px;
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
        .cl-more { text-align: center; color: var(--cl-soft); font-size: 13px; margin: 14px 0 0; }
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
            <button
              className={`cl-icon ${syncing ? 'cl-spin' : ''}`}
              onClick={syncContacts}
              disabled={syncing}
              aria-label="Sync contacts from phone"
              title="Sync contacts from phone"
            >
              <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8M3 3v5h5M3 12a9 9 0 0 0 15.5 6.2L21 16M21 21v-5h-5" /></svg>
            </button>
            <button className="cl-icon" onClick={openAdd} aria-label="Add client" title="Add client">
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
              <p>No clients yet. Customers appear here after they buy. You can also add one, or sync your phone contacts.</p>
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
                  <div className="cl-meta">Last purchase: {ago(c.lastActive, now)}</div>
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
                        <button onClick={() => go(`sms:${c.phone}`)}>Text (Messages)</button>
                        <button onClick={() => go(`https://wa.me/${intl(c.phone)}`)}>Text (WhatsApp)</button>
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
        {filtered.length > SHOW_MAX && (
          <p className="cl-more">Showing the first {SHOW_MAX} of {filtered.length}. Use search to find the rest.</p>
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