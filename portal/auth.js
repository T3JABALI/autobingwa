(function () {
  const SUPABASE_URL = 'https://smoukalewmuorpowfiqr.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtb3VrYWxld211b3Jwb3dmaXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MDEzOTQsImV4cCI6MjEwOTE3NzM5NH0.CRCQSjcAXQof50F0tdy3cFM6chyd-gk58pn4bPpkSfk'
  const API_URL = 'https://autobingwa-payments.onrender.com'
  const EMAIL_DOMAIN = 'portal.autobingwaportal.co.ke'

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const norm = (v) => {
    let p = String(v || '').replace(/[\s\-+]/g, '')
    if (/^0(7|1)\d{8}$/.test(p)) p = '254' + p.slice(1)
    else if (/^(7|1)\d{8}$/.test(p)) p = '254' + p
    return /^254(7|1)\d{8}$/.test(p) ? p : ''
  }
  const emailOf = (phone) => phone + '@' + EMAIL_DOMAIN
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  /* ---- Functions that app.js uses ---- */
  window.getAuthToken = async () => {
    const { data } = await sb.auth.getSession()
    return data.session ? data.session.access_token : ''
  }
  window.portalSignOut = async () => {
    try { await sb.auth.signOut() } catch (e) {}
    location.reload()
  }
  window.portalChangePin = async (current, next) => {
    const { data } = await sb.auth.getSession()
    const email = data.session && data.session.user.email
    if (!email) throw new Error('Please log in again.')
    const chk = await sb.auth.signInWithPassword({ email, password: current })
    if (chk.error) throw new Error('Your current password is wrong.')
    const up = await sb.auth.updateUser({ password: next })
    if (up.error) throw new Error('Could not update the password.')
  }

  /* ---- Look ---- */
  const css = document.createElement('style')
  css.textContent = `
  #auth{position:fixed;inset:0;z-index:100;overflow:auto;background:radial-gradient(120% 60% at 50% 0,#162466,#0a0f26 60%,#070b1c);color:#fff;font-family:system-ui,sans-serif;padding:14px 14px;font-size:13px}
  #auth .box{max-width:400px;margin:0 auto}
  #auth .logo{display:flex;align-items:center;gap:10px;margin:6px 0 14px}
  #auth .mark{width:44px;height:44px;border-radius:12px;object-fit:contain;background:#fff}
  #auth .t1{letter-spacing:3px;font-weight:700;font-size:16px}
  #auth .t2{letter-spacing:5px;font-size:10px;color:#7f93ff;margin-top:3px}
  #auth .card{background:#131a3a;border:1px solid #27306a;border-radius:18px;padding:16px 16px}
  #auth h2{margin:0 0 4px;font-size:20px}
  #auth p{color:#8e9ad6;font-size:12px;margin:0 0 8px;line-height:1.4}
  #auth label{display:block;font-size:12px;color:#8e9ad6;margin-top:8px}
  #auth input{width:100%;box-sizing:border-box;margin-top:4px;padding:10px 12px;border-radius:10px;border:1px solid #27306a;background:#0c1230;color:#fff;font-size:14px}
  #auth .pw{position:relative}
  #auth .pw button{position:absolute;right:4px;top:5px;background:none;border:0;color:#8e9ad6;padding:6px;font-size:12px;cursor:pointer}
  #auth .go{width:100%;margin-top:12px;border:0;border-radius:12px;padding:11px;font-size:14px;font-weight:600;color:#fff;background:linear-gradient(90deg,#4361e0,#5f7df5);cursor:pointer}
  #auth .go:disabled{opacity:.6}
  #auth .alt{background:none;border:0;color:#8e9ad6;width:100%;margin-top:10px;font-size:12.5px;cursor:pointer}
  #auth .alt b{color:#7f93ff}
  #auth .ok{background:#0f2a22;border:1px solid #1f6b4f;color:#8ff0c4;padding:8px 10px;border-radius:10px;font-size:12px;margin-bottom:8px}
  #auth .er{color:#ff8a8a;font-size:12px;min-height:16px;margin-top:6px}`
  document.head.appendChild(css)

  const nav = document.getElementById('nav')
  let appLoaded = false
  function startApp() {
    if (appLoaded) return
    appLoaded = true
    const o = document.getElementById('auth')
    if (o) o.remove()
    const s = document.createElement('script')
    s.src = '/app.js'
    document.body.appendChild(s)
  }

  function showAuth(mode, opts = {}) {
    if (nav) nav.style.display = 'none'
    let o = document.getElementById('auth')
    if (!o) { o = document.createElement('div'); o.id = 'auth'; document.body.appendChild(o) }
    const login = mode === 'login'
    o.innerHTML = `<div class="box">
      <div class="logo"><img class="mark" src="/logo.png" alt="" onerror="this.style.display='none'"><div><div class="t1">AUTOBINGWA</div><div class="t2">PORTAL</div></div></div>
      <div class="card">
        <h2>${login ? 'Sign in' : 'Create account'}</h2>
        <p>${login ? 'Log in with your phone number and password.' : 'Use your phone number and choose a password of at least 8 characters.'}</p>
        ${opts.notice ? `<div class="ok">${esc(opts.notice)}</div>` : ''}
        <label>Phone number<input id="au-ph" type="tel" inputmode="tel" autocomplete="username" placeholder="0712345678" value="${esc(opts.phone || '')}"></label>
        <label>Password<div class="pw"><input id="au-pw" type="password" autocomplete="${login ? 'current-password' : 'new-password'}"><button type="button" id="au-eye">Show</button></div></label>
        ${login ? '' : '<label>Confirm password<input id="au-pw2" type="password" autocomplete="new-password"></label>'}
        <div class="er" id="au-er" role="alert"></div>
        <button class="go" id="au-go">${login ? 'Sign in' : 'Create account'}</button>
        <button class="alt" id="au-alt">${login ? 'New here? <b>Create an account</b>' : 'Already have an account? <b>Sign in</b>'}</button>
      </div></div>`
    const $ = (id) => document.getElementById(id)
    $('au-eye').onclick = () => {
      const h = $('au-pw').type === 'password'
      $('au-pw').type = h ? 'text' : 'password'
      $('au-eye').textContent = h ? 'Hide' : 'Show'
    }
    $('au-alt').onclick = () => showAuth(login ? 'signup' : 'login')
    $('au-go').onclick = async () => {
      const er = $('au-er'), btn = $('au-go')
      const phone = norm($('au-ph').value), pw = $('au-pw').value
      er.textContent = ''
      if (!phone) return (er.textContent = 'Enter a valid phone number, for example 0712345678.')
      if (!pw) return (er.textContent = 'Enter your password.')
      btn.disabled = true
      try {
        if (login) {
          const { error } = await sb.auth.signInWithPassword({ email: emailOf(phone), password: pw })
          if (error) throw new Error('Wrong phone number or password.')
          startApp()
        } else {
          if (pw.length < 8) throw new Error('Password must be at least 8 characters.')
          if (pw !== $('au-pw2').value) throw new Error('The passwords do not match.')
          const r = await fetch(API_URL + '/portal/signup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password: pw }),
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(j.error || 'Could not create the account.')
          showAuth('login', { phone: $('au-ph').value, notice: 'You have successfully created your portal account. Please log in to continue.' })
          return
        }
      } catch (e) {
        er.textContent = e.message || 'Something went wrong.'
        btn.disabled = false
      }
    }
  }

  sb.auth.getSession().then(({ data }) => (data.session ? startApp() : showAuth('login')))
})()