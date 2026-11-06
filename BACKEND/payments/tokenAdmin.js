import crypto from 'crypto'
import rateLimit from 'express-rate-limit'

// Used only the first time, to fill an empty token_plans table with today's plans
const DEFAULT_PLANS = [
  ['u1000', 'units', 1000, 90],
  ['u600', 'units', 600, 50],
  ['u250', 'units', 250, 25],
  ['u100', 'units', 100, 15],
  ['d1', 'days', 1, 30],
  ['d7', 'days', 7, 200],
  ['d30', 'days', 30, 550],
]

export const planName = (kind, amount) =>
  kind === 'days'
    ? `${amount} day${Number(amount) === 1 ? '' : 's'} unlimited`
    : `${Number(amount).toLocaleString('en-US')} units`

const planOut = (r) => ({
  id: r.id, kind: r.kind, amount: r.amount, price: r.price,
  label: r.label || planName(r.kind, r.amount), active: r.active,
})

function planError(kind, amount, price) {
  if (kind !== 'units' && kind !== 'days') return 'Choose units or days.'
  const max = kind === 'days' ? 3650 : 1000000
  if (!(amount >= 1 && amount <= max))
    return kind === 'days' ? 'Days must be between 1 and 3650.' : 'Units must be between 1 and 1,000,000.'
  if (!(price >= 1 && price <= 150000)) return 'Price must be between KSh 1 and KSh 150,000.'
  return ''
}

