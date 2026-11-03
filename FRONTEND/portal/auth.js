(() => {
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

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
  if (chk.error) throw new Error('Your current PIN is wrong');
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) throw new Error(error.message);
};

sb.auth.onAuthStateChange((ev, s) => {
  window.PORTAL_TOKEN = s ? s.access_token : null;
  if (ev === 'SIGNED_OUT') location.reload();
});

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pinOk = p => /^\d{6}$/.test(p);
const err = m => { document.getElementById('aerr').textContent = m || ''; };
const busy = (f, b) => f.querySelectorAll('button,input').forEach(x => (x.disabled = b));

function field(id, label, type, extra = '') {
  return `<label class="alabel" for="${id}">${label}</label>
          <input class="ainput" id="${id}" name="${id}" type="${type}" ${extra}>`;
}
const pinField = (id, label, ac) =>
  field(id, label, 'password', `inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="${ac}"`);

function screen(title, sub, body) {
  $nav.style.display = 'none';
  $app.innerHTML = `<section class="auth"><h1>${title}</h1><p class="asub">${sub}</p>
    <form id="af" novalidate>${body}<p id="aerr" class="aerr" role="alert"></p></form></section>`;
  return document.getElementById('af');
}
const link = (id, fn) => document.getElementById(id).addEventListener('click', e => { e.preventDefault(); fn(); });

function enter() {
  $nav.style.display = '';
  if (appLoaded) return;
  appLoaded = true;
  $app.innerHTML = '';
  const s = document.createElement('script');
  s.src = '/app.js';
  document.body.appendChild(s);
}

function showLogin() {
  const f = screen('Welcome back', 'Log in to your AutoBingwa portal',
    field('em', 'Email', 'email', 'autocomplete="email"') +
    pinField('pin', '6-digit PIN', 'current-password') +
    `<button class="abtn">Log in</button>
     <p class="alink"><a href="#" id="l1">Create account</a> · <a href="#" id="l2">Forgot PIN?</a></p>`);
  link('l1', showSignup);
  link('l2', showForgot);
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const email = f.em.value.trim().toLowerCase(), pin = f.pin.value.trim();
    if (!email || !pinOk(pin)) return err('Enter your email and your 6-digit PIN.');
    busy(f, true);
    const { error } = await sb.auth.signInWithPassword({ email, password: pin });
    busy(f, false);
    if (error) {
      if (/confirm/i.test(error.message)) {
        await sb.auth.resend({ type: 'signup', email });
        return showVerify(email, 'signup');
      }
      return err('Wrong email or PIN.');
    }
    enter();
  };
}

function showSignup() {
  const f = screen('Create your account', 'Use your email and choose a 6-digit PIN',
    field('em', 'Email', 'email', 'autocomplete="email"') +
    pinField('pin', 'Choose a 6-digit PIN', 'new-password') +
    pinField('pin2', 'Confirm PIN', 'new-password') +
    `<button class="abtn">Create account</button>
     <p class="alink"><a href="#" id="l1">I already have an account</a></p>`);
  link('l1', showLogin);
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const email = f.em.value.trim().toLowerCase(), pin = f.pin.value.trim();
    if (!email) return err('Enter your email.');
    if (!pinOk(pin)) return err('PIN must be exactly 6 digits.');
    if (pin !== f.pin2.value.trim()) return err('The PINs do not match.');
    busy(f, true);
    const { data, error } = await sb.auth.signUp({
      email, password: pin,
      options: { emailRedirectTo: location.origin, data: { app: 'portal' } }
    });
    busy(f, false);
    if (error) return err(error.message);
    if (data.user && data.user.identities && data.user.identities.length === 0)
      return err('This email is already registered. Please log in.');
    if (data.session) return enter();
    showVerify(email, 'signup');
  };
}

function showVerify(email, type) {
  const f = screen('Check your email', `We sent a 6-digit code to <b>${esc(email)}</b>`,
    field('code', 'Verification code', 'text', 'inputmode="numeric" maxlength="6" autocomplete="one-time-code"') +
    `<button class="abtn">Verify</button>
     <p class="alink"><a href="#" id="l1">Resend code</a> · <a href="#" id="l2">Back</a></p>`);
  link('l2', showLogin);
  let wait = false;
  link('l1', async () => {
    if (wait) return err('Please wait a minute before requesting another code.');
    wait = true; setTimeout(() => (wait = false), 60000);
    const { error } = type === 'signup'
      ? await sb.auth.resend({ type: 'signup', email })
      : await sb.auth.resetPasswordForEmail(email);
    err(error ? error.message : 'New code sent.');
  });
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const token = f.code.value.trim();
    if (!/^\d{6}$/.test(token)) return err('Enter the 6-digit code.');
    busy(f, true);
    const { error } = await sb.auth.verifyOtp({ email, token, type });
    busy(f, false);
    if (error) return err('Invalid or expired code.');
    type === 'signup' ? enter() : showNewPin();
  };
}

function showForgot() {
  const f = screen('Reset your PIN', 'We will email you a 6-digit code',
    field('em', 'Email', 'email', 'autocomplete="email"') +
    `<button class="abtn">Send code</button>
     <p class="alink"><a href="#" id="l1">Back to login</a></p>`);
  link('l1', showLogin);
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const email = f.em.value.trim().toLowerCase();
    if (!email) return err('Enter your email.');
    busy(f, true);
    const { error } = await sb.auth.resetPasswordForEmail(email);
    busy(f, false);
    if (error) return err(error.message);
    showVerify(email, 'recovery');
  };
}

function showNewPin() {
  const f = screen('Set a new PIN', 'Choose a new 6-digit PIN',
    pinField('pin', 'New 6-digit PIN', 'new-password') +
    pinField('pin2', 'Confirm PIN', 'new-password') +
    `<button class="abtn">Save PIN</button>`);
  f.onsubmit = async e => {
    e.preventDefault(); err();
    const pin = f.pin.value.trim();
    if (!pinOk(pin)) return err('PIN must be exactly 6 digits.');
    if (pin !== f.pin2.value.trim()) return err('The PINs do not match.');
    busy(f, true);
    const { error } = await sb.auth.updateUser({ password: pin });
    busy(f, false);
    if (error) return err(error.message);
    enter();
  };
}

(async () => {
  const { data } = await sb.auth.getSession();
  data.session ? enter() : showLogin();
})();
})();