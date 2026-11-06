import { useState } from 'react';
import { adminFetch } from './adminApi';
import TokensAdmin from './TokensAdmin';
import './admin.css';
import PortalAdmin from './PortalAdmin';
import ContactsAdmin from './ContactsAdmin';
const NAV = [
  ['home', 'Home', '⌂'],
  ['smart', 'Smart plans', '✦'],
  ['tokens', 'Tokens', '▤'],
  ['portal', 'Portal subscriptions', '◎'],
  ['contacts', 'Contacts', '♧'],
  ['settings', 'Settings', '⚙'],
  ['updates', 'Updates', '◷'],
];

const TITLES = {
  home: 'Home Dashboard', smart: 'Smart plans', tokens: 'Tokens', portal: 'Portal subscriptions',
  contacts: 'Contacts', settings: 'Settings', updates: 'Updates',
  users: 'Users', analytics: 'Analytics', income: 'Income',
};

// SAMPLE DATA: replaced by real numbers when the backend is built
const SAMPLE_STATS = [
  { icon: '☎', label: 'Airtime', num: '18,200', change: '+8.2%' },
  { icon: '▤', label: 'M-Pesa', num: '66,450', change: '+16.9%' },
  { icon: '▣', label: 'Total Income', num: '84,650', change: '+15.4%' },
];
const SAMPLE_TX = [
  { kind: 'token', title: 'Token Subscription', id: 'TXN-20481', time: '09:15 AM', amt: '500', how: 'M-PESA' },
  { kind: 'portal', title: 'Portal Subscription', id: 'TXN-20480', time: '08:52 AM', amt: '1,000', how: 'Airtime' },
  { kind: 'token', title: 'Token Subscription', id: 'TXN-20479', time: '08:40 AM', amt: '250', how: 'M-PESA' },
  { kind: 'portal', title: 'Portal Subscription', id: 'TXN-20478', time: '08:20 AM', amt: '750', how: 'M-PESA' },
  { kind: 'token', title: 'Token Subscription', id: 'TXN-20477', time: '08:05 AM', amt: '300', how: 'Airtime' },
];
const QUICK = [
  ['users', 'Users', 'Manage app users', '♙'],
  ['analytics', 'Analytics', 'View app stats', '▮'],
  ['income', 'Income', 'Track revenue', '▣'],
];

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function Home({ name, go }) {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <div className="ad-hello">
        <div className="ad-hello-row">
          <span className="ad-sun">☼</span>
          <span className="ad-greet">{greet}, {name}</span>
          <span className="ad-badge">★ SUPER ADMIN</span>
        </div>
        <div className="ad-title-row">
          <h1>Home Dashboard</h1>
          <span className="ad-sample">sample data</span>
        </div>
      </div>

      <div className="ad-stats">
        {SAMPLE_STATS.map((s) => (
          <div className="ad-stat" key={s.label}>
            <div className="ad-stat-top"><span className="ad-stat-icon">{s.icon}</span><span className="ad-stat-label">{s.label}</span></div>
            <div className="ad-stat-value"><small>KSh</small> {s.num}</div>
            <div className="ad-stat-change">↑ {s.change}</div>
          </div>
        ))}
      </div>

      <div className="ad-card ad-txcard">
        <div className="ad-card-head">
          <span className="ad-clock">◷</span>
          <div>
            <b>Recent Transactions</b>
            <small>Latest subscription payments</small>
          </div>
          <button className="ad-link" onClick={() => go('income')}>View All →</button>
        </div>
        <div className="ad-tx-list">
          {SAMPLE_TX.map((t) => (
            <div className="ad-tx" key={t.id}>
              <div className="ad-tx-icon">{t.kind === 'token' ? '◉' : '◎'}</div>
              <div className="ad-tx-main">
                <b>{t.title}</b>
                <small>{t.id} • {t.time}</small>
              </div>
              <div className="ad-tx-amt">
                <b>KSh {t.amt}</b>
                <small>{t.how}</small>
              </div>
              <span className="ad-pill">✔ Completed</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ad-quick-title">▦ Quick Access</div>
      <div className="ad-quick">
        {QUICK.map(([id, title, sub, icon]) => (
          <button key={id} className="ad-quick-btn" onClick={() => go(id)}>
            <span className="ad-quick-icon">{icon}</span>
            <b>{title}</b>
            <small>{sub} →</small>
          </button>
        ))}
      </div>
    </>
  );
}

function Placeholder({ title }) {
  return (
    <div className="ad-card ad-empty">
      <div className="ad-empty-icon">◇</div>
      <h2>{title}</h2>
      <p>This dashboard is built after the backend. The screen is ready and waiting.</p>
    </div>
  );
}

function Settings({ email, logout }) {
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setResult('');
    try {
      const j = await adminFetch('/admin/ping');
      setResult('Server says: you are admin (' + j.admin + ')');
    } catch (e) {
      setResult(e.status === 404 ? 'Server refused: 404. The server does not have the admin route yet. Redeploy it.' : e.message);
    }
    setBusy(false);
  };

  return (
    <div className="ad-card ad-pad">
      <p className="ad-muted">Signed in as</p>
      <p className="ad-big">{email}</p>
      <button className="ad-btn" onClick={check} disabled={busy}>{busy ? 'Checking…' : 'Check server access'}</button>
      {result && <p className="ad-result">{result}</p>}
      <button className="ad-btn ad-btn-ghost" onClick={logout}>Log out</button>
    </div>
  );
}

export default function AdminApp({ email, logout }) {
  const [page, setPage] = useState('home');
  const [open, setOpen] = useState(false);
  const name = cap((email || 'admin').split('@')[0]);

  const go = (p) => { setPage(p); setOpen(false); };
  const isQuick = ['users', 'analytics', 'income'].includes(page);

  let body;
  if (page === 'home') body = <Home name={name} go={go} />;
  else if (page === 'tokens') body = <TokensAdmin />;
  else if (page === 'settings') body = <Settings email={email} logout={logout} />;
    else if (page === 'portal') body = <PortalAdmin />;
  else if (page === 'contacts') body = <ContactsAdmin />;
  else body = <Placeholder title={TITLES[page]} />;

  return (
    <div className="ad-root">
      {open && <button className="ad-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <aside className={'ad-drawer' + (open ? ' open' : '')}>
        <div className="ad-drawer-head">
          <div className="ad-brand">Auto<span>Bingwa</span></div>
          <small>SUPER ADMIN</small>
          <button className="ad-close" onClick={() => setOpen(false)}>×</button>
        </div>
        <nav>
          {NAV.map(([id, label, icon]) => (
            <button key={id} className={'ad-nav' + (page === id ? ' active' : '')} onClick={() => go(id)}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>
      </aside>

      <header className="ad-top">
        <button className="ad-menu" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
        <div className="ad-brand-wrap">
          <div className="ad-brand">Auto<span>Bingwa</span></div>
          <small>SUPER ADMIN</small>
        </div>
        <div className="ad-avatar">{name.charAt(0)}</div>
      </header>

      <main className={'ad-main' + (page === 'home' ? ' home' : '')}>
        {page !== 'home' && (
          <div className="ad-pagehead">
            {isQuick && <button className="ad-link" onClick={() => go('home')}>← Home</button>}
            <h1>{TITLES[page]}</h1>
          </div>
        )}
        {body}
        {page !== 'home' && <footer className="ad-foot">AutoBingwa Admin • v1.0</footer>}
      </main>
    </div>
  );
}