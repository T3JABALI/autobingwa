(() => {
const SUPABASE_URL = 'https://smoukalewmuorpowfiqr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtb3VrYWxld211b3Jwb3dmaXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MDEzOTQsImV4cCI6MjEwOTE3NzM5NH0.CRCQSjcAXQof50F0tdy3cFM6chyd-gk58pn4bPpkSfk';
const SERVER_URL = 'https://autobingwa-payments.onrender.com';
const PHONE_DOMAIN = 'portal.autobingwaportal.co.ke';
const MIN_PW = 8;

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
let appLoaded = false;

window.PORTAL_TOKEN = null;
window.getAuthToken = async () => {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : null;
};
window.portalSignOut = async () => { await sb.auth.signOut(); };
window.portalChangePin = async (current, next) => {
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error('Please log in again');
  const chk = await sb.auth.signInWithPassword({ email: data.user.email, password: current });
  if (chk.error) throw new Error('Your current password is wrong');
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) throw new Error(error.message);
};

sb.auth.onAuthStateChange((ev, s) => {
  window.PORTAL_TOKEN = s ? s.access_token : null;
  if (ev === 'SIGNED_OUT') location.reload();
});

const normPhone = v => {
  const p = String(v || '').replace(/[\s+-]/g, '').replace(/^254/, '0');
  return /^0[17]\d{8}$/.test(p) ? '254' + p.slice(1) : '';
};
const toEmail = p => p + '@' + PHONE_DOMAIN;
const err = m => { document.getElementById('aerr').textContent = m || ''; };
const busy = (f, b) => f.querySelectorAll('button,input').forEach(x => (x.disabled = b));

const svg = (d, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PHONE = svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>');
const ICON_LOCK = svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
const ICON_EYE = svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 22);
const BARS = svg('<path d="M5 19v.01M9 19v-3M13 19v-6M17 19V8"/>', 28).replace('stroke-width="2"', 'stroke-width="2.8"');

function phoneField() {
  return `<label class="alabel" for="ph">Phone number</label>
    <div class="awrap"><span class="aico">${ICON_PHONE}</span>
    <input class="ainput" id="ph" name="ph" type="tel" inputmode="tel" placeholder="07xx or 011x" autocomplete="username"></div>`;
}
function pwField(id, label, ac) {
  return `<label class="alabel" for="${id}">${label}</label>
    <div class="awrap"><span class="aico">${ICON_LOCK}</span>
    <input class="ainput haseye" id="${id}" name="${id}" type="password" placeholder="••••••••" autocomplete="${ac}">
    <button type="button" class="aeye" data-eye="${id}" aria-label="Show or hide password">${ICON_EYE}</button></div>`;
}

function screen(title, sub, body, foot) {
  document.body.classList.add('authpage');
  $nav.style.display = 'none';
  $app.innerHTML = `<section class="auth">
    <div class="abrand"><span class="alogo">${BARS}</span><span class="atext"><b>AUTOBINGWA</b><i>PORTAL</i></span></div>
    <div class="acard">
      <h1>${title}</h1><p class="asub">${sub}</p>
      <form id="af" novalidate>${body}<p id="aerr" class="aerr" role="alert"></p></form>
      ${foot ? `<p class="afoot">${foot}</p>` : ''}
    </div></section>`;
  $app.querySelectorAll('[data-eye]').forEach(b => {
    b.onclick = () => {
      const i = document.getElementById(b.dataset.eye);
      i.type = i.type === 'password' ? 'text' : 'password';
    };
  });
  return document.getElementById('af');
}
const link = (id, fn) => document.getElementById(id).addEventListener('click', e => { e.preventDefault(); fn(); });

function showBlocked(msg) {
  const f = screen('No portal access', msg, `<button class="abtn">Log out</button>`);
  f.onsubmit = async e => { e.preventDefault(); await sb.auth.signOut(); };
}

async function enter() {
  const { data, error } = await sb.from('portal_accounts').select('user_id').maybeSingle();
  if (error) return showBlocked('We could not check your portal access. Please log out and try again.');
  if (!data) return showBlocked('This account has no portal access. Log out and create a portal account with your phone number.');
  document.body.classList.remove('authpage');
  $nav.style.display = '';
  if (appLoaded) return;
  appLoaded = true;
  $app.innerHTML = '';
  const s = document.createElement('script');
  s.src = '/app.js';
  document.body.appendChild(s);
}

function showLogin() {
  const f = screen('Welcome back', 'Log in to manage your devices from anywhere.',
    phoneField() + pwField('pw', 'Password', 'current-password') +
    `<p class="aforgot"><a href="#" id="l2">Forgot password?</a></p>
     <button class="abtn">Log in</button>`,
    'New to AutoBingwa Portal? <a href="#" id="l1">Create an account</a>');
  link('l1', showSignup);
  link('l2', () => err('Password reset is not available yet. Please contact AutoBingwa support.'));
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const phone = normPhone(f.ph.value), password = f.pw.value;
    if (!phone) return err('Enter a valid phone number, for example 0712345678.');
    if (!password) return err('Enter your password.');
    busy(f, true);
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(phone), password });
    busy(f, false);
    if (error) return err('Wrong phone number or password.');
    enter();
  };
}

function showSignup() {
  const f = screen('Create your account', 'Pair your phones and run them from one place.',
    phoneField() +
    pwField('pw', 'Password (at least ' + MIN_PW + ' characters)', 'new-password') +
    pwField('pw2', 'Confirm password', 'new-password') +
    `<button class="abtn">Create account</button>`,
    'Already have an account? <a href="#" id="l1">Log in</a>');
  link('l1', showLogin);
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const phone = normPhone(f.ph.value), password = f.pw.value;
    if (!phone) return err('Enter a valid phone number, for example 0712345678.');
    if (password.length < MIN_PW) return err('Password must be at least ' + MIN_PW + ' characters.');
    if (password !== f.pw2.value) return err('The passwords do not match.');
    busy(f, true);
    let r;
    try {
      r = await fetch(SERVER_URL + '/portal/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
      });
    } catch (x) { busy(f, false); return err('Could not reach the server. Please try again.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { busy(f, false); return err(j.error || 'Could not create the account.'); }
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(phone), password });
    busy(f, false);
    if (error) return showLogin();
    enter();
  };
}

(async () => {
  const { data } = await sb.auth.getSession();
  data.session ? enter() : showLogin();
})();
})();