import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const CACHE = 'ab:user';
const readCache = () => {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; }
};
const writeCache = (u) => {
  try {
    if (u) localStorage.setItem(CACHE, JSON.stringify({ id: u.id, email: u.email }));
    else localStorage.removeItem(CACHE);
  } catch (e) { /* ignore */ }
};

// The role is cached only so the screen opens instantly. The server checks the real role every time.
const ROLE = 'ab:role';
const readRole = (id) => {
  try {
    const r = JSON.parse(localStorage.getItem(ROLE) || 'null');
    return r && r.id === id ? r.role : null;
  } catch (e) { return null; }
};
const writeRole = (id, role) => {
  try {
    if (id) localStorage.setItem(ROLE, JSON.stringify({ id, role }));
    else localStorage.removeItem(ROLE);
  } catch (e) { /* ignore */ }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(undefined); // undefined = still loading, otherwise 'admin' or 'user'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (data.session) {
          setUser(data.session.user);
          writeCache(data.session.user);
        } else if (error) {
          setUser(readCache()); // no network: stay signed in
        } else {
          setUser(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUser(readCache()); // no network: stay signed in
        setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setUser(session.user);
        writeCache(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null); // only the Log out button gets here
        writeCache(null);
      }
    });

    // The phone may have paused the app for hours: refresh the session when it comes back
    const onVisible = () => {
      if (document.hidden) return;
      supabase.auth.startAutoRefresh();
      supabase.auth.getSession().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Load the role whenever a different user signs in
  const userId = user ? user.id : null;
  useEffect(() => {
    if (!userId) { setRole(undefined); return; }
    let alive = true;
    const cached = readRole(userId);
    if (cached) setRole(cached);
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        // If the check fails (for example no network), fall back to the cached role, otherwise a normal user
        const r = error ? (cached || 'user') : ((data && data.role) || 'user');
        setRole(r);
        writeRole(userId, r);
      })
      .catch(() => { if (alive) setRole(cached || 'user'); });
    return () => { alive = false; };
  }, [userId]);

  const logout = async () => {
    await supabase.auth.signOut();
    writeCache(null);
    writeRole(null);
    setRole(undefined);
  };

  return <Ctx.Provider value={{ user, role, loading, logout }}>{children}</Ctx.Provider>;
}