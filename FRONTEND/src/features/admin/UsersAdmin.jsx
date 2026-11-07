import { useEffect, useState } from 'react'
import { adminFetch } from './adminApi'

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtWhen = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso), t = new Date()
  const days = Math.floor((new Date(t.toDateString()) - new Date(d.toDateString())) / 86400000)
  const hm = d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })
  return days === 0 ? 'Today, ' + hm : days === 1 ? 'Yesterday, ' + hm : fmtDate(iso)
}
const ksh = (v) => 'KSh ' + Number(v || 0).toLocaleString('en-KE')
const phoneFmt = (p) => (p ? (p.startsWith('254') ? '0' + p.slice(3) : p) : '')

function UserCard({ u, type }) {
  const title = type === 'app' ? (u.email || phoneFmt(u.phone) || 'Unknown') : (u.name || phoneFmt(u.phone) || 'Unknown')
  const meta = type === 'app'
    ? [
        ['Joined', fmtDate(u.joined)],
        ['Last active', fmtWhen(u.lastActive)],
        ['Purchases', u.purchases],
        ['Spent', ksh(u.spent)],
        ...(u.failed ? [['Failed', u.failed]] : []),
        ...(u.email && u.phone ? [['Phone', phoneFmt(u.phone)]] : []),
      ]
    : [
        ['Joined', fmtDate(u.joined)],
        ['Plan', u.plan],
        ['Expires', fmtDate(u.expires)],
        ['Phones', u.devices],
        ...(u.name && u.phone ? [['Phone', phoneFmt(u.phone)]] : []),
      ]
  return (
    <div className="ux-card">
      <div className="ux-row">
        <div className="ux-avatar">{title.charAt(0).toUpperCase()}</div>
        <div className="ux-main"><b>{title}</b></div>
        <span className={'ux-status ' + (u.active ? 'on' : 'off')}>{u.active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="ux-meta">
        {meta.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}
      </div>
    </div>
  )
}

export default function UsersAdmin() {
  const [type, setType] = useState('app')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [users, setUsers] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    setUsers(null); setErr('')
    adminFetch('/admin/users?type=' + type)
      .then((j) => live && setUsers(j.users))
      .catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [type])

  const needle = q.trim().toLowerCase()
  const list = (users || []).filter((u) =>
    (filter === 'all' || (filter === 'active') === u.active) &&
    (!needle || [u.email, u.name, u.phone].some((x) => (x || '').toLowerCase().includes(needle))))
  const activeN = (users || []).filter((u) => u.active).length

  return (
    <>
      <div className="ux-seg">
        <button className={type === 'app' ? 'on' : ''} onClick={() => setType('app')}>App users</button>
        <button className={type === 'portal' ? 'on' : ''} onClick={() => setType('portal')}>Portal users</button>
      </div>
      <input className="ux-search" placeholder={type === 'app' ? 'Search by email' : 'Search by name or phone'}
        value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ux-chips">
        {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([id, label]) => (
          <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>
        ))}
        {users && <span className="ux-count">{activeN} of {users.length} active</span>}
      </div>
      {err && <p className="in-err">{err}</p>}
      {!users && !err && <p className="in-msg">Loading…</p>}
      {users && list.length === 0 && <p className="in-msg">No users in this view.</p>}
      <div className="ux-list">
        {list.map((u) => <UserCard key={u.id} u={u} type={type} />)}
      </div>
    </>
  )
}