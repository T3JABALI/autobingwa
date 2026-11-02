import { useEffect, useState } from "react";

/* ===== Settings =====
   USE_MOCK=true runs on sample data. Set it to false and fill API_URL when the server is ready.
   Server routes (the owner is taken from the login token, never from the request):
   GET    /sitelink               -> { link:{siteName,username,payoutPhone}|null, plans:[{id,name,cat,price,on}] }
   GET    /sitelink/check/:user   -> { available:boolean }
   POST   /sitelink               {siteName,username,payoutPhone}
   POST   /sitelink/offers        {ids:[planId,...]}   switches those plans on for the site
   DELETE /sitelink/offers/:id    switches that plan off for the site */
const USE_MOCK = true;
const API_URL = "https://YOUR_PROJECT_REF.supabase.co/functions/v1";
const SITE_BASE = "https://bingwahybrid.com/"; // until the domain is connected, use your Netlify link plus "/"
const RESERVED = ["admin","api","site","portal","app","login","support","help","www","sitelink"];

const M = {
  link: null,
  taken: ["admin", "jabali", "test"],
  plans: [
    { id: "p1", name: "750MBs+50SMS, 24Hrs", cat: "Data", price: 50, on: false },
    { id: "p2", name: "400MBs, 7Days", cat: "Data", price: 49, on: false },
    { id: "p3", name: "1GB 1Hr, Bingwa", cat: "Data", price: 19, on: false },
    { id: "p4", name: "250MBs, 24Hrs", cat: "Data", price: 20, on: false },
    { id: "p5", name: "20 SMS, 1 Day", cat: "SMS", price: 5, on: false },
  ],
};
function mockApi(m, p, b) {
  if (m === "GET" && p === "/sitelink") return { link: M.link, plans: M.plans.map(x => ({ ...x })) };
  if (m === "GET" && p.startsWith("/sitelink/check/")) return { available: !M.taken.includes(p.split("/").pop()) };
  if (m === "POST" && p === "/sitelink") {
    if (M.taken.includes(b.username)) throw new Error("That username is taken");
    M.taken.push(b.username); M.link = { ...b }; return { ok: true };
  }
  if (m === "POST" && p === "/sitelink/offers") { M.plans.forEach(x => { if (b.ids.includes(x.id)) x.on = true; }); return { ok: true }; }
  if (m === "DELETE" && p.startsWith("/sitelink/offers/")) {
    const x = M.plans.find(q => q.id === p.split("/").pop()); if (x) x.on = false; return { ok: true };
  }
  return { ok: true };
}
async function api(method, path, body) {
  if (USE_MOCK) { await new Promise(r => setTimeout(r, 350)); return mockApi(method, path, body); }
  const r = await fetch(API_URL + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (localStorage.getItem("token") || "") }, // use however the app stores its login
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Something went wrong"); }
  return r.json();
}

const cleanUser = v => v.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20);
const phoneOk = v => { const p = String(v).replace(/[\s+-]/g, "").replace(/^254/, "0"); return /^0[17]\d{8}$/.test(p) ? p : ""; };

