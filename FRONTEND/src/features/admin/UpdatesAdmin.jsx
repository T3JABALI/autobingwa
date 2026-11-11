import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const BUCKET = 'apks';
const today = () => new Date().toISOString().slice(0, 10);

const DEFAULTS = {
  stats: [
    { v: '12,000+', l: 'Total Downloads' },
    { v: '4.5 ★', l: 'User Rating' },
    { v: '4 sec', l: 'Average Run Time' },
    { v: '24/7', l: 'Access Anytime' },
  ],
  contact: { phone: '+254797411114', whatsapp: '254797411114', whatsappText: 'Hello AutoBingwa, I need help.' },
  setup: [
    { t: 'Download the APK', d: 'Open the Downloads page, choose a release and tap Download.' },
    { t: 'Allow installs', d: 'If Android asks, turn on “Install unknown apps” for your browser or file manager.' },
    { t: 'Install the app', d: 'Open the downloaded file and tap Install. Install over your old version to keep your data.' },
    { t: 'Log in or create an account', d: 'Open AutoBingwa and sign in with your email and PIN.' },
    { t: 'Allow permissions', d: 'Accept the permissions the app asks for. For Advanced mode, switch on the AutoBingwa accessibility service. The Phone Setup page in the app guides you.' },
    { t: 'Keep it running', d: 'Allow AutoBingwa to run in the background and turn off battery saving for it, so automation is not stopped.' },
  ],
  faqs: [
    { q: 'Which version should I choose?', a: 'Choose the latest release for all features. Choose Lite if your phone is older or has little storage.' },
    { q: 'Will I lose my data when I update?', a: 'No. Install the new APK over the existing app and your saved flows and history stay in place.' },
    { q: "The app won't open after updating", a: 'Restart your phone and open the app again. If it still fails, contact us using the buttons below.' },
  ],
};

const msg = (e) => {
  const m = (e && e.message) || String(e);
  return /row-level security|permission|not authorized/i.test(m)
    ? 'Your account is not registered as an admin in Supabase yet. Run the admin SQL step.'
    : m;
};

const blank = () => ({
  name: 'AutoBingwa Android', version: '', version_code: '', label: 'latest',
  release_date: today(), size: '', about: '', included: '',
  mandatory: false, published: true, file: null,
});

export default function UpdatesAdmin() {
  const [tab, setTab] = useState('releases');
  return (
    <>
      <div className="ad-row2">
        <button className={'ad-btn' + (tab === 'releases' ? '' : ' ad-btn-ghost')} onClick={() => setTab('releases')}>Releases</button>
        <button className={'ad-btn' + (tab === 'content' ? '' : ' ad-btn-ghost')} onClick={() => setTab('content')}>Page content</button>
      </div>
      {tab === 'releases' ? <Releases /> : <Content />}
    </>
  );
}

