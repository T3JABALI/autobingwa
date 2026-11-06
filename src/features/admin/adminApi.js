import { supabase } from '../../lib/supabase';

// Your server address, no slash at the end
export const API = 'https://autobingwa-payments.onrender.com';

export async function adminFetch(path, opts = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session ? data.session.access_token : '';
  let r;
  try {
    r = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error('Could not reach the server.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || 'Request failed (' + r.status + ')');
    err.status = r.status;
    throw err;
  }
  return j;
}