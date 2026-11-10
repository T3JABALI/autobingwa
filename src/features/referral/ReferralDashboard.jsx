import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { grantTokens } from '../../engine/tokens.js'
import './referral.css'

const API = (import.meta.env.VITE_TOKEN_API || '').replace(/\/+$/, '')
const PLAN = { d7: '1 Week Token', d30: '1 Month Token' }

export const ReferralIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="7" r="3" /><circle cx="4.5" cy="10" r="2" /><circle cx="19.5" cy="10" r="2" />
    <path d="M7.5 20v-2.5a4.5 4.5 0 0 1 9 0V20" /><path d="M2 19v-1.5a3 3 0 0 1 3-3" /><path d="M22 19v-1.5a3 3 0 0 0-3-3" />
    <path d="M12 12.5v3M10.5 14h3" />
  </svg>
)

async function api(path, opts = {}) {
  const { data } = await supabase.auth.getSession()
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ((data.session && data.session.access_token) || '') },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Something went wrong.')
  return j
}

// Adds withdrawn days to the wallet. The unique ref means the same withdrawal can never be credited twice.
async function claim(list) {
  for (const w of list) {
    grantTokens({ id: 'gift', label: `Referral gift · ${w.days} day${w.days === 1 ? '' : 's'} unlimited`, price: 0, days: w.days }, 'gift', 'refwd-' + w.id)
    await api(`/referral/withdraw/${w.id}/ack`, { method: 'POST' })
  }
}

export default function ReferralDashboard() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      let j = await api('/referral/me')
      if (j.pending.length) { await claim(j.pending); j = await api('/referral/me') } // finish an interrupted withdrawal
      setD(j); setErr('')
    } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const withdraw = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const w = await api('/referral/withdraw', { method: 'POST' })
      await claim([w])
      setMsg(`${w.days} day${w.days === 1 ? '' : 's'} of unlimited added to your tokens.`)
      await load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(d.code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (e) { /* ignore */ }
  }

  if (!d) return <div className="rf">{err ? <div className="rf-err">{err}</div> : <div className="rf-empty">Loading…</div>}</div>
  const rows = all ? d.list : d.list.slice(0, 5)

  return (
    <div className="rf">
      <div className="rf-banner">
        <h3>Refer other agents and earn <em>Unlimited 1 Day</em> tokens after they have purchased unlimited weekly or monthly tokens</h3>
        <ReferralIcon size={64} />
      </div>

      <div className="rf-balance">
        <div className="rf-gift">🎁</div>
        <div className="rf-bal-txt">
          <small>Gift Token Balance</small>
          <b>{d.balance} Day{d.balance === 1 ? '' : 's'}</b>
          <span>= {d.balance} Free Day{d.balance === 1 ? '' : 's'}</span>
        </div>
        <div className="rf-wd">
          <button disabled={busy || d.balance < 1} onClick={withdraw}>{busy ? 'Please wait…' : 'Withdraw'}</button>
          <span>Adds to your token balance</span>
        </div>
      </div>
      {msg && <div className="rf-ok">{msg}</div>}
      {err && <div className="rf-err">{err}</div>}

      <div className="rf-code">
        <div>
          <small>Your Referral Code</small>
          <b>{d.code}</b>
          <span>Give this code to friends. They enter it when they sign up.</span>
        </div>
        <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>

      <div className="rf-head">
        <b>Your Referral Activity</b>
        {d.list.length > 5 && <button onClick={() => setAll(!all)}>{all ? 'Show less' : 'View All'}</button>}
      </div>
      {d.list.length === 0 && <div className="rf-empty"><b>No referrals yet</b><br />Agents who sign up with your code will appear here</div>}
      {rows.map((r) => (
        <div key={r.id} className="rf-row">
          <div className="rf-av">👤</div>
          <div className="rf-info">
            <b>{r.who}</b>
            <span>{r.active ? `Purchased ${PLAN[r.plan] || 'a token'}${r.buys > 1 ? ` · ${r.buys} purchases` : ''}` : 'Signed up · no purchase yet'}</span>
            <small>{new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <div className="rf-st">
            <span className={r.active ? 'on' : 'off'}>{r.active ? '✓ Active' : '✕ Inactive'}</span>
            <b className={r.active ? 'on' : ''}>+{r.days} Day{r.days === 1 ? '' : 's'}</b>
          </div>
        </div>
      ))}
    </div>
  )
}