/* ---------------- Releases ---------------- */
function Releases() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState('');

  const load = async () => {
    const { data, error } = await supabase.from('releases').select('*')
      .order('release_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) setErr(msg(error)); else { setRows(data); setErr(''); }
  };
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const edit = (r) => {
    setNote(''); setErr(''); setJson('');
    setForm({ ...r, version_code: r.version_code ?? '', included: (r.included || []).join('\n'), file: null });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setNote('');
    try {
      const f = form;
      if (!f.name.trim() || !f.version.trim()) throw new Error('Enter the name and the version, for example v1.0.9.');
      if (f.version_code !== '' && !Number.isInteger(Number(f.version_code))) throw new Error('Version code must be a whole number, for example 10.');
      const rec = {
        name: f.name.trim(), version: f.version.trim(), label: f.label,
        release_date: f.release_date, size: f.size, about: f.about,
        included: f.included.split('\n').map((s) => s.trim()).filter(Boolean),
        published: f.published, mandatory: f.mandatory,
        version_code: f.version_code === '' ? null : Number(f.version_code),
        sha256: f.sha256 || null, apk_path: f.apk_path || null,
      };
      if (f.file) {
        const path = ('AutoBingwa-' + rec.version + '.apk').replace(/\s+/g, '-');
        const hash = await crypto.subtle.digest('SHA-256', await f.file.arrayBuffer());
        rec.sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
        rec.size = (f.file.size / 1048576).toFixed(1) + ' MB';
        const up = await supabase.storage.from(BUCKET).upload(path, f.file, {
          upsert: true, cacheControl: '60', contentType: 'application/vnd.android.package-archive',
        });
        if (up.error) throw up.error;
        rec.apk_path = path;
      }
      const q = f.id ? supabase.from('releases').update(rec).eq('id', f.id) : supabase.from('releases').insert(rec);
      const { data, error } = await q.select().single();
      if (error) throw error;
      if (rec.label === 'latest') {
        await supabase.from('releases').update({ label: 'stable' }).neq('id', data.id).eq('label', 'latest');
      }
      setForm(null); setNote('Saved. The website is updated.');
      await load();
    } catch (e2) { setErr(msg(e2)); }
    setBusy(false);
  };

  const toggle = async (r) => {
    const { error } = await supabase.from('releases').update({ published: !r.published }).eq('id', r.id);
    if (error) setErr(msg(error)); else load();
  };

  const remove = async (r) => {
    if (!window.confirm('Delete ' + r.name + ' ' + r.version + '? This cannot be undone.')) return;
    const { error } = await supabase.from('releases').delete().eq('id', r.id);
    if (error) { setErr(msg(error)); return; }
    const shared = (rows || []).some((x) => x.id !== r.id && x.apk_path === r.apk_path);
    if (r.apk_path && !shared) await supabase.storage.from(BUCKET).remove([r.apk_path]);
    setNote('Release deleted.'); load();
  };

  const makeJson = () => {
    setErr(''); setNote('');
    const r = (rows || []).find((x) => x.label === 'latest' && x.published);
    if (!r) { setErr('Publish a release marked Latest first.'); return; }
    if (!r.version_code || !r.sha256 || !r.apk_path) {
      setErr('The Latest release needs a version code and an uploaded APK. Edit it, choose the APK file and save.'); return;
    }
    const url = supabase.storage.from(BUCKET).getPublicUrl(r.apk_path).data.publicUrl;
    setJson(JSON.stringify({
      versionCode: r.version_code, versionName: r.version.replace(/^v/i, ''),
      apkUrl: url, sha256: r.sha256, notes: r.included || [], mandatory: !!r.mandatory,
    }, null, 2));
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setNote('Copied.'); } catch (e) { setNote('Select the text and copy it.'); }
  };

  if (form) {
    return (
      <>
        <button className="ad-link" onClick={() => setForm(null)}>← All releases</button>
        <h3 className="ad-h3">{form.id ? 'Edit release' : 'New release'}</h3>
        <form className="ad-card ad-pad" onSubmit={save}>
          <div className="ad-field"><label>Name</label>
            <input className="ad-input" value={form.name} onChange={(e) => setF('name', e.target.value)} /></div>
          <div className="ad-field"><label>Version shown to people (for example v1.0.9)</label>
            <input className="ad-input" value={form.version} onChange={(e) => setF('version', e.target.value)} /></div>
          <div className="ad-field"><label>Version code (the Android build number, for example 10)</label>
            <input className="ad-input" inputMode="numeric" value={form.version_code} onChange={(e) => setF('version_code', e.target.value)} /></div>
          <div className="ad-field"><label>Label</label>
            <select className="ad-input" value={form.label} onChange={(e) => setF('label', e.target.value)}>
              <option value="latest">Latest release</option>
              <option value="stable">Stable version</option>
            </select></div>
          <div className="ad-field"><label>Release date</label>
            <input className="ad-input" type="date" value={form.release_date || ''} onChange={(e) => setF('release_date', e.target.value)} /></div>
          <div className="ad-field"><label>About this release</label>
            <textarea className="ad-input" rows={3} value={form.about || ''} onChange={(e) => setF('about', e.target.value)} /></div>
          <div className="ad-field"><label>What is included (one line each)</label>
            <textarea className="ad-input" rows={5} value={form.included} onChange={(e) => setF('included', e.target.value)} /></div>
          <div className="ad-field"><label>APK file {form.apk_path ? '(current: ' + form.apk_path + ', ' + (form.size || '') + ')' : ''}</label>
            <input type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => setF('file', e.target.files[0] || null)} />
            <small className="ad-muted">Choosing a file uploads it and fills in the size and checksum automatically.</small></div>
          <div className="ad-field"><label><input type="checkbox" checked={form.published} onChange={(e) => setF('published', e.target.checked)} /> Show on the website</label></div>
          <div className="ad-field"><label><input type="checkbox" checked={form.mandatory} onChange={(e) => setF('mandatory', e.target.checked)} /> Mandatory update (for the in-app updater)</label></div>
          {err && <div className="ad-err">{err}</div>}
          <button className="ad-btn" disabled={busy}>{busy ? 'Saving… do not close this page' : 'Save release'}</button>
        </form>
      </>
    );
  }

  return (
    <>
      <p className="ad-note">These are the releases shown on autobingwaapp.co.ke/updates. Changes go live immediately.</p>
      <button className="ad-btn" onClick={() => { setErr(''); setNote(''); setJson(''); setForm(blank()); }}>+ Add release</button>
      {note && <div className="ad-note">{note}</div>}
      {err && <div className="ad-err">{err}</div>}
      {!rows && !err && <p className="ad-muted">Loading…</p>}
      {rows && (
        <div className="ad-card">
          {rows.map((r) => (
            <div className="ad-plan" key={r.id}>
              <div className="ad-plan-main">
                <b>{r.name} {r.version}</b>
                <small>{r.label === 'latest' ? 'Latest' : 'Stable'} • {r.published ? 'Published' : 'Hidden'} • {r.size || 'no size'} • {r.apk_path ? 'APK uploaded' : 'No APK'}</small>
              </div>
              <button className="ad-small" onClick={() => edit(r)}>Edit</button>
              <button className="ad-small" onClick={() => toggle(r)}>{r.published ? 'Hide' : 'Show'}</button>
              <button className="ad-small" onClick={() => remove(r)}>Delete</button>
            </div>
          ))}
          {rows.length === 0 && <p className="ad-muted ad-pad">No releases yet.</p>}
        </div>
      )}
      <div className="ad-card ad-pad">
        <h3 className="ad-h3">In-app updater file</h3>
        <p className="ad-muted">Your installed apps read a version.json file. This builds it from the Latest release.</p>
        <button className="ad-btn ad-btn-ghost" onClick={makeJson}>Create version.json</button>
        {json && (
          <>
            <textarea className="ad-input" rows={10} readOnly value={json} />
            <button className="ad-btn" onClick={copy}>Copy</button>
          </>
        )}
      </div>
    </>
  );
}

