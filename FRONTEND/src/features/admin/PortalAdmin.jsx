import { useEffect, useState } from 'react';
import { api } from './adminCall';
import './pc.css';

const money = (n) => 'KSh ' + Number(n).toLocaleString('en-US');

function PlanForm({ plan, count, onClose, onSaved }) {
  const isNew = !plan;
  const [f, setF] = useState(plan ? {
    name: plan.name, price: String(plan.price), days: String(plan.days), max: String(plan.max),
    history: String(plan.history), sort: String(plan.sort), active: plan.active, features: plan.features.join('\n'),
  } : { name: '', price: '', days: '31', max: '2', history: '3', sort: String(count + 1), active: true, features: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const text = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const digits = (k) => (e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = {
        name: f.name.trim(), price: Number(f.price), days: Number(f.days), max: Number(f.max),
        history: Number(f.history), sort: Number(f.sort || 0), active: f.active,
        features: f.features.split('\n'),
      };
      if (isNew) await api('/admin/portal/plans', 'POST', body);
      else await api('/admin/portal/plans/' + encodeURIComponent(plan.id), 'PUT', body);
      setBusy(false); onSaved(); return;
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  return (
    <div className="ad-modal" onClick={onClose}>
      <form className="ad-sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 className="ad-h2">{isNew ? 'Add portal plan' : 'Edit portal plan'}</h2>
        <div className="ad-field"><label>Plan name</label>
          <input className="ad-input" value={f.name} maxLength={40} onChange={text('name')} required /></div>
        <div className="ad-row2">
          <div className="ad-field"><label>Price (KSh)</label>
            <input className="ad-input" inputMode="numeric" value={f.price} onChange={digits('price')} required /></div>
          <div className="ad-field"><label>Access (days)</label>
            <input className="ad-input" inputMode="numeric" value={f.days} onChange={digits('days')} required /></div>
        </div>
        <div className="ad-row2">
          <div className="ad-field"><label>Devices allowed</label>
            <input className="ad-input" inputMode="numeric" value={f.max} onChange={digits('max')} required /></div>
          <div className="ad-field"><label>History (1 to 7 days)</label>
            <input className="ad-input" inputMode="numeric" value={f.history} onChange={digits('history')} required /></div>
        </div>
        <div className="ad-field"><label>Display order</label>
          <input className="ad-input" inputMode="numeric" value={f.sort} onChange={digits('sort')} /></div>
        <div className="ad-field"><label>Features (one per line)</label>
          <textarea className="ad-input" rows={5} value={f.features} onChange={text('features')} /></div>
        <label className="ad-check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Show this plan so it can be bought
        </label>
        {err && <div className="ad-err">{err}</div>}
        <button className="ad-btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="ad-btn ad-btn-ghost" onClick={onClose}>Cancel</button>
      </form>
    </div>
  );
}

export default function PortalAdmin() {
  const [plans, setPlans] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(undefined); // undefined = closed, null = new, object = editing

  const load = async () => {
    try { setErr(''); setPlans((await api('/admin/portal/plans')).plans); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (p) => {
    try { await api('/admin/portal/plans/' + encodeURIComponent(p.id), 'PUT', { active: !p.active }); load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <>
      <p className="ad-note">Price changes apply to new payments only. Current subscribers keep the time they paid for. Turning a plan off hides it from new buyers but never breaks existing subscribers.</p>
      {err && <div className="ad-err">{err}</div>}
      {!plans && !err && <p className="ad-muted">Loading…</p>}
      {plans && (
        <div className="ad-card">
          {plans.map((p) => (
            <div key={p.id}>
              <div className={'ad-plan' + (p.active ? '' : ' off')}>
                <div className="ad-plan-main">
                  <b>{p.name}</b>
                  <small>{p.subscribers} active • {p.max} device{p.max === 1 ? '' : 's'} • {p.history}d history • {p.days} days</small>
                </div>
                <div className="ad-plan-price">{money(p.price)}</div>
                <button className={'ad-switch' + (p.active ? ' on' : '')} onClick={() => toggle(p)}
                  aria-label={p.active ? 'Hide plan' : 'Show plan'}><i /></button>
                <button className="ad-small" onClick={() => setEdit(p)}>Edit</button>
              </div>
              {p.features.length > 0 && <small className="ad-muted" style={{ display: 'block', padding: '0 14px 12px' }}>{p.features.join(' • ')}</small>}
            </div>
          ))}
          {plans.length === 0 && <p className="ad-muted ad-pad">No plans yet.</p>}
        </div>
      )}
      <button className="ad-btn" onClick={() => setEdit(null)}>+ Add portal plan</button>
      {edit !== undefined && (
        <PlanForm plan={edit} count={plans ? plans.length : 0} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); load(); }} />
      )}
    </>
  );
}