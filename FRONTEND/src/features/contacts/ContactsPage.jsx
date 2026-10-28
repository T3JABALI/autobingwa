import { useEffect, useRef, useState } from 'react'
import { parsePhone } from '../quickdial/ussd'

const KEY = 'contacts:list'
const CLIENTS_KEY = 'clients:list'

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    console.error('Could not read ' + key, e)
    return []
  }
}

function write(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch (e) {
    console.error('Could not save ' + key, e)
  }
}

// Loads contacts and copies in any client who has bought before.
function loadContacts() {
  const contacts = read(KEY)
  let changed = false
  read(CLIENTS_KEY).forEach((c) => {
    if (c.purchases > 0 && !contacts.some((x) => x.phone === c.phone)) {
      contacts.push({
        id: newId(), name: c.name || c.phone, phone: c.phone,
        email: '', source: 'local', createdAt: c.createdAt || Date.now(),
      })
      changed = true
    }
  })
  if (changed) write(KEY, contacts)
  return contacts
}

// Call from your Sitelink / purchase code:
//   addContact('0712345678', 'Name', 'sitelink')
export function addContact(phone, name = '', source = 'local') {
  const clean = parsePhone(String(phone || ''))
  if (!clean) return
  const list = read(KEY)
  if (list.some((c) => c.phone === clean)) return
  list.push({ id: newId(), name: name || clean, phone: clean, email: '', source, createdAt: Date.now() })
  write(KEY, list)
}

const show = (p) => `+254 ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7)}`
const intl = (p) => '+254' + p.slice(1)

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  let nameIdx = header.findIndex((h) => /name/.test(h))
  let phoneIdx = header.findIndex((h) => /phone|number|tel|mobile/.test(h))
  const emailIdx = header.findIndex((h) => /mail/.test(h))
  let start = 1
  if (nameIdx < 0 && phoneIdx < 0) { nameIdx = 0; phoneIdx = 1; start = 0 }
  const rows = []
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const phone = parsePhone(phoneIdx >= 0 ? cells[phoneIdx] || '' : '')
    if (!phone) continue
    const name = (nameIdx >= 0 && (cells[nameIdx] || '').trim()) || phone
    rows.push({ name, phone, email: emailIdx >= 0 ? (cells[emailIdx] || '').trim() : '' })
  }
  return rows
}

