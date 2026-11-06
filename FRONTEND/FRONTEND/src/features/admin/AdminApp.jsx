import { useState } from 'react'

const ADMIN_NAME = 'Jabali'

/* ---------- Icons (inline SVG, no extra package needed) ---------- */
const ICONS = {
  menu: <><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
  coins: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
  globe: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
  contacts: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  settings: <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  chart: <><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>,
  wallet: <><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></>,
  swap: <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
  check: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  arrowRight: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
  arrowUp: <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  sun: <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>,
}

function Icon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

/* ---------- Menu + pages ---------- */
const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'smartplans', label: 'Smart Plans', icon: 'bolt' },
  { id: 'tokens', label: 'Tokens', icon: 'coins' },
  { id: 'portal', label: 'Portal Subscription', icon: 'globe' },
  { id: 'contacts', label: 'Contacts', icon: 'contacts' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'updates', label: 'Updates', icon: 'download' },
]
const QUICK = [
  { id: 'users', label: 'Users', sub: 'Manage app users', icon: 'users' },
  { id: 'analytics', label: 'Analytics', sub: 'View app stats', icon: 'chart' },
  { id: 'income', label: 'Income', sub: 'Track revenue', icon: 'wallet' },
]
const TITLES = Object.fromEntries([...NAV, ...QUICK].map((p) => [p.id, p.label]))

// SAMPLE DATA: replace with real numbers once the /admin stats routes exist
const STATS = [
  { label: 'Transactions', value: '1,284', change: '+12.8%', icon: 'swap' },
  { label: 'Completed', value: '1,196', change: '93.1%', icon: 'check' },
  { label: 'Income', value: 'KSh 84,650', change: '+15.4%', icon: 'wallet' },
]
const RECENT = [
  { id: 'TXN-20481', type: 'Token Subscription', time: '09:15 AM', amount: 500, method: 'M-PESA' },
  { id: 'TXN-20480', type: 'Portal Subscription', time: '08:52 AM', amount: 1000, method: 'Airtime' },
  { id: 'TXN-20479', type: 'Token Subscription', time: '08:40 AM', amount: 250, method: 'M-PESA' },
  { id: 'TXN-20478', type: 'Portal Subscription', time: '08:20 AM', amount: 750, method: 'M-PESA' },
  { id: 'TXN-20477', type: 'Token Subscription', time: '08:05 AM', amount: 300, method: 'Airtime' },
]

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function AdminApp({ logout }) {
  const [page, setPage] = useState('home')
  const [open, setOpen] = useState(false)
  const go = (id) => { setPage(id); setOpen(false) }

  return (
    <div className="ad">
      <style>{CSS}</style>

      <header className="ad-top">
        <button className="ad-menu" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" size={26} /></button>
        <div className="ad-brand">
          <div className="ad-logo">Auto<span>Bingwa</span></div>
          <div className="ad-sub">SUPER ADMIN</div>
        </div>
        <div className="ad-avatar">{ADMIN_NAME[0]}</div>
      </header>

      <main className="ad-main">
        {page === 'home' ? (
          <>
            <div className="ad-hello">
              <div>
                <div className="ad-greet"><span className="ad-sun"><Icon name="sun" size={26} /></span>{greeting()}, {ADMIN_NAME}</div>
                <h1>Home Dashboard</h1>
              </div>
              <div className="ad-badge"><Icon name="shield" size={16} /> SUPER ADMIN</div>
            </div>

            <div className="ad-stats">
              {STATS.map((s) => (
                <div className="ad-stat" key={s.label}>
                  <Icon name={s.icon} size={26} />
                  <div className="ad-stat-l">{s.label}</div>
                  <div className="ad-stat-v">{s.value}</div>
                  <div className="ad-stat-c"><Icon name="arrowUp" size={14} /> {s.change}</div>
                </div>
              ))}
            </div>

            <section className="ad-card">
              <div className="ad-card-h">
                <span className="ad-ico"><Icon name="clock" size={26} /></span>
                <div>
                  <div className="ad-card-t">Recent Transactions</div>
                  <div className="ad-card-s">Latest subscription payments</div>
                </div>
                <button className="ad-link" onClick={() => go('income')}>View All <Icon name="arrowRight" size={16} /></button>
              </div>
              {RECENT.map((t) => (
                <div className="ad-row" key={t.id}>
                  <span className="ad-ico sm"><Icon name={t.type.startsWith('Portal') ? 'globe' : 'coins'} size={22} /></span>
                  <div className="ad-row-m">
                    <div className="ad-row-t">{t.type}</div>
                    <div className="ad-row-s">{t.id} • {t.time}</div>
                  </div>
                  <div className="ad-row-a">
                    <div className="ad-row-t">KSh {t.amount.toLocaleString()}</div>
                    <div className="ad-row-s">{t.method}</div>
                  </div>
                  <span className="ad-pill"><Icon name="check" size={16} /> Completed</span>
                </div>
              ))}
            </section>

            <div className="ad-qh"><Icon name="settings" size={20} /> Quick Access</div>
            <div className="ad-quick">
              {QUICK.map((q) => (
                <button className="ad-q" key={q.id} onClick={() => go(q.id)}>
                  <Icon name={q.icon} size={30} />
                  <b>{q.label}</b>
                  <small>{q.sub} →</small>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="ad-soon">
            <h1>{TITLES[page]}</h1>
            <p>This dashboard is coming next.</p>
            <button className="ad-link" onClick={() => go('home')}>Back to Home</button>
          </div>
        )}
      </main>

      <footer className="ad-foot">AutoBingwa Admin Portal • v1.0</footer>

      {open && <div className="ad-shade" onClick={() => setOpen(false)} />}
      <aside className={'ad-drawer' + (open ? ' on' : '')}>
        <div className="ad-drawer-h">
          <div className="ad-logo">Auto<span>Bingwa</span></div>
          <button className="ad-x" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={'ad-nav' + (page === n.id ? ' cur' : '')} onClick={() => go(n.id)}>
              <Icon name={n.icon} /> {n.label}
            </button>
          ))}
        </nav>
        <button className="ad-nav out" onClick={logout}><Icon name="logout" /> Log out</button>
      </aside>
    </div>
  )
}

