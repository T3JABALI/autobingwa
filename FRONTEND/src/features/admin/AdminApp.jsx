import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from './adminApi';
import TokensAdmin from './TokensAdmin';
import './admin.css';
import PortalAdmin from './PortalAdmin';
import ContactsAdmin from './ContactsAdmin';
import SmartPlansAdmin from './SmartPlansAdmin';
import HomeAdmin from './HomeAdmin';
import IncomeAdmin from './IncomeAdmin';
import UsersAdmin from './UsersAdmin';
import AnalyticsAdmin from './AnalyticsAdmin';
import UpdatesAdmin from './UpdatesAdmin';
import MessagesAdmin from './MessagesAdmin';

const NAV = [
  ['home', 'Home', '⌂'],
  ['messages', 'Messages', '✉'],
  ['users', 'Users', '♙'],
  ['analytics', 'Analytics', '▮'],
  ['income', 'Income', '▣'],
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
  users: 'Users', analytics: 'Analytics', income: 'Income', messages: 'Messages',
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

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
  const [tab, setTab] = useState('');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const name = cap((email || 'admin').split('@')[0]);

  // Counts the messages from users that nobody has opened yet
  const refreshUnread = useCallback(async () => {
    try {
      const j = await adminFetch('/admin/support/unread');
      setUnread(j.count || 0);
    } catch (e) { /* keep the last number */ }
  }, []);
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 30000);
    return () => clearInterval(t);
  }, [refreshUnread]);

  const go = (p, t = '') => { setPage(p); setTab(t); setOpen(false); };
  const isQuick = ['users', 'analytics', 'income'].includes(page);

  let body;
  if (page === 'home') body = <HomeAdmin name={name} go={go} />;
  else if (page === 'messages') body = <MessagesAdmin onChange={refreshUnread} />;
  else if (page === 'income') body = <IncomeAdmin key={tab || 'overview'} start={tab} />;
  else if (page === 'users') body = <UsersAdmin />;
  else if (page === 'analytics') body = <AnalyticsAdmin />;
  else if (page === 'tokens') body = <TokensAdmin />;
  else if (page === 'settings') body = <Settings email={email} logout={logout} />;
  else if (page === 'portal') body = <PortalAdmin />;
  else if (page === 'contacts') body = <ContactsAdmin />;
  else if (page === 'smart') body = <SmartPlansAdmin />;
  else if (page === 'updates') body = <UpdatesAdmin />;
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
              {id === 'messages' && unread > 0 && <em className="ad-dot">{unread}</em>}
            </button>
          ))}
        </nav>
      </aside>

      <header className="ad-top">
        <button className="ad-menu" onClick={() => setOpen(true)} aria-label="Open menu">
          ☰
          {unread > 0 && <em className="ad-dot">{unread > 9 ? '9+' : unread}</em>}
        </button>
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