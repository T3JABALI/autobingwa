import { useEffect, useState } from 'react';
import { adminFetch } from './adminApi';

const money = (n) => 'KSh ' + Number(n).toLocaleString('en-US');
const kindName = (k) => (k === 'days' ? 'Unlimited days' : 'Units');
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

function PlanForm({ plan, onClose, onSaved }) {
  const isNew = !plan;
  const [kind, setKind] = useState(plan ? plan.kind : 'units');
  const [amount, setAmount] = useState(plan ? String(plan.amount) : '');
  const [price, setPrice] = useState(plan ? String(plan.price) : '');
  const [label, setLabel] = useState(plan ? plan.label : '');
  const [active, setActive] = useState(plan ? plan.active : true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const digits = (set) => (e) => set(e.target.value.replace(/\D/g, '').slice(0, 7));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const body = { amount: Number(amount), price: Number(price), label: label.trim(), active };
      if (isNew) await adminFetch('/admin/tokens/plans', { method: 'POST', body: { ...body, kind } });
      else await adminFetch('/admin/tokens/plans/' + encodeURIComponent(plan.id), { method: 'PUT', body });
      setBusy(false);
      onSaved();
      return;
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!window.confirm('Delete this token plan for all users? Coupons already made keep their value.')) return;
    setBusy(true);
    setErr('');
    try {
      await adminFetch('/admin/tokens/plans/' + encodeURIComponent(plan.id), { method: 'DELETE' });
      setBusy(false);
      onSaved();
      return;
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  return (
    <div className="ad-modal" onClick={onClose}>
      <form className="ad-sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 className="ad-h2">{isNew ? 'Add token plan' : 'Edit token plan'}</h2>

        <div className="ad-field">
          <label>Type</label>
          <select className="ad-input" value={kind} onChange={(e) => setKind(e.target.value)} disabled={!isNew}>
            <option value="units">Units</option>
            <option value="days">Unlimited days</option>
          </select>
        </div>
        <div className="ad-field">
          <label>{kind === 'days' ? 'Number of days' : 'Number of units'}</label>
          <input className="ad-input" inputMode="numeric" value={amount} onChange={digits(setAmount)} required />
        </div>
        <div className="ad-field">
          <label>Price (KSh)</label>
          <input className="ad-input" inputMode="numeric" value={price} onChange={digits(setPrice)} required />
        </div>
        <div className="ad-field">
          <label>Name shown in the app (optional)</label>
          <input className="ad-input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === 'days' ? 'For example 7 days unlimited' : 'For example 1,000 units'} />
        </div>
        <label className="ad-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Show this plan in the app
        </label>

        {err && <div className="ad-err">{err}</div>}
        <button className="ad-btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {!isNew && <button type="button" className="ad-btn ad-btn-danger" onClick={remove} disabled={busy}>Delete plan</button>}
        <button type="button" className="ad-btn ad-btn-ghost" onClick={onClose}>Cancel</button>
      </form>
    </div>
  );
}

function Plans() {
  const [plans, setPlans] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(undefined); // undefined = closed, null = new plan, object = editing

  const load = async () => {
    try {
      setErr('');
      const j = await adminFetch('/admin/tokens/plans');
      setPlans(j.plans);
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (p) => {
    try {
      await adminFetch('/admin/tokens/plans/' + encodeURIComponent(p.id), { method: 'PUT', body: { active: !p.active } });
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <>
      <p className="ad-note">Changes save to the server and apply to every user of the app. The switch shows or hides a plan.</p>
      {err && <div className="ad-err">{err}</div>}
      {!plans && !err && <p className="ad-muted">Loading…</p>}
      {plans && (
        <div className="ad-card">
          {plans.map((p) => (
            <div className={'ad-plan' + (p.active ? '' : ' off')} key={p.id}>
              <div className="ad-plan-main">
                <b>{p.label}</b>
                <small>{kindName(p.kind)} • {p.id}</small>
              </div>
              <div className="ad-plan-price">{money(p.price)}</div>
              <button className={'ad-switch' + (p.active ? ' on' : '')} onClick={() => toggle(p)}
                aria-label={p.active ? 'Hide plan' : 'Show plan'}><i /></button>
              <button className="ad-small" onClick={() => setEdit(p)}>Edit</button>
            </div>
          ))}
          {plans.length === 0 && <p className="ad-muted ad-pad">No token plans yet.</p>}
        </div>
      )}
      <button className="ad-btn" onClick={() => setEdit(null)}>+ Add token plan</button>
      {edit !== undefined && (
        <PlanForm plan={edit} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); load(); }} />
      )}
    </>
  );
}

function Coupons() {
  const [plans, setPlans] = useState([]);
  const [data, setData] = useState(null);
  const [planId, setPlanId] = useState('');
  const [count, setCount] = useState('10');
  const [days, setDays] = useState('0');
  const [made, setMade] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const [p, c] = await Promise.all([adminFetch('/admin/tokens/plans'), adminFetch('/admin/coupons')]);
      const act = p.plans.filter((x) => x.active);
      setPlans(act);
      setData(c);
      setPlanId((cur) => cur || (act[0] ? act[0].id : ''));
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const generate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setCopied(false);
    try {
      const j = await adminFetch('/admin/coupons', { method: 'POST', body: { planId, count: Number(count), expiresDays: Number(days) } });
      setMade(j.codes);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(made.join('\n'));
      setCopied(true);
    } catch (e) {
      setErr('Could not copy. Select the codes and copy them by hand.');
    }
  };

  const revoke = async (code) => {
    if (!window.confirm('Revoke ' + code + '? It will stop working.')) return;
    try {
      await adminFetch('/admin/coupons/' + encodeURIComponent(code), { method: 'DELETE' });
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <>
      <form className="ad-card ad-pad" onSubmit={generate}>
        <h3 className="ad-h3">Generate coupons</h3>
        <div className="ad-field">
          <label>Token to gift</label>
          <select className="ad-input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="ad-row2">
          <div className="ad-field">
            <label>How many codes</label>
            <input className="ad-input" inputMode="numeric" value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </div>
          <div className="ad-field">
            <label>Expires</label>
            <select className="ad-input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="0">Never</option>
              <option value="7">After 7 days</option>
              <option value="30">After 30 days</option>
              <option value="90">After 90 days</option>
            </select>
          </div>
        </div>
        {err && <div className="ad-err">{err}</div>}
        <button className="ad-btn" disabled={busy || !planId}>{busy ? 'Generating…' : 'Generate'}</button>
      </form>

      {made.length > 0 && (
        <div className="ad-card ad-pad">
          <h3 className="ad-h3">New codes ({made.length})</h3>
          <pre className="ad-codes">{made.join('\n')}</pre>
          <button className="ad-btn" onClick={copyAll}>{copied ? 'Copied ✔' : 'Copy all'}</button>
        </div>
      )}

      {data && (
        <>
          <div className="ad-counts">
            <div><b>{data.counts.unused}</b><small>Unused</small></div>
            <div><b>{data.counts.used}</b><small>Used</small></div>
            <div><b>{data.counts.expired}</b><small>Expired</small></div>
            <div><b>{data.counts.revoked}</b><small>Revoked</small></div>
          </div>
          <div className="ad-card">
            {data.coupons.map((c) => (
              <div className="ad-cp" key={c.code}>
                <div className="ad-cp-main">
                  <b className="ad-mono">{c.code}</b>
                  <small>
                    {c.plan} • made {when(c.created)}
                    {c.status === 'used' ? ' • used ' + when(c.redeemedAt) : c.expires ? ' • expires ' + when(c.expires) : ''}
                  </small>
                </div>
                <span className={'ad-chip ' + c.status}>{c.status}</span>
                {c.status === 'unused' && <button className="ad-small" onClick={() => revoke(c.code)}>Revoke</button>}
              </div>
            ))}
            {data.coupons.length === 0 && <p className="ad-muted ad-pad">No coupons yet.</p>}
          </div>
        </>
      )}
    </>
  );
}

export default function TokensAdmin() {
  const [tab, setTab] = useState('plans');
  return (
    <>
      <div className="ad-tabs">
        <button className={'ad-tab' + (tab === 'plans' ? ' active' : '')} onClick={() => setTab('plans')}>Token plans</button>
        <button className={'ad-tab' + (tab === 'coupons' ? ' active' : '')} onClick={() => setTab('coupons')}>Coupons</button>
      </div>
      {tab === 'plans' ? <Plans /> : <Coupons />}
    </>
  );
}