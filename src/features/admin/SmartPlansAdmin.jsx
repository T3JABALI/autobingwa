import { useEffect, useMemo, useState } from 'react'
import { adminFetch } from './adminApi'
import { learnSignature, ussdServiceEnabled, isNative } from '../../engine/native.js'
import { parseMenu } from '../../engine/signature.js'
import { loadConfig } from '../../engine/config.js'
import { confirmDialog } from '../ui/dialog.js'
import './SmartPlansAdmin.css'

const api = (path, method = 'GET', body) => adminFetch(path, method === 'GET' ? undefined : { method, body })

const t12 = (v) => {
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const STATUS = {
  published: ['Published', 'ok'],
  draft: ['Not published', 'no'],
  relearn: ['Re-learn needed', 'warn'],
}
const blank = () => ({
  sid: '', group: '', name: '', ussd: '', safPrice: '', active: true,
  tw: { on: false, from: '19:00', until: '23:00' },
})

function Sheet({ title, onClose, children, footer }) {
  return (
    <div className="sa-back" onClick={onClose}>
      <div className="sa-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sa-sbody">
          <h3>{title}</h3>
          {children}
        </div>
        <div className="sa-sbar">{footer}</div>
      </div>
    </div>
  )
}

export default function SmartPlansAdmin() {
  const [plans, setPlans] = useState(null)
  const [err, setErr] = useState('')
  const [group, setGroup] = useState('All')
  const [q, setQ] = useState('')
  const [openSid, setOpenSid] = useState(null)
  const [sheet, setSheet] = useState(null) // { type: 'edit' | 'learn', plan }
  const [note, setNote] = useState('')

  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 3500) }

  async function load() {
    try {
      const j = await api('/admin/smart-plans')
      setPlans(j.plans || [])
      setErr('')
      return j.plans || []
    } catch (e) {
      setErr(e.message || 'Could not load the plans.')
      return null
    }
  }
  useEffect(() => { load() }, [])

  const groups = useMemo(() => ['All', ...Array.from(new Set((plans || []).map((p) => p.group)))], [plans])
  const list = (plans || []).filter(
    (p) => (group === 'All' || p.group === group) && p.name.toLowerCase().includes(q.toLowerCase())
  )
  const liveCount = (plans || []).filter((p) => p.active && p.status !== 'draft').length

  async function remove(p) {
    if (!(await confirmDialog(`${p.name} will be removed from the catalog. Users who already downloaded it keep their copy.`,
      { title: 'Delete plan?', confirmLabel: 'Delete', danger: true }))) return
    try {
      await api(`/admin/smart-plans/${p.sid}`, 'DELETE')
      setOpenSid(null)
      flash('Plan deleted')
      load()
    } catch (e) { flash(e.message || 'Could not delete the plan.') }
  }

  // After an add, or an edit that changed the USSD, go straight to learning
  async function afterSave(sid, needsLearn) {
    setSheet(null)
    const fresh = await load()
    setOpenSid(sid)
    flash('Saved')
    if (needsLearn && fresh) {
      const p = fresh.find((x) => x.sid === sid)
      if (p) setSheet({ type: 'learn', plan: p })
    }
  }

  return (
    <div className="sa">
      <div className="sa-bar">
        <div className="sa-sum">
          <b>{plans ? plans.length : 0}</b> plans · <b>{liveCount}</b> live
        </div>
        <button className="sa-add" onClick={() => setSheet({ type: 'edit', plan: blank(), isNew: true })}>+ Add plan</button>
      </div>

      <div className="sa-chips">
        {groups.map((g) => (
          <button key={g} className={`sa-chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <input className="sa-search" placeholder="Search plans" value={q} onChange={(e) => setQ(e.target.value)} />

      {note && <p className="sa-note" role="status">{note}</p>}
      {err && <p className="sa-err">{err}</p>}
      {plans === null && !err && <p className="sa-hint">Loading…</p>}
      {plans && list.length === 0 && <div className="sa-empty"><b>No plans found</b></div>}

      {list.map((p) => {
        const [label, tone] = STATUS[p.status] || STATUS.draft
        const open = openSid === p.sid
        return (
          <div key={p.sid} className={`sa-card ${open ? 'open' : ''} ${p.active ? '' : 'off'}`}>
            <button className="sa-head" onClick={() => setOpenSid(open ? null : p.sid)} aria-expanded={open}>
              <div className="sa-line1">
                <span className="sa-name">{p.name}</span>
                <span className="sa-price">KES {p.safPrice}</span>
              </div>
              <code className="sa-ussd">{p.ussd}</code>
              <div className="sa-line3">
                <span className="sa-meta">
                  {p.group}
                  {p.tw && p.tw.on ? ` · 🕒 ${t12(p.tw.from)} to ${t12(p.tw.until)}` : ''}
                  {p.active ? '' : ' · hidden'}
                </span>
                <span className={`sa-badge ${tone}`}>{label}</span>
              </div>
            </button>

            {open && (
              <div className="sa-more">
                <p className="sa-sig">
                  {p.hasSig ? `Signature saved · ${p.sigView.length} steps` : 'No signature saved yet'}
                </p>
                <div className="sa-actions">
                  <button className="sa-btn pri" onClick={() => setSheet({ type: 'learn', plan: p })}>
                    {p.hasSig ? 'Learn again' : 'Learn signature'}
                  </button>
                  <button className="sa-btn" onClick={() => setSheet({ type: 'edit', plan: p })}>Edit</button>
                  <button className="sa-btn danger" onClick={() => remove(p)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {sheet && sheet.type === 'edit' && (
        <EditSheet start={sheet.plan} isNew={Boolean(sheet.isNew)} groups={groups.filter((g) => g !== 'All')}
          onClose={() => setSheet(null)} onSaved={afterSave} />
      )}
      {sheet && sheet.type === 'learn' && (
        <LearnSheet plan={sheet.plan} onClose={() => setSheet(null)}
          onDone={async () => { setSheet(null); await load(); flash('Signature saved. The plan is now live for every user.') }} />
      )}
    </div>
  )
}

function EditSheet({ start, isNew, groups, onClose, onSaved }) {
  const [f, setF] = useState({ ...start, safPrice: String(start.safPrice || ''), tw: { ...start.tw } })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const setTw = (k, v) => setF((p) => ({ ...p, tw: { ...p.tw, [k]: v } }))
  const ussd = f.ussd.replace(/\s+/g, '').replace(/ab/gi, 'AB')
  const ussdChanged = !isNew && ussd !== start.ussd

  async function save() {
    setErr('')
    if (!f.group.trim()) return setErr('Choose or type a group')
    if (!f.name.trim()) return setErr('Enter the plan name')
    if (!ussd.includes('AB')) return setErr('The USSD code must contain AB where the phone number goes')
    if (!(Number(f.safPrice) > 0)) return setErr('Enter the Safaricom price')
    if (f.tw.on && f.tw.from === f.tw.until) return setErr('The start and end time cannot be the same')
    setBusy(true)
    try {
      const body = { group: f.group.trim(), name: f.name.trim(), ussd, safPrice: Number(f.safPrice), tw: f.tw }
      if (isNew) {
        const j = await api('/admin/smart-plans', 'POST', body)
        await onSaved(j.sid, true) // a new plan always needs its signature
      } else {
        const j = await api(`/admin/smart-plans/${start.sid}`, 'PUT', { ...body, active: f.active })
        await onSaved(start.sid, Boolean(j.needsLearn))
      }
    } catch (e) {
      setErr(e.message || 'Could not save the plan.')
      setBusy(false)
    }
  }

  return (
    <Sheet title={isNew ? 'Add smart plan' : 'Edit smart plan'} onClose={busy ? () => {} : onClose}
      footer={<>
        <button className="sa-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="sa-btn pri" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <label className="sa-field"><span>Group</span>
        <input list="sa-groups" value={f.group} onChange={(e) => set('group', e.target.value)} placeholder="Bingwa" />
        <datalist id="sa-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </label>
      <label className="sa-field"><span>Plan name</span>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="1GB 1HR Bingwa" />
      </label>
      <label className="sa-field"><span>USSD code</span>
        <input value={f.ussd} onChange={(e) => set('ussd', e.target.value)} placeholder="*180*5*2*AB*1*1#" />
        <small>Use AB where the customer phone number goes.</small>
      </label>
      {ussdChanged && (
        <p className="sa-hint">
          The USSD changed, so this plan's signature must be learned again. Users keep the old one until you save the new signature, then their apps update by themselves.
        </p>
      )}
      <label className="sa-field"><span>Safaricom price (KES)</span>
        <input type="number" inputMode="decimal" value={f.safPrice} onChange={(e) => set('safPrice', e.target.value)} />
      </label>

      <div className="sa-switch">
        <div><b>Only sold in a time window</b><small>Users choose what to sell outside these hours</small></div>
        <input type="checkbox" checked={Boolean(f.tw.on)} onChange={(e) => setTw('on', e.target.checked)} />
      </div>
      {f.tw.on && (
        <div className="sa-two">
          <label className="sa-field"><span>From</span>
            <input type="time" value={f.tw.from} onChange={(e) => setTw('from', e.target.value)} />
          </label>
          <label className="sa-field"><span>Until</span>
            <input type="time" value={f.tw.until} onChange={(e) => setTw('until', e.target.value)} />
          </label>
        </div>
      )}

      {!isNew && (
        <div className="sa-switch">
          <div><b>Visible to users</b><small>Untick to hide this plan from the catalog</small></div>
          <input type="checkbox" checked={Boolean(f.active)} onChange={(e) => set('active', e.target.checked)} />
        </div>
      )}
      {err && <p className="sa-err">{err}</p>}
    </Sheet>
  )
}

function LearnSheet({ plan, onClose, onDone }) {
  const [slot, setSlot] = useState(() => (loadConfig().bingwaSim === 'SIM 1' ? 0 : 1))
  const [learned, setLearned] = useState(null) // { signature, screens }
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function learn() {
    setErr('')
    if (!isNative()) return setErr('Learning only works in the Android app, on a phone with a SIM.')
    setBusy(true)
    try {
      if (!(await ussdServiceEnabled())) throw new Error('Turn on the AutoBingwa accessibility service first.')
      setLearned(await learnSignature({ ussd: plan.ussd, slot }))
    } catch (e) {
      setErr(String(e && e.message ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    setErr('')
    setSaving(true)
    try {
      await api(`/admin/smart-plans/${plan.sid}/signature`, 'POST', { signature: learned.signature })
      await onDone()
    } catch (e) {
      setErr(e.message || 'Could not save the signature.')
      setSaving(false)
    }
  }

  const sig = learned ? learned.signature : null
  const rows = sig
    ? sig.steps.map((s, i) => {
        if (s.kind === 'input') return { ok: true, text: "Types the customer's phone number" }
        if (s.kind === 'literal') {
          return s.unmatched
            ? { ok: false, text: `Option ${s.value} was not found on the screen` }
            : { ok: true, text: `Types ${s.value}` }
        }
        const raw = (parseMenu(learned.screens[i]).find((o) => o.n === s.hint) || {}).text
        return { ok: true, text: `Picks "${raw || s.label}" (option ${s.hint} today)` }
      })
    : []
  const locked = busy || saving

  return (
    <Sheet title="Learn signature" onClose={locked ? () => {} : onClose}
      footer={<>
        <button className="sa-btn" onClick={onClose} disabled={locked}>Cancel</button>
        <button className="sa-btn pri" onClick={publish} disabled={locked || !sig || !sig.complete}>
          {saving ? 'Saving…' : 'Save & publish'}
        </button>
      </>}>
      <p className="sa-hint"><b>{plan.name}</b> · <code>{plan.ussd}</code></p>

      <div className="sa-field"><span>Run from</span></div>
      <div className="sa-seg">
        <button className={slot === 0 ? 'on' : ''} onClick={() => setSlot(0)} disabled={locked}>SIM 1</button>
        <button className={slot === 1 ? 'on' : ''} onClick={() => setSlot(1)} disabled={locked}>SIM 2</button>
      </div>

      <button className="sa-btn" style={{ width: '100%' }} onClick={learn} disabled={locked}>
        {busy ? 'Learning…' : sig ? 'Learn again' : 'Learn signature'}
      </button>
      <p className="sa-hint">
        {busy
          ? 'Dialing the steps with the test number 0700000000. This can take up to 90 seconds. Keep the phone unlocked.'
          : 'Learning dials every step with the test number 0700000000 and stops before the last step, so nothing is bought. Stop automation first so a customer payment does not wait behind it.'}
      </p>

      {!sig && plan.sigView && plan.sigView.length > 0 && (
        <>
          <b>Saved steps (live now)</b>
          <ol className="sa-steps">{plan.sigView.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </>
      )}

      {sig && (
        <>
          <b>Steps found</b>
          <ol className="sa-steps">{rows.map((r, i) => <li key={i}>{r.ok ? '' : '⚠ '}{r.text}</li>)}</ol>
          {sig.complete
            ? <p className="sa-hint">The last step is the purchase. It was not sent. Save & publish makes this plan live for every user.</p>
            : <p className="sa-hint">Some steps could not be matched, so this cannot be saved. Check the USSD code, then learn again.</p>}
          <details>
            <summary className="sa-hint">What the phone showed at each step</summary>
            {learned.screens.map((s, i) => (
              <pre key={i} className="sa-pre">{`Step ${i + 1}\n${s}`}</pre>
            ))}
          </details>
        </>
      )}
      {err && <p className="sa-err">{err}</p>}
    </Sheet>
  )
}