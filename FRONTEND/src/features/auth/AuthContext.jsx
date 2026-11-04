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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
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

  const logout = async () => {
    await supabase.auth.signOut();
    writeCache(null);
  };

  return <Ctx.Provider value={{ user, loading, logout }}>{children}</Ctx.Provider>;
}