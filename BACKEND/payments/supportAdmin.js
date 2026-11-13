import rateLimit from 'express-rate-limit'

const cut = (v, max) => String(v ?? '').trim().slice(0, max)

export async function initSupportTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS support_messages (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT,
    user_name TEXT,
    from_admin BOOLEAN NOT NULL DEFAULT false,
    body TEXT NOT NULL,
    client_id TEXT,
    read_by_admin BOOLEAN NOT NULL DEFAULT false,
    read_by_user BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query('CREATE INDEX IF NOT EXISTS support_user_idx ON support_messages (user_id, id DESC)')
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS support_client_uq ON support_messages (user_id, client_id)')
}

const out = (r) => ({
  id: Number(r.id),
  from: r.from_admin ? 'admin' : 'user',
  text: r.body,
  at: new Date(r.created_at).getTime(),
  cid: r.client_id || '',
})

export function mountSupportRoutes({ app, pool, requireAdmin, sbAdmin }) {
  // Any signed-in app user (checked with their Supabase login)
  async function requireAppUser(req, res, next) {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Support is not configured yet.' })
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!token) return res.status(401).json({ error: 'unauthorized' })
      const { data, error } = await sbAdmin.auth.getUser(token)
      if (error || !data || !data.user) return res.status(401).json({ error: 'unauthorized' })
      req.appUser = data.user
      next()
    } catch (e) {
      console.error('requireAppUser', e)
      res.status(401).json({ error: 'unauthorized' })
    }
  }

  /* ---------- App side ---------- */

  // A user sends a message. The clientId stops a retry from saving the same message twice.
  app.post('/support/send', requireAppUser,
    rateLimit({ windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
      keyGenerator: (req) => req.appUser.id }),
    async (req, res) => {
      try {
        const text = cut(req.body && req.body.text, 1000)
        if (!text) return res.status(400).json({ error: 'Write a message first.' })
        const cid = cut(req.body && req.body.clientId, 64) || null
        const name = cut(req.body && req.body.name, 80)
        await pool.query(
          `INSERT INTO support_messages (user_id, user_email, user_name, from_admin, body, client_id, read_by_user)
           VALUES ($1,$2,$3,false,$4,$5,true) ON CONFLICT (user_id, client_id) DO NOTHING`,
          [req.appUser.id, req.appUser.email || '', name, text, cid])
        res.json({ ok: true })
      } catch (e) {
        console.error('support send', e)
        res.status(500).json({ error: 'Could not send the message.' })
      }
    })

  // A user reads their own conversation (including replies)
  app.get('/support/thread', requireAppUser, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM (SELECT * FROM support_messages WHERE user_id=$1 ORDER BY id DESC LIMIT 100) t ORDER BY id',
        [req.appUser.id])
      if (req.query.read === '1')
        await pool.query('UPDATE support_messages SET read_by_user=true WHERE user_id=$1 AND from_admin AND NOT read_by_user',
          [req.appUser.id])
      res.json({ messages: rows.map(out) })
    } catch (e) {
      console.error('support thread', e)
      res.status(500).json({ error: 'Could not load the messages.' })
    }
  })

  /* ---------- Admin side ---------- */

  // One row per customer: last message and how many are unread
  app.get('/admin/support/threads', requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT * FROM (
          SELECT DISTINCT ON (m.user_id)
            m.user_id, m.user_email AS email, m.user_name AS name,
            m.body AS last_body, m.from_admin AS last_from_admin, m.created_at AS last_at,
            (SELECT COUNT(*) FROM support_messages u
               WHERE u.user_id = m.user_id AND NOT u.from_admin AND NOT u.read_by_admin)::int AS unread
          FROM support_messages m
          ORDER BY m.user_id, m.id DESC
        ) t ORDER BY last_at DESC LIMIT 200`)
      res.json({
        threads: rows.map((r) => ({
          userId: r.user_id, email: r.email || '', name: r.name || '',
          last: r.last_body, lastFromAdmin: r.last_from_admin,
          at: new Date(r.last_at).getTime(), unread: r.unread,
        })),
      })
    } catch (e) {
      console.error('support threads', e)
      res.status(500).json({ error: 'Could not load the messages.' })
    }
  })

  app.get('/admin/support/unread', requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM support_messages WHERE NOT from_admin AND NOT read_by_admin')
      res.json({ count: rows[0].n })
    } catch (e) {
      console.error('support unread', e)
      res.status(500).json({ error: 'Could not count the messages.' })
    }
  })

  // Open one conversation (this also marks the customer's messages as read)
  app.get('/admin/support/thread/:userId', requireAdmin, async (req, res) => {
    try {
      const uid = cut(req.params.userId, 64)
      const { rows } = await pool.query(
        'SELECT * FROM (SELECT * FROM support_messages WHERE user_id=$1 ORDER BY id DESC LIMIT 200) t ORDER BY id', [uid])
      await pool.query(
        'UPDATE support_messages SET read_by_admin=true WHERE user_id=$1 AND NOT from_admin AND NOT read_by_admin', [uid])
      const first = rows.length ? rows[rows.length - 1] : null
      res.json({ messages: rows.map(out), email: first ? first.user_email || '' : '', name: first ? first.user_name || '' : '' })
    } catch (e) {
      console.error('support thread admin', e)
      res.status(500).json({ error: 'Could not load the conversation.' })
    }
  })

  // The admin replies
  app.post('/admin/support/reply', requireAdmin, async (req, res) => {
    try {
      const uid = cut(req.body && req.body.userId, 64)
      const text = cut(req.body && req.body.text, 1000)
      if (!uid || !text) return res.status(400).json({ error: 'Write a reply first.' })
      const { rows } = await pool.query(
        'SELECT user_email, user_name FROM support_messages WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [uid])
      if (!rows[0]) return res.status(404).json({ error: 'That conversation was not found.' })
      await pool.query(
        `INSERT INTO support_messages (user_id, user_email, user_name, from_admin, body, read_by_admin, read_by_user)
         VALUES ($1,$2,$3,true,$4,true,false)`,
        [uid, rows[0].user_email, rows[0].user_name, text])
      res.json({ ok: true })
    } catch (e) {
      console.error('support reply', e)
      res.status(500).json({ error: 'Could not send the reply.' })
    }
  })
}