// Letters and numbers, without the look-alikes 0 O 1 I. Always has at least one of each.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeCode() {
  for (;;) {
    let c = ''
    for (let i = 0; i < 8; i++) c += CHARS[crypto.randomInt(CHARS.length)]
    if (/[A-Z]/.test(c) && /[2-9]/.test(c)) return c
  }
}
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function initTokenTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS token_plans (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, amount INT NOT NULL, price INT NOT NULL,
    label TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query(`CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY, plan_id TEXT, kind TEXT NOT NULL, amount INT NOT NULL,
    label TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unused',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ,
    redeemed_by TEXT, redeemed_at TIMESTAMPTZ)`)
  // Supabase exposes public tables to the internet unless row security is on.
  // With no policies, only this server can read or change these two tables.
  await pool.query('ALTER TABLE token_plans ENABLE ROW LEVEL SECURITY')
  await pool.query('ALTER TABLE coupons ENABLE ROW LEVEL SECURITY')
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM token_plans')
  if (!rows[0].n) {
    let i = 0
    for (const [id, kind, amount, price] of DEFAULT_PLANS)
      await pool.query(
        'INSERT INTO token_plans (id,kind,amount,price,label,sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [id, kind, amount, price, planName(kind, amount), i++ * 10])
  }
}

// An active plan by id, or null. The price always comes from here, never from the app.
export async function getTokenPlan(pool, id) {
  const { rows } = await pool.query('SELECT * FROM token_plans WHERE id=$1 AND active', [String(id || '')])
  return rows[0] ? planOut(rows[0]) : null
}

export function mountTokenRoutes({ app, pool, requireAdmin }) {
  const fail = (res, tag, e, msg) => { console.error(tag, e); res.status(500).json({ error: msg }) }

  /* ---------- Public: what the app shows ---------- */
  app.get('/tokens/plans', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM token_plans WHERE active ORDER BY sort_order, price')
      res.set('Cache-Control', 'no-store')
      res.json({ plans: rows.map(planOut) })
    } catch (e) { fail(res, 'token plans', e, 'Could not load the token plans.') }
  })

  // Only wrong attempts count towards the limits, so a real user is never blocked
  const byIp = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    skipSuccessfulRequests: true, message: { error: 'Too many wrong attempts. Try again in a few minutes.' } })
  const byDevice = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    skipSuccessfulRequests: true, message: { error: 'Too many wrong attempts. Try again later.' },
    keyGenerator: (req) => 'dev:' + String((req.body && req.body.deviceId) || 'none').slice(0, 64) })

  app.post('/tokens/coupon/redeem', byIp, byDevice, async (req, res) => {
    try {
      const code = normCode(req.body && req.body.code)
      const deviceId = String((req.body && req.body.deviceId) || '').slice(0, 64)
      if (!deviceId) return res.status(400).json({ error: 'Missing device.' })
      if (!/^[A-Z0-9]{8}$/.test(code)) return res.status(400).json({ error: 'A coupon code has 8 letters and numbers.' })
      // One atomic step: the code can be used once, by one person, even if two phones try at the same time
      const { rows } = await pool.query(
        `UPDATE coupons SET status='used', redeemed_by=$2, redeemed_at=now()
         WHERE code=$1 AND status='unused' AND (expires_at IS NULL OR expires_at > now())
         RETURNING kind, amount, label`, [code, deviceId])
      if (!rows[0]) return res.status(404).json({ error: 'This coupon is not valid. It may be wrong, already used or expired.' })
      const c = rows[0]
      res.json({ ok: true, kind: c.kind, amount: c.amount, label: c.label, receipt: 'COUPON-' + code })
    } catch (e) { fail(res, 'redeem', e, 'Could not use the coupon.') }
  })

  /* ---------- Admin: token plans ---------- */
  app.get('/admin/tokens/plans', requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM token_plans ORDER BY sort_order, price')
      res.json({ plans: rows.map(planOut) })
    } catch (e) { fail(res, 'admin plans', e, 'Could not load the plans.') }
  })

  app.post('/admin/tokens/plans', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {}
      const kind = String(b.kind || '')
      const amount = Math.round(Number(b.amount)), price = Math.round(Number(b.price))
      const bad = planError(kind, amount, price)
      if (bad) return res.status(400).json({ error: bad })
      const label = String(b.label || '').trim().slice(0, 60) || planName(kind, amount)
      let id = (kind === 'days' ? 'd' : 'u') + amount
      const taken = await pool.query('SELECT 1 FROM token_plans WHERE id=$1', [id])
      if (taken.rows.length) id += '-' + crypto.randomBytes(2).toString('hex')
      const m = await pool.query('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM token_plans')
      const { rows } = await pool.query(
        'INSERT INTO token_plans (id,kind,amount,price,label,active,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [id, kind, amount, price, label, b.active !== false, m.rows[0].n])
      res.json({ plan: planOut(rows[0]) })
    } catch (e) { fail(res, 'add plan', e, 'Could not add the plan.') }
  })

  app.put('/admin/tokens/plans/:id', requireAdmin, async (req, res) => {
    try {
      const cur = (await pool.query('SELECT * FROM token_plans WHERE id=$1', [req.params.id])).rows[0]
      if (!cur) return res.status(404).json({ error: 'Plan not found.' })
      const b = req.body || {}
      const amount = b.amount !== undefined ? Math.round(Number(b.amount)) : cur.amount
      const price = b.price !== undefined ? Math.round(Number(b.price)) : cur.price
      const bad = planError(cur.kind, amount, price)
      if (bad) return res.status(400).json({ error: bad })
      let label = b.label !== undefined ? String(b.label).trim().slice(0, 60) : cur.label
      // A name that is just the automatic one follows the new number
      if (!label || label === planName(cur.kind, cur.amount)) label = planName(cur.kind, amount)
      const active = b.active !== undefined ? !!b.active : cur.active
      const { rows } = await pool.query(
        'UPDATE token_plans SET amount=$2, price=$3, label=$4, active=$5, updated_at=now() WHERE id=$1 RETURNING *',
        [cur.id, amount, price, label, active])
      res.json({ plan: planOut(rows[0]) })
    } catch (e) { fail(res, 'edit plan', e, 'Could not save the plan.') }
  })

  app.delete('/admin/tokens/plans/:id', requireAdmin, async (req, res) => {
    try {
      const r = await pool.query('DELETE FROM token_plans WHERE id=$1', [req.params.id])
      if (!r.rowCount) return res.status(404).json({ error: 'Plan not found.' })
      res.json({ ok: true })
    } catch (e) { fail(res, 'delete plan', e, 'Could not delete the plan.') }
  })

  /* ---------- Admin: coupons (codes are only ever made here) ---------- */
  app.post('/admin/coupons', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {}
      const count = Math.round(Number(b.count))
      const days = Math.round(Number(b.expiresDays) || 0)
      if (!(count >= 1 && count <= 100)) return res.status(400).json({ error: 'Make between 1 and 100 codes at a time.' })
      if (days < 0 || days > 365) return res.status(400).json({ error: 'Expiry must be between 1 and 365 days, or never.' })
      const plan = (await pool.query('SELECT * FROM token_plans WHERE id=$1', [String(b.planId || '')])).rows[0]
      if (!plan) return res.status(404).json({ error: 'Choose a token plan.' })
      const expires = days ? new Date(Date.now() + days * 86400000).toISOString() : null
      const label = plan.label || planName(plan.kind, plan.amount)
      const codes = []
      while (codes.length < count) {
        const code = makeCode()
        const r = await pool.query(
          'INSERT INTO coupons (code, plan_id, kind, amount, label, expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING',
          [code, plan.id, plan.kind, plan.amount, label, expires])
        if (r.rowCount) codes.push(code)
      }
      res.json({ codes })
    } catch (e) { fail(res, 'make coupons', e, 'Could not make the coupons.') }
  })

  app.get('/admin/coupons', requireAdmin, async (req, res) => {
    try {
      const c = await pool.query(`SELECT
        count(*) FILTER (WHERE status='unused' AND (expires_at IS NULL OR expires_at > now()))::int AS unused,
        count(*) FILTER (WHERE status='used')::int AS used,
        count(*) FILTER (WHERE status='unused' AND expires_at <= now())::int AS expired,
        count(*) FILTER (WHERE status='revoked')::int AS revoked FROM coupons`)
      const { rows } = await pool.query(
        'SELECT code,label,kind,amount,status,created_at,expires_at,redeemed_by,redeemed_at FROM coupons ORDER BY created_at DESC, code LIMIT 300')
      const now = Date.now()
      res.json({
        counts: c.rows[0],
        coupons: rows.map((r) => ({
          code: r.code, plan: r.label, kind: r.kind, amount: r.amount,
          status: r.status === 'unused' && r.expires_at && new Date(r.expires_at).getTime() <= now ? 'expired' : r.status,
          created: new Date(r.created_at).toISOString(),
          expires: r.expires_at ? new Date(r.expires_at).toISOString() : null,
          redeemedBy: r.redeemed_by || '',
          redeemedAt: r.redeemed_at ? new Date(r.redeemed_at).toISOString() : null,
        })),
      })
    } catch (e) { fail(res, 'list coupons', e, 'Could not load the coupons.') }
  })

  app.delete('/admin/coupons/:code', requireAdmin, async (req, res) => {
    try {
      const r = await pool.query("UPDATE coupons SET status='revoked' WHERE code=$1 AND status='unused'", [normCode(req.params.code)])
      if (!r.rowCount) return res.status(404).json({ error: 'Only unused codes can be revoked.' })
      res.json({ ok: true })
    } catch (e) { fail(res, 'revoke coupon', e, 'Could not revoke the coupon.') }
  })
}