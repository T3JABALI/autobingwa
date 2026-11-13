import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from './adminApi';

const stamp = (ts) => {
  const d = new Date(ts);
  const h = d.getHours();
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.getDate()}/${d.getMonth() + 1} ${time}`;
};
const nameOf = (t) => t.name || (t.email ? t.email.split('@')[0] : 'User');

export default function MessagesAdmin({ onChange }) {
  const [threads, setThreads] = useState(null);
  const [open, setOpen] = useState(null); // { userId, name, email }
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const j = await adminFetch('/admin/support/threads');
      setThreads(j.threads || []);
      setErr('');
      if (onChange) onChange();
    } catch (e) {
      setErr(e.message);
      setThreads((t) => t || []);
    }
  }, [onChange]);

  const loadThread = useCallback(async (userId) => {
    try {
      const j = await adminFetch('/admin/support/thread/' + encodeURIComponent(userId));
      setMsgs(j.messages || []);
      setErr('');
      if (onChange) onChange();
    } catch (e) {
      setErr(e.message);
    }
  }, [onChange]);

  useEffect(() => {
    if (open) return undefined;
    loadList();
    const t = setInterval(loadList, 15000);
    return () => clearInterval(t);
  }, [open, loadList]);

  useEffect(() => {
    if (!open) return undefined;
    loadThread(open.userId);
    const t = setInterval(() => loadThread(open.userId), 6000);
    return () => clearInterval(t);
  }, [open, loadThread]);

  useEffect(() => {
    if (open && endRef.current) endRef.current.scrollIntoView({ block: 'end' });
  }, [msgs.length, open]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy || !open) return;
    setBusy(true);
    setErr('');
    try {
      await adminFetch('/admin/support/reply', { method: 'POST', body: { userId: open.userId, text: body } });
      setText('');
      await loadThread(open.userId);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  if (open) {
    return (
      <div>
        <div className="mg-head">
          <button className="ad-link" onClick={() => { setOpen(null); setMsgs([]); setText(''); }}>← All messages</button>
        </div>
        <div className="ad-card ad-pad">
          <b>{open.name || 'User'}</b>
          {open.email && <p className="ad-muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{open.email}</p>}
        </div>

        <div className="mg-thread">
          {msgs.length === 0 && <p className="ad-muted" style={{ textAlign: 'center' }}>Loading…</p>}
          {msgs.map((m) => (
            <div key={m.id} className={'mg-bub' + (m.from === 'admin' ? ' admin' : '')}>
              {m.text}
              <span className="mg-time">{m.from === 'admin' ? 'You' : 'Customer'} • {stamp(m.at)}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {err && <p className="ad-err">{err}</p>}
        <div className="mg-compose">
          <textarea
            className="ad-input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your reply"
          />
          <button className="mg-send" onClick={send} disabled={busy || !text.trim()}>{busy ? '…' : 'Send'}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {err && <p className="ad-err">{err}</p>}
      {threads === null && <p className="ad-muted">Loading…</p>}
      {threads && threads.length === 0 && !err && (
        <div className="ad-card ad-empty">
          <div className="ad-empty-icon">✉</div>
          <h2>No messages yet</h2>
          <p>When a user writes to support from the app, it appears here.</p>
        </div>
      )}
      <div className="mg-list">
        {(threads || []).map((t) => (
          <button
            key={t.userId}
            className={'mg-row' + (t.unread ? ' unread' : '')}
            onClick={() => setOpen({ userId: t.userId, name: nameOf(t), email: t.email })}
          >
            <span className="mg-avatar">{nameOf(t).charAt(0).toUpperCase()}</span>
            <span className="mg-main">
              <span className="mg-top"><b>{nameOf(t)}</b><small>{stamp(t.at)}</small></span>
              <span className="mg-last">{t.lastFromAdmin ? 'You: ' : ''}{t.last}</span>
            </span>
            {t.unread > 0 && <em className="ad-dot mg-count">{t.unread}</em>}
          </button>
        ))}
      </div>
    </div>
  );
}