const CSS = `
.ad{--o:#f58a07;--bg:#0a1226;--card:#101a33;--line:#1d2a4a;--tx:#fff;--mu:#8fa0c4;
  min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:linear-gradient(180deg,#0a1226,#070d1c);
  color:var(--tx);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow-x:hidden}
.ad button{font:inherit;color:inherit;cursor:pointer}
.ad-top{display:flex;align-items:center;gap:14px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 12px;border-bottom:1px solid var(--line)}
.ad-menu{width:52px;height:52px;border:0;border-radius:14px;background:linear-gradient(135deg,#ff9d1c,#e57800);color:#fff;display:grid;place-items:center}
.ad-brand{flex:1}
.ad-logo{font-size:28px;font-weight:800;line-height:1}
.ad-logo span{color:var(--o)}
.ad-sub{font-size:12px;letter-spacing:.14em;color:var(--mu);margin-top:4px}
.ad-avatar{width:48px;height:48px;border-radius:50%;background:var(--o);display:grid;place-items:center;font-weight:800;font-size:22px}
.ad-main{flex:1;padding:16px}
.ad-hello{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:16px}
.ad-greet{display:flex;align-items:center;gap:10px;font-size:17px;color:#dbe4ff}
.ad-sun{color:var(--o);display:flex}
.ad h1{margin:6px 0 0;font-size:32px;font-weight:800}
.ad-badge{display:flex;align-items:center;gap:6px;white-space:nowrap;padding:8px 12px;border-radius:12px;border:1px solid #7a4a10;background:#2a1d0c;color:var(--o);font-size:12px;font-weight:700}
.ad-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.ad-stat{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--o);border-radius:16px;padding:14px 10px}
.ad-stat-l{color:#c6d2f0;font-size:14px;margin-top:8px}
.ad-stat-v{font-size:22px;font-weight:800;margin:4px 0;white-space:nowrap}
.ad-stat-c{display:flex;align-items:center;gap:4px;color:#2fd47a;font-size:14px;font-weight:600}
.ad-card{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:18px}
.ad-card-h{display:flex;align-items:center;gap:12px;padding:14px;border-bottom:1px solid var(--line)}
.ad-card-h>div:nth-child(2){flex:1}
.ad-card-t{font-size:19px;font-weight:700}
.ad-card-s{color:var(--mu);font-size:14px}
.ad-ico{color:var(--o);display:flex}
.ad-ico.sm{width:44px;height:44px;border-radius:50%;background:#3a2410;align-items:center;justify-content:center;flex:none}
.ad-link{display:flex;align-items:center;gap:4px;background:none;border:0;color:var(--o);font-weight:700;font-size:15px}
.ad-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
.ad-row:last-child{border-bottom:0}
.ad-row-m{flex:1;min-width:0}
.ad-row-t{font-weight:700;font-size:15px}
.ad-row-s{color:var(--mu);font-size:12px;margin-top:2px}
.ad-row-a{text-align:right}
.ad-pill{display:flex;align-items:center;gap:4px;padding:6px 8px;border-radius:999px;background:#0f3b2b;border:1px solid #1c8a5a;color:#e8fff3;font-size:12px;font-weight:700;white-space:nowrap}
.ad-qh{display:flex;align-items:center;gap:10px;color:var(--o);font-weight:700;font-size:18px;margin-bottom:10px}
.ad-qh{color:#fff}.ad-qh svg{color:var(--o)}
.ad-quick{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.ad-q{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 6px;color:var(--o)!important}
.ad-q b{color:#fff;font-size:17px}
.ad-q small{color:var(--mu);font-size:12px}
.ad-soon{text-align:center;padding:60px 10px}
.ad-soon p{color:var(--mu)}
.ad-soon .ad-link{margin:16px auto 0}
.ad-foot{border-top:3px solid var(--o);padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 14px);text-align:center;color:var(--mu);font-size:14px}
.ad-shade{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20}
.ad-drawer{position:fixed;top:0;bottom:0;left:0;width:78%;max-width:320px;background:#0c1630;border-right:1px solid var(--line);z-index:30;
  transform:translateX(-100%);transition:transform .25s;display:flex;flex-direction:column;padding:calc(env(safe-area-inset-top,0px) + 14px) 12px calc(env(safe-area-inset-bottom,0px) + 14px)}
.ad-drawer.on{transform:none}
.ad-drawer-h{display:flex;justify-content:space-between;align-items:center;padding:0 6px 16px}
.ad-x{background:none;border:0;color:var(--mu)}
.ad-drawer nav{flex:1;display:flex;flex-direction:column;gap:4px}
.ad-nav{display:flex;align-items:center;gap:14px;width:100%;padding:14px;border:0;border-radius:12px;background:none;font-size:16px;text-align:left}
.ad-nav svg{color:var(--o)}
.ad-nav.cur{background:#1b2547;font-weight:700}
.ad-nav.out{border-top:1px solid var(--line);border-radius:0;margin-top:8px}
`