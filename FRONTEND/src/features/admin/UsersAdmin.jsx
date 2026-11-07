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

function Field({ label, value }) {
  return <div><small>{label}</small><span>{value}</span></div>
}

function UserCard({ u, type }) {
  const initials = (u.name || u.phone || '?').replace(/\D/g, '').length > 3 && !u.name ? '#' : (u.name || u.phone).trim().charAt(0).toUpperCase()
  return (
    <div className="ux-card">
      <div className="ux-row">
        <div className="ux-avatar">{initials}</div>
        <div className="ux-main">
          <b>{u.name || u.phone || 'Unknown'}</b>
          <span>{u.name ? u.phone : (type === 'app' ? 'App user' : 'Portal user')}</span>
        </div>
        <span className={'ux-status ' + (u.active ? 'on' : 'off')}>{u.active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="ux-grid">
        <Field label="Joined" value={fmtDate(u.joined)} />
        {type === 'app' ? (
          <>
            <Field label="Last payment" value={fmtWhen(u.lastActive)} />
            <Field label="Purchases" value={u.purchases} />
            <Field label="Total spent" value={ksh(u.spent)} />
            <Field label="Failed payments" value={u.failed} />
          </>
        ) : (
          <>
            <Field label="Plan" value={u.plan} />
            <Field label="Expires" value={fmtDate(u.expires)} />
            <Field label="Phones connected" value={u.devices} />
          </>
        )}
      </div>
    </div>
  )
}

export default function UsersAdmin() {
  const [type, setType] = useState('app')
  const [filter, setFilter] = useState('all')
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

  const list = (users || []).filter((u) => filter === 'all' || (filter === 'active') === u.active)
  const activeN = (users || []).filter((u) => u.active).length

  return (
    <>
      <div className="ux-seg">
        <button className={type === 'app' ? 'on' : ''} onClick={() => setType('app')}>App users</button>
        <button className={type === 'portal' ? 'on' : ''} onClick={() => setType('portal')}>Portal users</button>
      </div>
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