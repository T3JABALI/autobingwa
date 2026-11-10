import crypto from 'crypto'
import rateLimit from 'express-rate-limit'

export const REWARD_PLANS = ['d7', 'd30'] // only Unlimited Weekly and Unlimited Monthly earn a gift day
const ALL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = () => {
  for (;;) {
    let c = ''
    for (let i = 0; i < 5; i++) c += ALL[crypto.randomInt(ALL.length)]
    if (/[A-Z]/.test(c) && /[2-9]/.test(c)) return c // always a mix of letters and numbers
  }
}

export async function initReferralTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS referral_codes (
    user_id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query(`CREATE TABLE IF NOT EXISTS referrals (
    referred_id TEXT PRIMARY KEY, referrer_id TEXT NOT NULL, email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query(`CREATE TABLE IF NOT EXISTS referral_rewards (
    payment_id TEXT PRIMARY KEY, referrer_id TEXT NOT NULL, referred_id TEXT NOT NULL, plan_id TEXT NOT NULL,
    days INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query(`CREATE TABLE IF NOT EXISTS referral_withdrawals (
    id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, days INT NOT NULL, claimed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query('CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id)')
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id TEXT')
}

async function ensureCode(pool, uid) {
  for (let i = 0; i < 20; i++) {
    const have = (await pool.query('SELECT code FROM referral_codes WHERE user_id=$1', [uid])).rows[0]
    if (have) return have.code
    await pool.query('INSERT INTO referral_codes (user_id, code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, makeCode()])
  }
  throw new Error('Could not create a code')
}

// Ties a new user to the code they typed at signup (kept in their signup data). Never changes an existing tie.
async function attach(pool, user) {
  const code = String((user.user_metadata || {}).ref_code || '').toUpperCase().trim()
  if (!/^[A-Z0-9]{5}$/.test(code)) return
  const owner = (await pool.query('SELECT user_id FROM referral_codes WHERE code=$1', [code])).rows[0]
  if (!owner || owner.user_id === user.id) return // no self-referral
  await pool.query('INSERT INTO referrals (referred_id, referrer_id, email) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [user.id, owner.user_id, user.email || ''])
}

const mask = (m) => String(m || '').replace(/^(.{1,2}).*(@.*)$/, '$1***$2') || 'Agent'

export function mountReferralRoutes({ app, pool, sbAdmin }) {
  async function requireAppUser(req, res, next) {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Not configured yet.' })
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!token) return res.status(401).json({ error: 'unauthorized' })
      const { data, error } = await sbAdmin.auth.getUser(token)
      if (error || !data || !data.user) return res.status(401).json({ error: 'unauthorized' })
      req.user = data.user
      next()
    } catch (e) { res.status(401).json({ error: 'unauthorized' }) }
  }

  // Public: lets the signup form say "that code does not exist" before the account is made
  app.get('/referral/check/:code',
    rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }),
    async (req, res) => {
      try {
        const code = String(req.params.code || '').toUpperCase()
        if (!/^[A-Z0-9]{5}$/.test(code)) return res.json({ ok: false })
        const r = await pool.query('SELECT 1 FROM referral_codes WHERE code=$1', [code])
        res.json({ ok: r.rowCount > 0 })
      } catch (e) { res.status(500).json({ error: 'Could not check the code.' }) }
    })

  // The app reports a bought Unlimited Weekly / Monthly token here (airtime or M-Pesa).
  // One reward per purchase: the key below is unique, so reporting twice changes nothing.
  app.post('/referral/report',
    rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
      keyGenerator: (req) => String(req.headers.authorization || 'none').slice(-40) }),
    requireAppUser,
    async (req, res) => {
      try {
        const uid = req.user.id
        const b = req.body || {}
        const planId = String(b.planId || '')
        const via = b.via === 'mpesa' ? 'mpesa' : 'airtime'
        const ref = String(b.ref || '').slice(0, 80)
        if (!REWARD_PLANS.includes(planId) || !ref) return res.json({ ok: true, rewarded: false })

        let key
        if (via === 'mpesa') {
          // M-Pesa is checked against our own payment record, so it cannot be faked
          const p = (await pool.query('SELECT id, plan_id, status, user_id FROM payments WHERE id=$1 OR receipt=$1', [ref])).rows[0]
          if (!p || p.status !== 'paid' || p.plan_id !== planId) return res.json({ ok: true, rewarded: false })
          if (p.user_id && p.user_id !== uid) return res.json({ ok: true, rewarded: false })
          if (!p.user_id) await pool.query('UPDATE payments SET user_id=$2 WHERE id=$1 AND user_id IS NULL', [p.id, uid])
          key = 'mpesa:' + p.id
        } else {
          key = 'air:' + uid + ':' + ref
        }

        await attach(pool, req.user)
        const r = (await pool.query('SELECT referrer_id FROM referrals WHERE referred_id=$1', [uid])).rows[0]
        if (!r) return res.json({ ok: true, rewarded: false })
        const ins = await pool.query(
          'INSERT INTO referral_rewards (payment_id, referrer_id, referred_id, plan_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [key, r.referrer_id, uid, planId])
        res.json({ ok: true, rewarded: ins.rowCount > 0 })
      } catch (e) { console.error('referral report', e); res.status(500).json({ error: 'Could not record the purchase.' }) }
    })

  app.use('/referral/me', requireAppUser)
  app.use('/referral/withdraw', requireAppUser)

  app.get('/referral/me', async (req, res) => {
    try {
      const uid = req.user.id
      const code = await ensureCode(pool, uid)
      await attach(pool, req.user)
      const sum = (await pool.query(
        `SELECT (SELECT COALESCE(SUM(days),0) FROM referral_rewards WHERE referrer_id=$1)::int AS earned,
                (SELECT COALESCE(SUM(days),0) FROM referral_withdrawals WHERE user_id=$1)::int AS taken`, [uid])).rows[0]
      const list = (await pool.query(
        `SELECT r.referred_id, r.email, r.created_at, COUNT(w.payment_id)::int AS buys, COALESCE(SUM(w.days),0)::int AS days,
                MAX(w.created_at) AS last_at, (ARRAY_AGG(w.plan_id ORDER BY w.created_at DESC))[1] AS last_plan
         FROM referrals r LEFT JOIN referral_rewards w ON w.referred_id=r.referred_id AND w.referrer_id=r.referrer_id
         WHERE r.referrer_id=$1 GROUP BY r.referred_id, r.email, r.created_at
         ORDER BY MAX(w.created_at) DESC NULLS LAST, r.created_at DESC LIMIT 100`, [uid])).rows
      const pending = (await pool.query('SELECT id, days FROM referral_withdrawals WHERE user_id=$1 AND NOT claimed ORDER BY id', [uid])).rows
      res.json({
        code, earned: sum.earned, balance: sum.earned - sum.taken, pending,
        list: list.map((r) => ({
          id: r.referred_id, who: mask(r.email), active: r.buys > 0, buys: r.buys, days: r.days,
          plan: r.last_plan, at: r.last_at || r.created_at,
        })),
      })
    } catch (e) { console.error('referral me', e); res.status(500).json({ error: 'Could not load referrals.' }) }
  })

  // Takes the whole balance in one locked step. The app then adds the days to the wallet and confirms.
  app.post('/referral/withdraw',
    rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
      keyGenerator: (req) => String(req.headers.authorization || 'none').slice(-40) }),
    async (req, res) => {
      const c = await pool.connect()
      try {
        const uid = req.user.id
        await c.query('BEGIN')
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [uid])
        const b = (await c.query(
          `SELECT (SELECT COALESCE(SUM(days),0) FROM referral_rewards WHERE referrer_id=$1) -
                  (SELECT COALESCE(SUM(days),0) FROM referral_withdrawals WHERE user_id=$1) AS bal`, [uid])).rows[0]
        const days = Number(b.bal) || 0
        if (days < 1) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'You have no gift days to withdraw yet.' }) }
        const w = (await c.query('INSERT INTO referral_withdrawals (user_id, days) VALUES ($1,$2) RETURNING id', [uid, days])).rows[0]
        await c.query('COMMIT')
        res.json({ id: w.id, days })
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {})
        console.error('referral withdraw', e); res.status(500).json({ error: 'Could not withdraw.' })
      } finally { c.release() }
    })

  app.post('/referral/withdraw/:id/ack', async (req, res) => {
    try {
      await pool.query('UPDATE referral_withdrawals SET claimed=true WHERE id=$1 AND user_id=$2', [Number(req.params.id) || 0, req.user.id])
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: 'Could not confirm.' }) }
  })
}