/* ===== Create screen ===== */
function Create({ onDone, onBack }) {
  const [name, setName] = useState(""), [user, setUser] = useState(""), [phone, setPhone] = useState("");
  const [avail, setAvail] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const uErr = !user ? "" : user.length < 3 ? "Username must be at least 3 characters"
    : /^-|-$/.test(user) ? "Username cannot start or end with a hyphen"
    : RESERVED.includes(user) ? "That username is not available" : "";

  useEffect(() => {
    setAvail(null);
    if (!user || uErr) return;
    const t = setTimeout(async () => { try { setAvail((await api("GET", "/sitelink/check/" + user)).available); } catch {} }, 500);
    return () => clearTimeout(t);
  }, [user]);

  async function create() {
    const p = phoneOk(phone);
    if (!name.trim()) return setErr("Enter the site name");
    if (!user) return setErr("Enter a username");
    if (uErr) return setErr(uErr);
    if (avail === false) return setErr("That username is taken");
    if (!p) return setErr("Enter a valid M-Pesa number, for example 0712345678");
    setBusy(true); setErr("");
    try { await api("POST", "/sitelink", { siteName: name.trim(), username: user, payoutPhone: p }); await onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div>
      <div className="sl-row" style={{ marginBottom: 14 }}>
        {onBack && <button className="sl-x ghost" onClick={onBack} aria-label="Back">←</button>}
        <h2 style={{ margin: 0 }}>Create SiteLink</h2>
      </div>
      <label className="sl-lab" htmlFor="sn">Site name
        <input id="sn" className="sl-in" value={name} onChange={e => setName(e.target.value)} placeholder="Site Name e.g. Bingwa Enterprises" maxLength={40} />
      </label>
      <p className="sl-url">{SITE_BASE}<b>{user}</b></p>
      <label className="sl-lab" htmlFor="un">Username
        <input id="un" className="sl-in" value={user} onChange={e => setUser(cleanUser(e.target.value))} placeholder="Username" autoCapitalize="none" autoComplete="off" />
      </label>
      <p className={"sl-hint" + (uErr || avail === false ? " bad" : "")}>
        {uErr || (avail === false ? "That username is taken" : avail === true ? "✓ Username is available" : "Username must be at least 3 characters")}
      </p>
      <p className="sl-lab" style={{ marginTop: 18 }}>Payout Account</p>
      <label className="sl-row" style={{ margin: "8px 0" }}>
        <input type="radio" checked readOnly style={{ accentColor: "var(--ac)", width: 22, height: 22 }} /> M-Pesa
      </label>
      <label className="sl-lab" htmlFor="mp">M-Pesa Number
        <input id="mp" className="sl-in" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="M-Pesa Number" />
      </label>
      <p className="sl-err" role="alert">{err}</p>
      <button className="sl-btn full" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create"}</button>
    </div>
  );
}

/* ===== Dashboard after creating ===== */
function Dash({ link, plans, reload, onBack }) {
  const [edit, setEdit] = useState(false), [adding, setAdding] = useState(false);
  const [pick, setPick] = useState([]), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const url = SITE_BASE + link.username;
  const live = plans.filter(p => p.on), spare = plans.filter(p => !p.on);
  const flash = m => { setNote(m); setTimeout(() => setNote(""), 3000); };
  const copy = async () => { try { await navigator.clipboard.writeText(url); flash("Link copied"); } catch { flash("Could not copy. Press and hold the link to copy it."); } };
  const remove = async p => { setBusy(true); try { await api("DELETE", "/sitelink/offers/" + p.id); await reload(); flash(p.name + " removed from your site"); } catch (e) { flash(e.message); } setBusy(false); };
  const addSel = async () => {
    if (!pick.length) return; setBusy(true);
    try { await api("POST", "/sitelink/offers", { ids: pick }); await reload(); flash(pick.length + (pick.length > 1 ? " offers added" : " offer added")); setAdding(false); setPick([]); }
    catch (e) { flash(e.message); } setBusy(false);
  };
  const toggle = id => setPick(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  return (
    <div>
      <div className="sl-row" style={{ marginBottom: 12 }}>
        {onBack && <button className="sl-x ghost" onClick={onBack} aria-label="Back to Home">←</button>}
        <h2 style={{ margin: 0 }}>Sitelink</h2>
      </div>
      <div className="sl-card">
        <small className="sl-mu">Your site</small>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{link.siteName}</div>
        <a className="sl-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
        <small className="sl-mu" style={{ display: "block", margin: "6px 0 12px" }}>Payments go to M-Pesa {link.payoutPhone}</small>
        <div className="sl-row">
          <a className="sl-btn g1" href={url} target="_blank" rel="noopener noreferrer">Open</a>
          <button className="sl-btn gh g1" onClick={copy}>Copy</button>
          <a className="sl-btn gh g1" href={"https://wa.me/?text=" + encodeURIComponent(link.siteName + " - " + url)} target="_blank" rel="noopener noreferrer">Share</a>
        </div>
      </div>

      <div className="sl-sec">
        <h3>Offers on your site ({live.length})</h3>
        {live.length > 0 && <button className="sl-btn gh sm" onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit"}</button>}
        <button className="sl-plus" onClick={() => { setPick([]); setAdding(true); }} aria-label="Add offers">+</button>
      </div>

      {live.length === 0 && <p className="sl-mu" style={{ textAlign: "center", margin: "28px 0" }}>No offers yet. Tap + to add offers from your Data Plans.</p>}
      {live.map(p => (
        <div className="sl-card sl-row" key={p.id}>
          <span className="sl-g"><b>{p.name}</b><small className="sl-mu" style={{ display: "block" }}>{p.cat}, KES {p.price}</small></span>
          {edit && <button className="sl-x" onClick={() => remove(p)} disabled={busy} aria-label={"Remove " + p.name}>Remove</button>}
        </div>
      ))}
      {edit && live.length > 0 && <p className="sl-hint">Removing an offer only hides it from your site. It stays in Data Plans.</p>}

      {adding && (
        <div className="sl-bg" onClick={e => { if (e.target === e.currentTarget) setAdding(false); }}>
          <div className="sl-sheet" role="dialog" aria-modal="true" aria-label="Add offers">
            <h3 style={{ margin: "0 0 4px" }}>Add offers</h3>
            <p className="sl-mu" style={{ margin: "0 0 10px" }}>Choose from your Data Plans.</p>
            {spare.length === 0 && <p className="sl-mu">All your data plans are already on the site. Add more in Data Plans first.</p>}
            {spare.map(p => (
              <label className="sl-pick" key={p.id}>
                <input type="checkbox" checked={pick.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="sl-g"><b>{p.name}</b><small className="sl-mu" style={{ display: "block" }}>{p.cat}</small></span>
                <b>KES {p.price}</b>
              </label>
            ))}
            <div className="sl-row" style={{ marginTop: 14 }}>
              <button className="sl-btn gh g1" onClick={() => setAdding(false)}>Cancel</button>
              <button className="sl-btn g1" onClick={addSel} disabled={busy || !pick.length}>{pick.length ? "Add " + pick.length : "Add"}</button>
            </div>
          </div>
        </div>
      )}
      {note && <div className="sl-note" role="status">{note}</div>}
    </div>
  );
}

/* ===== Entry ===== */
export default function Sitelink({ onBack }) {
  const [s, setS] = useState({ loading: true, link: null, plans: [], error: "" });
  const load = async () => {
    try { const r = await api("GET", "/sitelink"); setS({ loading: false, link: r.link, plans: r.plans || [], error: "" }); }
    catch (e) { setS(o => ({ ...o, loading: false, error: e.message })); }
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="sl">
      <style>{CSS}</style>
      {s.loading ? <p className="sl-mu">Loading…</p>
        : s.error ? <div><p className="sl-err">{s.error}</p><button className="sl-btn" onClick={load}>Try again</button></div>
        : s.link ? <Dash link={s.link} plans={s.plans} reload={load} onBack={onBack} />
        : <Create onDone={load} onBack={onBack} />}
    </div>
  );
}

/* ===== Styles (teal palette from your dashboard; light mode follows data-theme="light") ===== */
const CSS = `
.sl{--bg:#0D2F2F;--c2:#134240;--bd:#2A6460;--ac:#3DD9B3;--on:#062524;--tx:#E6FBF4;--mu:#9CC2BA;--bad:#FF8A98;color:var(--tx);font-size:15px;line-height:1.45}
[data-theme="light"] .sl{--bg:#FFFFFF;--c2:#EAF6F3;--bd:#B7D6CE;--ac:#0B7A61;--on:#FFFFFF;--tx:#0B2623;--mu:#46665F;--bad:#C4283D}
.sl *{box-sizing:border-box}
.sl h2{font-size:22px;margin:0 0 12px}
.sl-mu{color:var(--mu)}
.sl-lab{display:block;margin-top:14px;font-weight:600}
.sl-in{display:block;width:100%;margin-top:6px;padding:14px;border:1.5px solid var(--bd);border-radius:12px;background:transparent;color:var(--tx);font:inherit}
.sl-in:focus,.sl button:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.sl-url{color:var(--ac);overflow-wrap:anywhere;margin:10px 2px 0}.sl-url b{font-weight:700}
.sl-link{display:block;color:var(--ac);overflow-wrap:anywhere;margin:6px 0;font-weight:600}
.sl-hint{font-size:13px;color:var(--mu);margin:6px 4px 0}.sl-hint.bad{color:var(--bad)}
.sl-err{color:var(--bad);font-weight:600;min-height:1.3em;margin:10px 0}
.sl-btn{border:0;border-radius:99px;padding:13px 18px;font:inherit;font-weight:700;background:var(--ac);color:var(--on);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.sl-btn.gh{background:transparent;color:var(--tx);border:1.5px solid var(--bd)}
.sl-btn.full{width:100%}.sl-btn.sm{padding:9px 16px}.sl-btn:disabled{opacity:.55}
.sl-card{background:var(--c2);border:1px solid var(--bd);border-radius:16px;padding:14px;margin-bottom:12px}
.sl-row{display:flex;align-items:center;gap:10px}.sl-g{flex:1;min-width:0}.g1{flex:1}
.sl-sec{display:flex;align-items:center;gap:8px;margin:20px 0 10px}.sl-sec h3{margin:0;font-size:17px;flex:1}
.sl-plus{width:46px;height:46px;border-radius:50%;border:0;background:var(--ac);color:var(--on);font-size:28px;line-height:1;cursor:pointer}
.sl-x{border:1.5px solid var(--bad);color:var(--bad);background:transparent;border-radius:10px;padding:9px 12px;font:inherit;font-weight:700;cursor:pointer}
.sl-x.ghost{border-color:var(--bd);color:var(--tx);font-size:18px;line-height:1}
.sl-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:grid;align-items:end;z-index:100}
.sl-sheet{background:var(--bg);border-radius:22px 22px 0 0;padding:20px 18px 24px;max-height:85vh;overflow:auto;width:100%;max-width:640px;margin:0 auto}
.sl-pick{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--bd)}
.sl-pick input{width:22px;height:22px;accent-color:var(--ac)}
.sl-note{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--tx);color:var(--bg);padding:11px 18px;border-radius:12px;max-width:88vw;z-index:120;font-weight:600}
`;