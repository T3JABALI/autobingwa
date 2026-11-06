import { useEffect, useState } from 'react';
import { api, saveFile } from './adminCall';
import './pc.css';

const FORMATS = [
  ['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (opens in Sheets)'], ['vcf', 'vCard (.vcf)'],
  ['json', 'JSON'], ['txt', 'Numbers only (.txt)'],
];

export default function ContactsAdmin() {
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(null);
  const [fmt, setFmt] = useState('xlsx');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    try { setInfo(await api('/admin/contacts/batches')); setErr(''); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const exportIt = async (batch) => {
    setBusy(String(batch)); setErr(''); setNote('');
    try {
      const f = await api(`/admin/contacts/export?batch=${batch}&format=${fmt}`);
      saveFile(f); setNote(`Downloaded ${f.count.toLocaleString()} contacts.`);
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  const picker = (
    <select className="ad-input" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Export format">
      {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  if (open) return <Batch n={open} back={() => setOpen(null)} picker={picker} exportIt={exportIt} busy={busy} err={err} note={note} />;
  if (!info && !err) return <p className="ad-muted">Loading…</p>;

  return (
    <>
      <div className="ad-counts">
        <div><b>{info ? info.total.toLocaleString() : 0}</b><small>Contacts</small></div>
        <div><b>{info ? info.batches.length : 0}</b><small>Batches</small></div>
        <div><b>{info ? info.size.toLocaleString() : 2000}</b><small>Per batch</small></div>
      </div>
      <p className="ad-note">Every client who bought through the app, saved once by phone number. Each batch holds exactly {info ? info.size.toLocaleString() : 2000}.</p>
      <div className="ad-card ad-pad">
        <div className="ad-field"><label>Export format</label>{picker}</div>
        <button className="ad-btn" disabled={!info || !info.total || busy === 'all'} onClick={() => exportIt('all')}>
          {busy === 'all' ? 'Preparing…' : 'Export all contacts'}
        </button>
      </div>
      {note && <div className="ad-note">{note}</div>}
      {err && <div className="ad-err">{err}</div>}
      {info && (
        <div className="ad-card">
          {info.batches.map((b) => (
            <div className="ad-plan" key={b.batch}>
              <div className="ad-plan-main">
                <b>Batch {b.batch}</b>
                <small>{b.count.toLocaleString()} / {info.size.toLocaleString()} • {b.full ? 'Full' : 'Filling'}</small>
              </div>
              <button className="ad-small" onClick={() => setOpen(b.batch)}>View</button>
              <button className="ad-small" disabled={busy === String(b.batch)} onClick={() => exportIt(b.batch)}>
                {busy === String(b.batch) ? '…' : 'Export'}
              </button>
            </div>
          ))}
          {info.batches.length === 0 && <p className="ad-muted ad-pad">No contacts yet. They appear after clients buy through the app.</p>}
        </div>
      )}
    </>
  );
}

function Batch({ n, back, picker, exportIt, busy, err, note }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try { setData(await api(`/admin/contacts/batch/${n}?page=${page}&q=${encodeURIComponent(q)}`)); setLoadErr(''); }
      catch (e) { setLoadErr(e.message); }
    }, 250);
    return () => clearTimeout(t);
  }, [n, page, q]);

  return (
    <>
      <button className="ad-link" onClick={back}>← All batches</button>
      <h3 className="ad-h3">Batch {n}</h3>
      <div className="ad-card ad-pad">
        <div className="ad-field"><label>Export format</label>{picker}</div>
        <button className="ad-btn" disabled={busy === String(n)} onClick={() => exportIt(n)}>
          {busy === String(n) ? 'Preparing…' : 'Export this batch'}
        </button>
      </div>
      <div className="ad-field">
        <input className="ad-input" placeholder="Search name or phone" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {note && <div className="ad-note">{note}</div>}
      {(err || loadErr) && <div className="ad-err">{err || loadErr}</div>}
      <div className="ad-card ad-pad pc-scroll">
        <table className="pc-table">
          <thead><tr><th>No</th><th>Name</th><th>Phone</th></tr></thead>
          <tbody>
            {data && data.contacts.map((c) => <tr key={c.no}><td>{c.no}</td><td>{c.name || '—'}</td><td>{c.phone}</td></tr>)}
            {data && !data.contacts.length && <tr><td colSpan={3}>No contacts found.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="ad-row2">
          <button className="ad-btn ad-btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="ad-btn ad-btn-ghost" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {data && <p className="ad-muted">Page {data.page} of {data.pages} • {data.total.toLocaleString()} contacts</p>}
    </>
  );
}