function parseVcf(text) {
  const rows = []
  text.split(/BEGIN:VCARD/i).slice(1).forEach((card) => {
    const fn = (card.match(/^FN[^:]*:(.*)$/im) || [])[1] || ''
    const tel = (card.match(/^TEL[^:]*:(.*)$/im) || [])[1] || ''
    const mail = (card.match(/^EMAIL[^:]*:(.*)$/im) || [])[1] || ''
    const phone = parsePhone(tel)
    if (phone) rows.push({ name: fn.trim() || phone, phone, email: mail.trim() })
  })
  return rows
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const htmlEsc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportContacts(list, format) {
  const stamp = new Date().toISOString().slice(0, 10)
  const base = `contacts-${stamp}`
  if (format === 'csv') {
    const rows = [['Name', 'Phone', 'Email', 'Source'], ...list.map((c) => [c.name, intl(c.phone), c.email, c.source])]
    download(`${base}.csv`, 'text/csv;charset=utf-8', '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'))
  } else if (format === 'xls') {
    const rows = list.map((c) =>
      `<tr><td>${htmlEsc(c.name)}</td><td style="mso-number-format:'\\@'">${htmlEsc(intl(c.phone))}</td><td>${htmlEsc(c.email)}</td><td>${htmlEsc(c.source)}</td></tr>`
    ).join('')
    download(`${base}.xls`, 'application/vnd.ms-excel',
      `<html><head><meta charset="utf-8"></head><body><table><tr><th>Name</th><th>Phone</th><th>Email</th><th>Source</th></tr>${rows}</table></body></html>`)
  } else if (format === 'vcf') {
    const cards = list.map((c) =>
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\nTEL;TYPE=CELL:${intl(c.phone)}\r\n${c.email ? `EMAIL:${c.email}\r\n` : ''}END:VCARD`
    ).join('\r\n')
    download(`${base}.vcf`, 'text/vcard;charset=utf-8', cards)
  } else {
    download(`${base}.json`, 'application/json', JSON.stringify(list, null, 2))
  }
}

function demoContacts() {
  const t = Date.now()
  const mk = (name, phone, source) => ({ id: newId(), name, phone, email: '', source, createdAt: t })
  return [
    mk('KCB', '0712501901', 'local'),
    mk('Rachael Mukami', '0720463494', 'local'),
    mk('Lucia Matea Akanga', '0111957805', 'local'),
    mk('Philip Memo Akaranga', '0702120431', 'sitelink'),
    mk('Miltone Zephania Anjeche', '0704204766', 'sitelink'),
  ]
}

const ICONS = {
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  download: <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />,
  upload: <path d="M12 21V9M6 13l6-6 6 6M4 3h16" />,
  dots: <><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  message: <path d="M4 4h16v12H8l-4 4V4zM8 10h.01M12 10h.01M16 10h.01" />,
}

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>
  )
}

export default function ContactsPage({ onBack }) {
  const [contacts, setContacts] = useState(loadContacts)
  const [tab, setTab] = useState('local')
  const [query, setQuery] = useState('')
  const [menuId, setMenuId] = useState(null)
  const [topMenu, setTopMenu] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    setContacts(loadContacts())
  }, [])

  function update(list) {
    setContacts(list)
    write(KEY, list)
  }

  const q = query.trim().toLowerCase()
  const visible = contacts
    .filter((c) => c.source === tab)
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\s|\+/g, '').replace(/^254/, '0')) || (c.email || '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))

  const localCount = contacts.filter((c) => c.source === 'local').length
  const sitelinkCount = contacts.filter((c) => c.source === 'sitelink').length
  const chosen = contacts.filter((c) => selected.includes(c.id))

  function closeMenus() {
    setMenuId(null)
    setTopMenu(false)
    setExportOpen(false)
  }

  function openAdd() {
    closeMenus()
    setForm({ name: '', phone: '', email: '' })
    setError('')
    setModal({ type: 'add' })
  }

  function openEdit(c) {
    closeMenus()
    setForm({ name: c.name, phone: c.phone, email: c.email || '' })
    setError('')
    setModal({ type: 'edit', id: c.id })
  }

  function saveForm() {
    const name = form.name.trim()
    const phone = parsePhone(form.phone)
    if (!name) return setError('Enter the contact name')
    if (!phone) return setError('Enter a valid phone number')
    const editingId = modal.type === 'edit' ? modal.id : null
    if (contacts.some((c) => c.phone === phone && c.id !== editingId))
      return setError('A contact with this number already exists')

    if (editingId) {
      update(contacts.map((c) => (c.id === editingId ? { ...c, name, phone, email: form.email.trim() } : c)))
      setNotice('Contact updated')
    } else {
      update([...contacts, { id: newId(), name, phone, email: form.email.trim(), source: 'local', createdAt: Date.now() }])
      setTab('local')
      setNotice('Contact added')
    }
    setModal(null)
  }

  function deleteOne(c) {
    closeMenus()
    if (!window.confirm(`Delete ${c.name}? This cannot be undone.`)) return
    update(contacts.filter((x) => x.id !== c.id))
    setNotice('Contact deleted')
  }

  function deleteSelected() {
    if (!chosen.length) return setNotice('Select at least one contact')
    if (!window.confirm(`Delete ${chosen.length} contact(s)? This cannot be undone.`)) return
    update(contacts.filter((c) => !selected.includes(c.id)))
    setSelected([])
    setSelectMode(false)
    setNotice('Contacts deleted')
  }

  function messageSelected() {
    if (!chosen.length) return setNotice('Select at least one contact')
    window.location.href = `sms:${chosen.map((c) => c.phone).join(',')}`
  }

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function startSelect() {
    closeMenus()
    setSelected([])
    setSelectMode(true)
  }

  function stopSelect() {
    setSelected([])
    setSelectMode(false)
  }

  function doExport(format) {
    const list = selectMode && chosen.length ? chosen : contacts
    if (!list.length) {
      setExportOpen(false)
      return setNotice('There are no contacts to export')
    }
    exportContacts(list, format)
    setExportOpen(false)
    setNotice(`${list.length} contact(s) exported`)
  }

  function handleImport(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const rows = /\.vcf$/i.test(file.name) ? parseVcf(text) : parseCsv(text)
      const list = [...contacts]
      let added = 0
      rows.forEach((r) => {
        if (list.some((c) => c.phone === r.phone)) return
        list.push({ id: newId(), name: r.name, phone: r.phone, email: r.email, source: 'local', createdAt: Date.now() })
        added += 1
      })
      update(list)
      setTab('local')
      setNotice(added ? `${added} contact(s) imported` : 'No new contacts found in that file')
    }
    reader.onerror = () => setNotice('Could not read that file')
    reader.readAsText(file)
  }

  function loadDemo() {
    update([...contacts, ...demoContacts().filter((d) => !contacts.some((c) => c.phone === d.phone))])
    setNotice('Demo contacts loaded')
  }

  const viewing = modal && modal.type === 'view' ? contacts.find((c) => c.id === modal.id) : null

  return (
    <div className="ct-page">
      <style>{`
        .ct-page {
          --ct-accent: var(--accent-color, #1F5EFF);
          --ct-card: var(--card-bg, #FFFFFF);
          --ct-border: var(--border-color, #D5DDF0);
          --ct-soft: var(--muted-text, #4A5568);
          --ct-hover: var(--muted-bg, #E6EDFF);
          --ct-on: var(--on-primary, #FFFFFF);
          --ct-bad: var(--danger, #D32F2F);
          width: 100%; box-sizing: border-box; padding: 4px 4px 32px;
        }
        .ct-inner { max-width: 640px; margin: 0 auto; }
        .ct-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 16px; }
        .ct-head-left { display: flex; align-items: center; gap: 4px; min-width: 0; }
        .ct-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .ct-head-icons { display: flex; align-items: center; gap: 2px; }
        .ct-icon {
          width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
          color: inherit; cursor: pointer; display: grid; place-items: center; flex-shrink: 0;
        }
        .ct-icon:hover { background: var(--ct-hover); }
        .ct-icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .ct-icon:focus-visible, .ct-tab:focus-visible, .ct-btn:focus-visible { outline: 2px solid var(--ct-accent); outline-offset: 3px; }
        .ct-rel { position: relative; }
        .ct-menu {
          position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; width: 210px; padding: 6px;
          border: 1px solid var(--ct-border); border-radius: 12px; background: var(--ct-card);
          box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
        }
        .ct-menu .ct-menu-title { padding: 8px 12px 4px; font-size: 12px; color: var(--ct-soft); }
        .ct-menu button {
          display: block; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: transparent;
          color: inherit; font: inherit; font-size: 15px; text-align: left; cursor: pointer;
        }
        .ct-menu button:hover { background: var(--ct-hover); }
        .ct-menu .bad { color: var(--ct-bad); }
        .ct-backdrop { position: fixed; inset: 0; z-index: 30; background: transparent; border: 0; }
        .ct-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
        .ct-tab {
          padding: 12px 18px; border: 1px solid var(--ct-border); border-radius: 999px;
          background: var(--ct-card); color: inherit; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .ct-tab.on { background: var(--ct-accent); color: var(--ct-on); border-color: var(--ct-accent); }
        .ct-searchbox { position: relative; }
        .ct-searchbox svg {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px;
          fill: none; stroke: var(--ct-soft); stroke-width: 2; stroke-linecap: round; pointer-events: none;
        }
        .ct-search {
          width: 100%; box-sizing: border-box; padding: 15px 16px 15px 46px; border: 2px solid var(--ct-border);
          border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .ct-search:focus { border-color: var(--ct-accent); }
        .ct-note { margin: 12px 0 0; padding: 12px 14px; border-radius: 10px; background: var(--ct-hover); font-size: 14px; }
        .ct-bar {
          display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding: 10px 12px;
          border-radius: 12px; background: var(--ct-hover);
        }
        .ct-bar strong { margin-right: auto; }
        .ct-chip {
          padding: 9px 14px; border: 1px solid var(--ct-border); border-radius: 999px; background: var(--ct-card);
          color: inherit; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .ct-chip.bad { color: var(--ct-bad); }
        .ct-list { display: grid; gap: 12px; margin-top: 14px; }
        .ct-card {
          display: flex; align-items: center; gap: 12px; padding: 14px;
          border: 1px solid var(--ct-border); border-radius: 16px; background: var(--ct-card);
        }
        .ct-card.sel { border-color: var(--ct-accent); background: var(--ct-hover); }
        .ct-check { width: 22px; height: 22px; accent-color: var(--ct-accent); flex-shrink: 0; }
        .ct-avatar {
          width: 48px; height: 48px; border-radius: 50%; background: var(--ct-accent); color: var(--ct-on);
          display: grid; place-items: center; font-weight: 700; flex-shrink: 0;
        }
        .ct-info { flex: 1; min-width: 0; }
        .ct-name { font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
        .ct-phone { color: var(--ct-soft); font-size: 14px; margin-top: 3px; }
        .ct-empty { text-align: center; padding: 36px 16px; color: var(--ct-soft); }
        .ct-btn {
          padding: 14px 22px; border: 0; border-radius: 999px; background: var(--ct-accent);
          color: var(--ct-on); font: inherit; font-weight: 700; cursor: pointer;
        }
        .ct-btn.ghost { background: transparent; color: inherit; border: 2px solid var(--ct-border); }
        .ct-modal-bg {
          position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / 55%);
          display: grid; place-items: center; padding: 16px;
        }
        .ct-modal {
          width: 100%; max-width: 420px; padding: 22px; border-radius: 18px;
          background: var(--ct-card); border: 1px solid var(--ct-border);
        }
        .ct-modal h2 { margin: 0 0 14px; font-size: 20px; }
        .ct-field {
          width: 100%; box-sizing: border-box; margin-top: 12px; padding: 15px; border: 2px solid var(--ct-border);
          border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 16px; outline: none;
        }
        .ct-field:focus { border-color: var(--ct-accent); }
        .ct-err { color: var(--ct-bad); font-weight: 600; font-size: 14px; margin: 12px 0 0; }
        .ct-row { display: flex; gap: 10px; margin-top: 20px; }
        .ct-row .ct-btn { flex: 1; }
        .ct-info-list { display: grid; gap: 10px; margin: 6px 0 0; }
        .ct-info-list div { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 10px; background: var(--ct-hover); }
        .ct-info-list span:first-child { color: var(--ct-soft); }
        .ct-info-list strong { overflow-wrap: anywhere; text-align: right; }
      `}</style>

      <div className="ct-inner">
        <div className="ct-head">
          <div className="ct-head-left">
            <button className="ct-icon" onClick={onBack} aria-label="Go back"><Icon name="back" /></button>
            <h1>Contacts</h1>
          </div>

          <div className="ct-head-icons">
            <div className="ct-rel">
              <button className="ct-icon" aria-label="Export contacts" title="Export" onClick={() => { setTopMenu(false); setExportOpen(!exportOpen) }}>
                <Icon name="upload" />
              </button>
              {exportOpen && (
                <>
                  <button className="ct-backdrop" aria-label="Close menu" onClick={closeMenus} />
                  <div className="ct-menu">
                    <div className="ct-menu-title">
                      {selectMode && chosen.length ? `Export ${chosen.length} selected` : `Export all ${contacts.length}`}
                    </div>
                    <button onClick={() => doExport('csv')}>CSV (.csv)</button>
                    <button onClick={() => doExport('xls')}>Excel (.xls)</button>
                    <button onClick={() => doExport('vcf')}>vCard (.vcf)</button>
                    <button onClick={() => doExport('json')}>JSON (.json)</button>
                  </div>
                </>
              )}
            </div>

            <button className="ct-icon" aria-label="Import contacts" title="Import" onClick={() => fileRef.current && fileRef.current.click()}>
              <Icon name="download" />
            </button>
            <input ref={fileRef} type="file" accept=".csv,.vcf,text/csv,text/vcard" hidden onChange={handleImport} />

            <div className="ct-rel">
              <button className="ct-icon" aria-label="More options" onClick={() => { setExportOpen(false); setTopMenu(!topMenu) }}>
                <Icon name="dots" />
              </button>
              {topMenu && (
                <>
                  <button className="ct-backdrop" aria-label="Close menu" onClick={closeMenus} />
                  <div className="ct-menu">
                    <button onClick={openAdd}>Add contact</button>
                    <button onClick={startSelect}>Select contacts</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="ct-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'local'} className={`ct-tab ${tab === 'local' ? 'on' : ''}`} onClick={() => setTab('local')}>
            Local Contacts ({localCount})
          </button>
          <button role="tab" aria-selected={tab === 'sitelink'} className={`ct-tab ${tab === 'sitelink' ? 'on' : ''}`} onClick={() => setTab('sitelink')}>
            Sitelink Contacts ({sitelinkCount})
          </button>
        </div>

        <div className="ct-searchbox">
          <Icon name="search" />
          <input
            className="ct-search"
            placeholder="Search by name, number, email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search contacts"
          />
        </div>

        {notice && <p className="ct-note" role="status">{notice}</p>}

        {selectMode && (
          <div className="ct-bar">
            <strong>{selected.length} selected</strong>
            <button className="ct-chip" onClick={() => setSelected(visible.map((c) => c.id))}>Select all</button>
            <button className="ct-chip" onClick={messageSelected}>Message</button>
            <button className="ct-chip" onClick={() => { setTopMenu(false); setExportOpen(true) }}>Export</button>
            <button className="ct-chip bad" onClick={deleteSelected}>Delete</button>
            <button className="ct-chip" onClick={stopSelect}>Cancel</button>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="ct-empty">
            {contacts.length === 0 ? (
              <>
                <p>No contacts yet. Customers who buy appear here automatically. You can also add, import or load samples to test.</p>
                <button className="ct-btn" onClick={loadDemo}>Load demo contacts</button>
              </>
            ) : (
              <p>No contacts found in this list.</p>
            )}
          </div>
        ) : (
          <div className="ct-list">
            {visible.map((c) => (
              <article className={`ct-card ${selected.includes(c.id) ? 'sel' : ''}`} key={c.id}>
                {selectMode && (
                  <input
                    type="checkbox"
                    className="ct-check"
                    checked={selected.includes(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`Select ${c.name}`}
                  />
                )}
                <div className="ct-avatar">{initials(c.name)}</div>
                <div className="ct-info">
                  <div className="ct-name">{c.name}</div>
                  <div className="ct-phone">{show(c.phone)}</div>
                </div>

                <button className="ct-icon" aria-label={`Send message to ${c.name}`} title="Send message"
                  onClick={() => { window.location.href = `sms:${c.phone}` }}>
                  <Icon name="message" />
                </button>

                <div className="ct-rel">
                  <button className="ct-icon" aria-label={`More actions for ${c.name}`} aria-expanded={menuId === c.id}
                    onClick={() => setMenuId(menuId === c.id ? null : c.id)}>
                    <Icon name="dots" />
                  </button>
                  {menuId === c.id && (
                    <>
                      <button className="ct-backdrop" aria-label="Close menu" onClick={closeMenus} />
                      <div className="ct-menu">
                        <button onClick={() => { closeMenus(); setModal({ type: 'view', id: c.id }) }}>View Contact Info</button>
                        <button onClick={() => openEdit(c)}>Edit</button>
                        <button className="bad" onClick={() => deleteOne(c)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {modal && (modal.type === 'add' || modal.type === 'edit') && (
        <div className="ct-modal-bg" onClick={() => setModal(null)}>
          <div className="ct-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{modal.type === 'edit' ? 'Edit contact' : 'Add contact'}</h2>
            <input className="ct-field" placeholder="Name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" />
            <input className="ct-field" type="tel" inputMode="tel" placeholder="Phone number" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-label="Phone number" />
            <input className="ct-field" type="email" placeholder="Email (optional)" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Email" />
            {error && <p className="ct-err" role="alert">{error}</p>}
            <div className="ct-row">
              <button className="ct-btn ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="ct-btn" onClick={saveForm}>Save</button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className="ct-modal-bg" onClick={() => setModal(null)}>
          <div className="ct-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Contact info</h2>
            <div className="ct-info-list">
              <div><span>Name</span><strong>{viewing.name}</strong></div>
              <div><span>Phone</span><strong>{show(viewing.phone)}</strong></div>
              <div><span>Email</span><strong>{viewing.email || 'Not added'}</strong></div>
              <div><span>List</span><strong>{viewing.source === 'sitelink' ? 'Sitelink' : 'Local'}</strong></div>
              <div><span>Added</span><strong>{new Date(viewing.createdAt).toLocaleDateString('en-KE')}</strong></div>
            </div>
            <div className="ct-row">
              <button className="ct-btn ghost" onClick={() => openEdit(viewing)}>Edit</button>
              <button className="ct-btn" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}