/* ---------------- Page content ---------------- */
function List({ items, onChange, fields, blankItem, addLabel }) {
  const set = (i, k, v) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <>
      {items.map((it, i) => (
        <div className="ad-card ad-pad" key={i}>
          {fields.map(([k, label, multi]) => (
            <div className="ad-field" key={k}>
              <label>{label}</label>
              {multi
                ? <textarea className="ad-input" rows={3} value={it[k] || ''} onChange={(e) => set(i, k, e.target.value)} />
                : <input className="ad-input" value={it[k] || ''} onChange={(e) => set(i, k, e.target.value)} />}
            </div>
          ))}
          <button type="button" className="ad-small" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="ad-btn ad-btn-ghost" onClick={() => onChange([...items, { ...blankItem }])}>{addLabel}</button>
    </>
  );
}

function Content() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    (async () => {
      const { data: rows, error } = await supabase.from('site_content').select('key,value');
      if (error) { setErr(msg(error)); return; }
      const d = { ...DEFAULTS };
      rows.forEach((r) => { if (r.key in d && r.value) d[r.key] = r.value; });
      setData(d);
    })();
  }, []);

  const put = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const saveKey = async (key) => {
    setBusy(key); setErr(''); setNote('');
    const { error } = await supabase.from('site_content')
      .upsert({ key, value: data[key], updated_at: new Date().toISOString() });
    if (error) setErr(msg(error)); else setNote('Saved. The website is updated.');
    setBusy('');
  };

  if (!data) return err ? <div className="ad-err">{err}</div> : <p className="ad-muted">Loading…</p>;
  const c = data.contact;
  const setC = (k, v) => put('contact', { ...c, [k]: v });
  const saveBtn = (key) => (
    <button className="ad-btn" disabled={busy === key} onClick={() => saveKey(key)}>{busy === key ? 'Saving…' : 'Save'}</button>
  );

  return (
    <>
      {note && <div className="ad-note">{note}</div>}
      {err && <div className="ad-err">{err}</div>}

      <h3 className="ad-h3">Numbers on the home page</h3>
      <List items={data.stats} onChange={(v) => put('stats', v)} fields={[['v', 'Big value'], ['l', 'Label']]} blankItem={{ v: '', l: '' }} addLabel="+ Add number" />
      {saveBtn('stats')}

      <h3 className="ad-h3">Contact</h3>
      <div className="ad-card ad-pad">
        <div className="ad-field"><label>Phone number (with +254)</label>
          <input className="ad-input" value={c.phone || ''} onChange={(e) => setC('phone', e.target.value)} /></div>
        <div className="ad-field"><label>WhatsApp number (digits only, no +)</label>
          <input className="ad-input" value={c.whatsapp || ''} onChange={(e) => setC('whatsapp', e.target.value)} /></div>
        <div className="ad-field"><label>First WhatsApp message</label>
          <input className="ad-input" value={c.whatsappText || ''} onChange={(e) => setC('whatsappText', e.target.value)} /></div>
      </div>
      {saveBtn('contact')}

      <h3 className="ad-h3">How to set up the APK</h3>
      <List items={data.setup} onChange={(v) => put('setup', v)} fields={[['t', 'Step title'], ['d', 'Details', true]]} blankItem={{ t: '', d: '' }} addLabel="+ Add step" />
      {saveBtn('setup')}

      <h3 className="ad-h3">Common questions</h3>
      <List items={data.faqs} onChange={(v) => put('faqs', v)} fields={[['q', 'Question'], ['a', 'Answer', true]]} blankItem={{ q: '', a: '' }} addLabel="+ Add question" />
      {saveBtn('faqs')}
    </>
  );
}