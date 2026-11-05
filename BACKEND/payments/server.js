import express from 'express'
import cors from 'cors'
import pg from 'pg'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import rateLimit from 'express-rate-limit'

const {
  DARAJA_ENV = 'sandbox', CONSUMER_KEY, CONSUMER_SECRET, PASSKEY,
  SHORTCODE, TILL_NUMBER, CALLBACK_BASE, CALLBACK_SECRET, DATABASE_URL, PORT = 3000,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env

const LIVE = DARAJA_ENV === 'production'
const BASE = LIVE ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
// Prices live here, never trusted from the app
const PLANS = { u1000: 90, u600: 50, u250: 25, u100: 15, d1: 30, d7: 200, d30: 550 }

// Portal subscription plans. Everyone must subscribe; there is no free plan.
const SUB_PLANS = {
  d2:  { name: '2 Devices',      price: 100, max: 2,    history: 3, days: 31 },
  d4:  { name: '4 Devices',      price: 200, max: 4,    history: 5, days: 31 },
  unl: { name: 'Unlimited Plan', price: 400, max: 1000, history: 7, days: 31 },
}
const planList = () => Object.entries(SUB_PLANS).map(([id, p]) => ({ id, ...p }))
function planInfo(acct) {
  const exp = acct.plan_exp ? new Date(acct.plan_exp) : null
  const def = SUB_PLANS[acct.plan]
  if (def && exp && exp.getTime() > Date.now())
    return { id: acct.plan, name: def.name, max: def.max, history: def.history, exp: exp.toISOString().slice(0, 10), active: true }
  return { id: '', name: 'None', max: 0, history: 0, exp: '', active: false }
}

for (const [k, v] of Object.entries({ CONSUMER_KEY, CONSUMER_SECRET, PASSKEY, SHORTCODE, CALLBACK_BASE, CALLBACK_SECRET, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!v) console.error(`MISSING ENV VAR: ${k}`)
}
if (LIVE && !TILL_NUMBER) console.error('MISSING ENV VAR: TILL_NUMBER')

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
pool.on('error', (e) => console.error('pool error', e.message))

// Supabase admin client for the portal (service key stays on the server only)
const sbAdmin = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

let dbReady = false
async function initDb() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, phone TEXT NOT NULL, plan_id TEXT NOT NULL,
      amount INT NOT NULL, checkout_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      receipt TEXT UNIQUE, message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    await pool.query(`CREATE TABLE IF NOT EXISTS portal_payments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, phone TEXT NOT NULL, plan_id TEXT NOT NULL,
      amount INT NOT NULL, checkout_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      receipt TEXT, message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    dbReady = true
    console.log('Database ready')
  } catch (e) {
    console.error('Database init failed, retrying in 10s:', e.message)
    setTimeout(initDb, 10000)
  }
}

function normalizePhone(input) {
  let p = String(input || '').replace(/[\s\-+]/g, '')
  if (/^0(7|1)\d{8}$/.test(p)) p = '254' + p.slice(1)
  else if (/^(7|1)\d{8}$/.test(p)) p = '254' + p
  return /^254(7|1)\d{8}$/.test(p) ? p : null
}

let tokenCache = { value: '', until: 0 }
async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.until) return tokenCache.value
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')
  const r = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error(`Daraja auth failed (${r.status}) ${await r.text()} [env=${DARAJA_ENV}]`)
  const d = await r.json()
  tokenCache = { value: d.access_token, until: Date.now() + (Number(d.expires_in) - 60) * 1000 }
  return tokenCache.value
}

function stamp() {
  const d = new Date(Date.now() + 3 * 3600000) // Nairobi time
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}
const password = (ts) => Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString('base64')

async function daraja(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { errorMessage: `M-Pesa replied (${r.status}) with an unreadable response.` } }
}

const app = express()
app.set('trust proxy', 1) // Render sits behind a proxy; needed for correct rate limiting
app.use(cors())
app.use(express.json())
app.use((req, res, next) => { console.log(req.method, req.path); next() })
app.get('/', (req, res) => res.send('AutoBingwa token server running'))

/* ================= PORTAL (phone + password accounts) ================= */

// Public: create a portal account. Only this route can mark a user as a portal user.
app.post('/portal/signup',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
      const phone = normalizePhone(req.body && req.body.phone)
      const pw = String((req.body && req.body.password) || '')
      if (!phone) return res.status(400).json({ error: 'Enter a valid phone number, for example 0712345678.' })
      if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })

      const { data, error } = await sbAdmin.auth.admin.createUser({
        email: `${phone}@portal.autobingwaportal.co.ke`,
        password: pw,
        email_confirm: true,
        app_metadata: { portal: true },
        user_metadata: { phone },
      })
      if (error) {
        if (error.code === 'email_exists' || /already|registered/i.test(error.message || ''))
          return res.status(409).json({ error: 'This phone number already has a portal account. Please log in.' })
        console.error('portal signup', error.message)
        return res.status(400).json({ error: 'Could not create the account.' })
      }
      // The database trigger already created the portal_accounts row; store the phone on it
      await sbAdmin.from('portal_accounts').update({ phone }).eq('user_id', data.user.id)
      res.json({ ok: true })
    } catch (e) {
      console.error('portal signup', e)
      res.status(500).json({ error: 'Could not create the account.' })
    }
  })

// Everything below /portal needs a logged-in portal user
async function requireUser(req, res, next) {
  try {
    if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!token) return res.status(401).json({ error: 'No token' })
    const { data, error } = await sbAdmin.auth.getUser(token)
    if (error || !data.user) return res.status(401).json({ error: 'Invalid token' })

    let acct = (await sbAdmin.from('portal_accounts').select('*').eq('user_id', data.user.id).maybeSingle()).data
    // A genuine portal user whose row is missing gets one created automatically
    if (!acct && data.user.app_metadata && data.user.app_metadata.portal) {
      await sbAdmin.from('portal_accounts').insert({ user_id: data.user.id, phone: (data.user.user_metadata || {}).phone || null })
      acct = (await sbAdmin.from('portal_accounts').select('*').eq('user_id', data.user.id).maybeSingle()).data
    }
    if (!acct) return res.status(403).json({ error: 'No portal account' })

    req.user = data.user
    req.acct = acct // biz, plan, plan_exp and phone for this portal user
    next()
  } catch (e) {
    console.error('requireUser', e)
    res.status(500).json({ error: 'Could not check your login.' })
  }
}
app.use('/portal', requireUser)

// Test route: confirms the login reaches the server
app.get('/portal/me', (req, res) => {
  res.json({ userId: req.user.id, phone: req.acct.phone || null, biz: req.acct.biz || null, plan: req.acct.plan || null })
})

/* ================= PORTAL SUBSCRIPTION (M-Pesa) ================= */

app.get('/portal/plans', (req, res) =>
  res.json({ plans: planList(), current: planInfo(req.acct), phone: req.acct.phone || '' }))

async function finishSubPayment(id, receipt) {
  const { rows } = await pool.query(
    "UPDATE portal_payments SET status='paid', receipt=$2 WHERE id=$1 AND status='pending' RETURNING *", [id, receipt || null])
  const pay = rows[0]
  if (!pay) return // already handled, so a repeated callback cannot extend twice
  const def = SUB_PLANS[pay.plan_id]
  const { data: acct } = await sbAdmin.from('portal_accounts').select('plan_exp').eq('user_id', pay.user_id).maybeSingle()
  const cur = acct && acct.plan_exp ? new Date(acct.plan_exp).getTime() : 0
  const from = Math.max(cur, Date.now()) // renewing early adds on top of the remaining time
  await sbAdmin.from('portal_accounts')
    .update({ plan: pay.plan_id, plan_exp: new Date(from + def.days * 86400000).toISOString() })
    .eq('user_id', pay.user_id)
}

app.post('/portal/subscribe/start',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => (req.user ? req.user.id : 'none') }),
  async (req, res) => {
    try {
      if (!dbReady) return res.status(503).json({ error: 'Server is starting, try again in a few seconds.' })
      const plan = SUB_PLANS[req.body && req.body.planId]
      if (!plan) return res.status(400).json({ error: 'Unknown plan.' })
      const phone = normalizePhone((req.body && req.body.phone) || req.acct.phone)
      if (!phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number, for example 0712345678.' })
      const ts = stamp()
      const d = await daraja('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts,
        TransactionType: LIVE ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: plan.price, PartyA: phone, PartyB: LIVE ? TILL_NUMBER : SHORTCODE, PhoneNumber: phone,
        CallBackURL: `${CALLBACK_BASE}/pay/portal/callback/${CALLBACK_SECRET}`,
        AccountReference: 'AutoBingwaPortal', TransactionDesc: `Portal ${plan.name}`,
      })
      if (d.ResponseCode !== '0') {
        console.error('portal stk refused', d)
        return res.status(502).json({ error: d.errorMessage || d.ResponseDescription || 'M-Pesa refused the request.' })
      }
      const id = crypto.randomUUID()
      await pool.query(
        'INSERT INTO portal_payments (id, user_id, phone, plan_id, amount, checkout_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, req.user.id, phone, req.body.planId, plan.price, d.CheckoutRequestID])
      res.json({ paymentId: id })
    } catch (e) {
      console.error('subscribe start', e)
      res.status(500).json({ error: 'Could not start the payment.' })
    }
  })

app.get('/portal/subscribe/status/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM portal_payments WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
    let p = rows[0]
    if (!p) return res.status(404).json({ error: 'Not found.' })
    // If the callback never arrived, ask Safaricom directly after 40 seconds
    if (p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 40000) {
      const ts = stamp()
      const q = await daraja('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: p.checkout_id })
      if (q.ResultCode !== undefined) {
        const code = Number(q.ResultCode)
        if (code === 0) await finishSubPayment(p.id, null)
        else if (code !== 4999)
          await pool.query("UPDATE portal_payments SET status=$2, message=$3 WHERE id=$1 AND status='pending'",
            [p.id, code === 1032 ? 'cancelled' : 'failed', q.ResultDesc || ''])
      }
      p = (await pool.query('SELECT * FROM portal_payments WHERE id=$1', [p.id])).rows[0]
    }
    res.json({ status: p.status, message: p.message || '' })
  } catch (e) {
    console.error('subscribe status', e)
    res.status(500).json({ error: 'Could not check the payment.' })
  }
})

// Safaricom calls this (no login), so it lives outside /portal
app.post('/pay/portal/callback/:secret', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' }) // always answer Safaricom quickly
  if (req.params.secret !== CALLBACK_SECRET) return
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback
    if (!cb) return
    const { rows } = await pool.query('SELECT * FROM portal_payments WHERE checkout_id=$1', [cb.CheckoutRequestID])
    const p = rows[0]
    if (!p || p.status !== 'pending') return
    if (Number(cb.ResultCode) === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []
      const get = (n) => (items.find((i) => i.Name === n) || {}).Value
      if (Number(get('Amount')) < p.amount) {
        await pool.query("UPDATE portal_payments SET status='failed', message='Amount did not match.' WHERE id=$1", [p.id])
        return
      }
      await finishSubPayment(p.id, String(get('MpesaReceiptNumber') || ''))
    } else {
      await pool.query("UPDATE portal_payments SET status=$2, message=$3 WHERE id=$1 AND status='pending'",
        [p.id, Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed', cb.ResultDesc || ''])
    }
  } catch (e) {
    console.error('portal callback', e)
  }
})

/* ================= PORTAL DEVICES (connect ID, live data, commands) ================= */

const ONLINE_MS = 40000 // a phone counts as online if it synced in the last 40 seconds

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v, max = 500) => String(v ?? '').slice(0, max)
const normCid = (v) => { const c = String(v || '').trim().toUpperCase(); return /^[A-Z0-9-]{5,20}$/.test(c) ? c : '' }
const isOnline = (d) => !!d.portal_enabled && !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS

// Only known fields are kept, so a phone can never store anything unexpected
function cleanSnapshot(s = {}) {
  const recent = (Array.isArray(s.recent) ? s.recent : []).slice(0, 5).map((t) => ({
    id: str(t.id, 64), name: str(t.name, 80), phone: str(t.phone, 20), amt: num(t.amt), offer: str(t.offer, 80),
    st: ['Completed', 'Failed', 'Pending', 'Processing', 'Scheduled', 'Unmatched', 'Paused', 'Skipped'].includes(t.st) ? t.st : 'Pending',
    ts: Number.isFinite(Date.parse(t.ts)) ? new Date(t.ts).toISOString() : new Date().toISOString(),
    msg: str(t.msg, 600), ussd: str(t.ussd, 200), resp: str(t.resp, 600),
  }))
  return {
    ok: num(s.ok), failed: num(s.failed), tokens: num(s.tokens),
    airUsed: num(s.airUsed), airBal: num(s.airBal),
    battery: Math.max(0, Math.min(100, Math.round(num(s.battery)))), charging: !!s.charging,
    commission: num(s.commission), running: !!s.running, unlimitedUntil: str(s.unlimitedUntil, 10), recent,
  }
}

/* ---------- Phone side (authenticated with the device key, not a login) ---------- */
async function deviceAuth(req, res, next) {
  try {
    if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
    const cid = normCid(req.headers['x-connect-id'])
    const secret = str(req.headers['x-device-secret'], 100)
    const { data: dev } = await sbAdmin.from('devices').select('*').eq('connect_id', cid).maybeSingle()
    if (!dev || !safeEq(sha(secret), dev.secret_hash)) return res.status(401).json({ error: 'Bad device credentials.' })
    req.dev = dev
    next()
  } catch (e) {
    console.error('deviceAuth', e)
    res.status(500).json({ error: 'Could not check the device.' })
  }
}

app.post('/device/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
      const cid = normCid(req.body && req.body.connectId)
      if (!cid) return res.status(400).json({ error: 'Bad Connect ID.' })
      const secret = crypto.randomBytes(24).toString('hex')
      const { error } = await sbAdmin.from('devices').insert({ connect_id: cid, secret_hash: sha(secret) })
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This device is already registered.' })
        console.error('register', error.message)
        return res.status(500).json({ error: 'Could not register the device.' })
      }
      res.json({ secret })
    } catch (e) {
      console.error('register', e)
      res.status(500).json({ error: 'Could not register the device.' })
    }
  })

app.post('/device/sync',
  rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => String(req.headers['x-connect-id'] || 'none') }),
  deviceAuth,
  async (req, res) => {
    try {
      const b = req.body || {}
      const portalOn = !!b.portalOn
      const patch = { portal_enabled: portalOn, last_seen: new Date().toISOString() }
      if (portalOn && b.snapshot) patch.snapshot = cleanSnapshot(b.snapshot)
      await sbAdmin.from('devices').update(patch).eq('id', req.dev.id)

      const cutoff = new Date(Date.now() - 120000).toISOString()
      await sbAdmin.from('device_commands').update({ status: 'expired' })
        .eq('device_id', req.dev.id).eq('status', 'pending').lt('created_at', cutoff)
      let q = sbAdmin.from('device_commands').select('id,type')
        .eq('device_id', req.dev.id).eq('status', 'pending').order('id').limit(10)
      if (!portalOn) q = q.in('type', ['portal_on', 'portal_off']) // while off, only the switch commands go out
      const { data } = await q
      const commands = data || []
      if (commands.length)
        await sbAdmin.from('device_commands').update({ status: 'sent', done_at: new Date().toISOString() })
          .in('id', commands.map((c) => c.id))

      res.json({ ok: true, commands })
    } catch (e) {
      console.error('sync', e)
      res.status(500).json({ error: 'Sync failed.' })
    }
  })

/* ---------- Portal side (logged-in portal user) ---------- */
app.post('/portal/devices/connect',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => (req.user ? req.user.id : 'none') }),
  async (req, res) => {
    try {
      const plan = planInfo(req.acct)
      if (!plan.active)
        return res.status(403).json({ error: 'Subscribe first to connect a phone. Choose a plan on the subscription page.' })

      const cid = normCid(req.body && req.body.connectId)
      const name = str(req.body && req.body.name, 40).trim()
      if (!cid) return res.status(400).json({ error: 'Enter the Connect ID shown in the app, for example AUB-ABC12.' })
      if (!name) return res.status(400).json({ error: 'Give this phone a name.' })

      const { data: dev } = await sbAdmin.from('devices').select('*').eq('connect_id', cid).maybeSingle()
      if (!dev || !dev.portal_enabled)
return res.status(404).json({ error: 'That phone is not showing as Connected. Open AutoBingwa on it, switch on AutoBingwa Portal, wait for the status to say Connected, then try again.' })
      if (dev.owner_id && dev.owner_id !== req.user.id)
        return res.status(409).json({ error: 'This phone is already connected to another portal account.' })

      if (dev.owner_id !== req.user.id) {
        const { count } = await sbAdmin.from('devices').select('id', { count: 'exact', head: true }).eq('owner_id', req.user.id)
        if ((count || 0) >= plan.max)
          return res.status(403).json({ error: `Your plan allows up to ${plan.max} phone${plan.max === 1 ? '' : 's'}. Upgrade to connect more.` })
      }
      const { error } = await sbAdmin.from('devices').update({ owner_id: req.user.id, name }).eq('id', dev.id)
      if (error) return res.status(500).json({ error: 'Could not connect the phone.' })
      res.json({ ok: true, id: dev.id })
    } catch (e) {
      console.error('connect', e)
      res.status(500).json({ error: 'Could not connect the phone.' })
    }
  })

app.get('/portal/overview', async (req, res) => {
  try {
    const plan = planInfo(req.acct)
    if (!plan.active)
      return res.json({ biz: req.acct.biz || 'My business', cid: req.acct.phone || '', plan, locked: true, devices: [], tx: [], plans: planList() })
    const { data: rows, error } = await sbAdmin.from('devices').select('*').eq('owner_id', req.user.id).order('created_at')
    if (error) return res.status(500).json({ error: 'Could not load your devices.' })
    const now = Date.now()
    const devices = [], tx = []
    for (const d of rows || []) {
      const s = d.snapshot || {}
      devices.push({
        id: d.id, name: d.name || d.connect_id, cid: d.connect_id,
        online: isOnline(d), portalOn: !!d.portal_enabled, running: !!s.running,
        reachable: !!d.last_seen && now - new Date(d.last_seen).getTime() < ONLINE_MS,
        air: s.airBal || 0, used: s.airUsed || 0, tok: s.tokens || 0,
        bat: s.battery || 0, chg: !!s.charging, com: s.commission || 0,
        ok: s.ok || 0, failed: s.failed || 0,
        ...(s.unlimitedUntil ? { until: s.unlimitedUntil } : {}),
      })
      for (const t of s.recent || []) {
        tx.push({
          id: d.id + ':' + t.id, dev: d.id, name: t.name, phone: t.phone, amt: t.amt, offer: t.offer, st: t.st,
          m: Math.max(0, Math.floor((now - Date.parse(t.ts)) / 60000)), msg: t.msg, ussd: t.ussd, resp: t.resp,
        })
      }
    }
    tx.sort((a, b) => a.m - b.m)
    res.json({
      biz: req.acct.biz || 'My business', cid: req.acct.phone || '',
      plan,
      devices, tx, plans: [],
    })
  } catch (e) {
    console.error('overview', e)
    res.status(500).json({ error: 'Could not load your portal.' })
  }
})

async function ownedDevice(req, res) {
  const { data } = await sbAdmin.from('devices').select('*').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle()
  if (!data) { res.status(404).json({ error: 'Device not found.' }); return null }
  return data
}

for (const [path, type] of [['airtime-check', 'airtime_check'], ['start', 'start'], ['stop', 'stop']]) {
  app.post(`/portal/devices/:id/${path}`, async (req, res) => {
    try {
      const d = await ownedDevice(req, res)
      if (!d) return
      if (!planInfo(req.acct).active) return res.status(403).json({ error: 'Your subscription has expired. Renew it to control your phones.' })
      if (!isOnline(d)) return res.status(409).json({ error: 'The phone is offline. Open AutoBingwa on it and check that AutoBingwa Portal is on.' })
      const since = new Date(Date.now() - 20000).toISOString()
      const { data: dup } = await sbAdmin.from('device_commands').select('id')
        .eq('device_id', d.id).eq('type', type).in('status', ['pending', 'sent']).gte('created_at', since).limit(1)
      if (!dup || !dup.length) await sbAdmin.from('device_commands').insert({ device_id: d.id, type })
      res.json({ ok: true })
    } catch (e) {
      console.error('command', e)
      res.status(500).json({ error: 'Could not send the command.' })
    }
  })
}

// Flip the phone's AutoBingwa Portal switch from the portal. Works while the switch is off,
// as long as the phone has checked in recently.
for (const [path, type] of [['portal-on', 'portal_on'], ['portal-off', 'portal_off']]) {
  app.post(`/portal/devices/:id/${path}`, async (req, res) => {
    try {
      const d = await ownedDevice(req, res)
      if (!d) return
      if (!planInfo(req.acct).active) return res.status(403).json({ error: 'Your subscription has expired. Renew it to control your phones.' })
      const seen = d.last_seen ? Date.now() - new Date(d.last_seen).getTime() : Infinity
      if (seen > ONLINE_MS) return res.status(409).json({ error: 'The phone cannot be reached. Open AutoBingwa on it first.' })
      await sbAdmin.from('device_commands').update({ status: 'expired' })
        .eq('device_id', d.id).in('type', ['portal_on', 'portal_off']).eq('status', 'pending')
      const { error } = await sbAdmin.from('device_commands').insert({ device_id: d.id, type })
      if (error) { console.error('switch', error.message); return res.status(500).json({ error: 'Could not send the command.' }) }
      res.json({ ok: true })
    } catch (e) {
      console.error('switch', e)
      res.status(500).json({ error: 'Could not send the command.' })
    }
  })
}

app.post('/portal/devices/:id/unlink', async (req, res) => {
  try {
    const d = await ownedDevice(req, res)
    if (!d) return
    await sbAdmin.from('devices').update({ owner_id: null, name: null }).eq('id', d.id)
    res.json({ ok: true })
  } catch (e) {
    console.error('unlink', e)
    res.status(500).json({ error: 'Could not remove the phone.' })
  }
})

/* ================= TOKENS (M-Pesa) ================= */

// 1. The app asks for an STK push
app.post('/tokens/mpesa/start', async (req, res) => {
  try {
    if (!dbReady) return res.status(503).json({ error: 'Server is starting, try again in a few seconds.' })
    const { planId, deviceId } = req.body || {}
    const phone = normalizePhone(req.body && req.body.phone)
    const amount = PLANS[planId]
    if (!amount) return res.status(400).json({ error: 'Unknown plan.' })
    if (!phone) return res.status(400).json({ error: 'Invalid phone number.' })
    if (!deviceId) return res.status(400).json({ error: 'Missing device.' })

    const ts = stamp()
    const d = await daraja('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      TransactionType: LIVE ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: LIVE ? TILL_NUMBER : SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: `${CALLBACK_BASE}/tokens/mpesa/callback/${CALLBACK_SECRET}`,
      AccountReference: 'AutoBingwa',
      TransactionDesc: `Tokens ${planId}`,
    })
    if (d.ResponseCode !== '0') {
      console.error('stk refused', d)
      return res.status(502).json({ error: d.errorMessage || d.ResponseDescription || 'M-Pesa refused the request.' })
    }

    const id = crypto.randomUUID()
    await pool.query(
      'INSERT INTO payments (id, device_id, phone, plan_id, amount, checkout_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, String(deviceId), phone, planId, amount, d.CheckoutRequestID]
    )
    res.json({ paymentId: id })
  } catch (e) {
    console.error('start', e)
    res.status(500).json({ error: 'Could not start the payment.' })
  }
})

// 2. Safaricom tells us the result
app.post('/tokens/mpesa/callback/:secret', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' }) // always answer Safaricom quickly
  if (req.params.secret !== CALLBACK_SECRET) return
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback
    if (!cb) return
    const { rows } = await pool.query('SELECT * FROM payments WHERE checkout_id = $1', [cb.CheckoutRequestID])
    const p = rows[0]
    if (!p || p.status !== 'pending') return
    if (Number(cb.ResultCode) === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []
      const get = (n) => (items.find((i) => i.Name === n) || {}).Value
      const paid = Number(get('Amount'))
      const receipt = String(get('MpesaReceiptNumber') || '')
      if (!receipt || paid < p.amount) {
        await pool.query("UPDATE payments SET status='failed', message='Amount did not match.' WHERE id=$1", [p.id])
        return
      }
      await pool.query("UPDATE payments SET status='paid', receipt=$2 WHERE id=$1 AND status='pending'", [p.id, receipt])
    } else {
      const status = Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed'
      await pool.query('UPDATE payments SET status=$2, message=$3 WHERE id=$1 AND status=$4', [p.id, status, cb.ResultDesc || '', 'pending'])
    }
  } catch (e) {
    console.error('callback', e)
  }
})

// 3. The app asks whether the money arrived
app.get('/tokens/mpesa/status/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [req.params.id])
    let p = rows[0]
    if (!p || p.device_id !== String(req.query.deviceId || '')) return res.status(404).json({ error: 'Not found.' })

    // If the callback never arrived, ask Safaricom directly after 40 seconds
    if (p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 40000) {
      const ts = stamp()
      const q = await daraja('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: p.checkout_id,
      })
      if (q.ResultCode !== undefined) {
        const code = Number(q.ResultCode)
        if (code === 0) await pool.query("UPDATE payments SET status='paid', receipt=COALESCE(receipt,$2) WHERE id=$1 AND status='pending'", [p.id, p.checkout_id])
        else if (code !== 4999) await pool.query('UPDATE payments SET status=$2, message=$3 WHERE id=$1 AND status=$4', [p.id, code === 1032 ? 'cancelled' : 'failed', q.ResultDesc || '', 'pending'])
        p = (await pool.query('SELECT * FROM payments WHERE id = $1', [p.id])).rows[0]
      }
    }
    res.json({ status: p.status, planId: p.plan_id, amount: p.amount, receipt: p.receipt || '', message: p.message || '' })
  } catch (e) {
    console.error('status', e)
    res.status(500).json({ error: 'Could not check the payment.' })
  }
})

app.listen(PORT, () => {
  console.log('Token server on', PORT)
  initDb()
})