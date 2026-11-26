import { useEffect, useState } from 'react';
import { adminFetch } from './adminApi';

const line = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid rgba(128,128,128,.2)' };
const box = { width: '100%', padding: 8, marginBottom: 10 };

export default function ConnectAdmin() {
  const [plans, setPlans] = useState([]);
  const [edit, setEdit] = useState({});
  const [days, setDays] = useState('30');
  const [count, setCount] = useState('1');
  const [expires, setExpires] = useState('30');
  const [fresh, setFresh] = useState([]);
  const [list, setList] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  const loadPlans = async () => {
    try {
      const j = await adminFetch('/admin/connect/plans');
      setPlans(j.plans || []);
      setEdit({});
    } catch (e) { setMsg(e.message); }
  };
  const loadCoupons = async () => {
    try {
      const j = await adminFetch('/admin/connect/coupons');
      setList(j.coupons || []);
    } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { loadPlans(); loadCoupons(); }, []);

  const savePrice = async (p) => {
    const price = Number(edit[p.id]);
    if (!Number.isInteger(price) || price < 1) { setMsg('Enter a whole number above 0.'); return; }
    setBusy(p.id); setMsg('');
    try {
      await adminFetch('/admin/connect/plans/' + p.id, { method: 'PUT', body: { price } });
      setMsg(p.name + ' is now KES ' + price + '. Phones pick it up the next time they open the app or the Subscription page.');
      await loadPlans();
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  const generate = async () => {
    setBusy('gen'); setMsg('');
    try {
      const j = await adminFetch('/admin/connect/coupons', {
        method: 'POST',
        body: { days: Number(days), count: Number(count), expiresDays: Number(expires) || 0 },
      });
      setFresh(j.codes || []);
      await loadCoupons();
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  const revoke = async (code) => {
    try {
      await adminFetch('/admin/connect/coupons/' + code, { method: 'DELETE' });
      await loadCoupons();
    } catch (e) { setMsg(e.message); }
  };

  const copy = (t) => {
    try { navigator.clipboard.writeText(t); setMsg('Copied.'); } catch (e) { /* ignore */ }
  };

  return (
    <>
      <div className="ad-card ad-pad">
        <p className="ad-big">Connect plan prices</p>
        <p className="ad-muted">Change a price and phones update by themselves. No app update needed.</p>
        {plans.map((p) => (
          <div key={p.id} style={line}>
            <div style={{ flex: 1 }}>
              <b>{p.name}</b>
              <p className="ad-muted" style={{ margin: 0 }}>{p.days} {p.days === 1 ? 'day' : 'days'} · now KES {p.price}</p>
            </div>
            <input type="number" inputMode="numeric" min="1" style={{ width: 90, padding: 8 }}
              placeholder={String(p.price)} value={edit[p.id] ?? ''}
              onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} />
            <button className="ad-btn" onClick={() => savePrice(p)} disabled={busy === p.id || !edit[p.id]}>
              {busy === p.id ? 'Saving…' : 'Save'}
            </button>
          </div>
        ))}
      </div>

      <div className="ad-card ad-pad">
        <p className="ad-big">Generate coupons</p>
        <label className="ad-muted">Free days per coupon</label>
        <input style={box} type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} />
        <label className="ad-muted">How many codes (1 to 100)</label>
        <input style={box} type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} />
        <label className="ad-muted">Code expires after (days, 0 = never)</label>
        <input style={box} type="number" min="0" max="365" value={expires} onChange={(e) => setExpires(e.target.value)} />
        <button className="ad-btn" onClick={generate} disabled={busy === 'gen'}>{busy === 'gen' ? 'Generating…' : 'Generate'}</button>
        {msg && <p className="ad-result">{msg}</p>}
      </div>

      {fresh.length > 0 && (
        <div className="ad-card ad-pad">
          <p className="ad-big">New codes</p>
          {fresh.map((c) => (
            <p key={c} style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0' }}>
              <b>{c}</b>
              <button className="ad-btn ad-btn-ghost" onClick={() => copy(c)}>Copy</button>
            </p>
          ))}
          <button className="ad-btn ad-btn-ghost" onClick={() => copy(fresh.join('\n'))}>Copy all</button>
        </div>
      )}

      <div className="ad-card ad-pad">
        <p className="ad-big">All Connect coupons</p>
        {list.length === 0 && <p className="ad-muted">None yet.</p>}
        {list.map((c) => (
          <div key={c.code} style={line}>
            <div style={{ flex: 1 }}>
              <b>{c.code}</b>
              <p className="ad-muted" style={{ margin: 0 }}>{c.days} days · {c.status}</p>
            </div>
            {c.status === 'unused' && (
              <button className="ad-btn ad-btn-ghost" onClick={() => revoke(c.code)}>Revoke</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}