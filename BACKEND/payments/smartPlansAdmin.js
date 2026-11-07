import crypto from 'crypto'
import rateLimit from 'express-rate-limit'

const ONLINE_MS = 40000
const LEARN_PHONE = '0700000000'
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const NIGHT = { on: true, from: '19:00', until: '23:00', altId: '', notify: false, msg: '' }
const NO_TW = { on: false, from: '06:00', until: '22:00', altId: '', notify: false, msg: '' }

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v, max = 500) => String(v ?? '').slice(0, max)
const normUssd = (v) => String(v || '').replace(/\s+/g, '').replace(/ab/gi, 'AB').slice(0, 200)
const stepsOf = (u) => u.replace(/^\*/, '').replace(/#$/, '').split('*')
const ussdError = (u) => !u ? 'Enter the USSD code'
  : !u.includes('AB') ? 'The USSD code must contain AB where the phone number goes'
  : !/^\*[0-9*]+#$/.test(u.replace(/AB/g, '0')) ? 'The USSD code must start with * and end with #, with only numbers and * between'
  : ''
const cleanTw = (t) => {
  t = t && typeof t === 'object' ? t : {}
  return { on: !!t.on, from: HHMM.test(t.from) ? t.from : '06:00', until: HHMM.test(t.until) ? t.until : '22:00',
    altId: str(t.altId, 64), notify: !!t.notify, msg: str(t.msg, 300) }
}
const cleanSigRaw = (s) => {
  try {
    if (!s || typeof s !== 'object' || !Array.isArray(s.steps) || s.steps.length > 30) return null
    const j = JSON.stringify(s)
    if (j.length > 20000) return null
    const o = JSON.parse(j)
    o.complete = !!o.complete
    return o
  } catch { return null }
}
const isOnline = (d) => !!d.portal_enabled && !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS

// [group, sid, name, Safaricom price, ussd, time window]
const SEED = [
  ['Bingwa', 'sd-b1', '1GB 1HR Bingwa', 19, '*180*5*2*AB*1*1#'],
  ['Bingwa', 'sd-b2', '250MBS 24HRS Bingwa', 20, '*180*5*2*AB*2*1#'],
  ['Bingwa', 'sd-b3', '750MBS 24HRS Bingwa', 52, '*180*5*2*AB*3*1#'],
  ['Bingwa', 'sd-b4', '400MBS 7 DAYS', 49, '*180*5*2*AB*4*1#'],
  ['Bingwa', 'sd-b5', '1.5GB 24HRS Bingwa', 99, '*180*5*2*AB*5*1#'],
  ['Bingwa', 'sd-b6', '1GB MIDNIGHT', 55, '*180*5*2*AB*6*1#'],
  ['Bingwa', 'sd-b7', '1.5GB 3HRS Bingwa', 50, '*180*5*2*AB*7*1#'],
  ['Bingwa', 'sd-b8', '400MBS 1HR', 25, '*180*5*2*AB*1*1#', NIGHT],
  ['Tunukiwa', 'sd-t1', '1GB 1HR TUNUKIWA', 23, '*544*6*8*AB*00*1*0*1*1#'],
  ['Tunukiwa', 'sd-t2', '2GB 24HRS', 110, '*456*1*12*0*AB*1*1#'],
  ['Tunukiwa', 'sd-t3', '1.5GB 3HRS TUNUKIWA', 54, '*544*6*8*AB*00*1*0*2*1#'],
  ['Tunukiwa', 'sd-t4', '400MBS 1HR TUNUKIWA', 26, '*544*6*8*AB*00*1*0*1*1#', NIGHT],
  ['Tunukiwa', 'sd-t5', '900MBS TILL MIDNIGHT', 57, '*544*6*8*AB*1*0*6*1#'],
  ['Patamore', 'sd-p1', '700MBS 24HRS PATAMORE', 56, '*544*1*1*6*AB*2*1#'],
  ['Patamore', 'sd-p2', '1.5GB 24HRS PATAMORE', 105, '*544*1*1*6*AB*1*1#'],
  ['Patamore', 'sd-p3', '250MBS 24HRS PATAMORE', 24, '*544*1*1*6*AB*3*1#'],
  ['Minutes', 'sd-m1', '45MINS 3HRS', 22, '*544*5*8*AB*00*13*8*1*1#'],
  ['Minutes', 'sd-m2', '60 MINS MIDNIGHT', 51, '*544*5*8*AB*00*13*8*2*1#'],
  ['SMS', 'sd-s1', '20SMS 1 DAY', 5, '*188*8*1*1*AB*1*2#'],
  ['SMS', 'sd-s2', '1000SMS 7 DAYS', 30, '*188*8*2*2*AB*1*2#'],
  ['SMS', 'sd-s3', '200SMS 1 DAY', 10, '*188*8*1*2*AB*1*2#'],
]

export async function initSmartTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS smart_plans (
    sid TEXT PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, saf_price INT NOT NULL DEFAULT 0,
    ussd TEXT NOT NULL, steps JSONB NOT NULL DEFAULT '[]', sig JSONB, tw JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true, sort INT NOT NULL DEFAULT 0, pub JSONB,
    rev BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`)
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM smart_plans')
  if (rows[0].n === 0) {
    let sort = 0
    for (const [grp, sid, name, price, ussd, tw] of SEED) {
      sort += 10
      await pool.query(
        `INSERT INTO smart_plans (sid,grp,name,saf_price,ussd,steps,tw,sort) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
         ON CONFLICT (sid) DO NOTHING`,
        [sid, grp, name, price, ussd, JSON.stringify(stepsOf(ussd)), JSON.stringify(tw || NO_TW), sort])
    }
    console.log('Smart plans seeded:', SEED.length)
  }
}

// What users receive: the last published copy of a plan
const pubOf = (r) => ({ group: r.grp, name: r.name, safPrice: r.saf_price, ussd: r.ussd, steps: r.steps, sig: r.sig, tw: r.tw })

const toAdmin = (r) => ({
  sid: r.sid, group: r.grp, name: r.name, safPrice: r.saf_price, ussd: r.ussd, tw: r.tw, active: r.active, sort: r.sort,
  // draft = never published, relearn = USSD changed and users still have the old copy, published = live
  status: !r.pub ? 'draft' : r.sig ? 'published' : 'relearn',
  hasSig: !!r.sig,
  sigView: r.sig ? r.sig.steps.map((s) => (s.kind === 'menu' ? `${s.hint}: ${s.label}` : s.value)) : [],
  rev: Number(r.rev),
})

async function getPlan(pool, sid) {
  return (await pool.query('SELECT * FROM smart_plans WHERE sid=$1', [str(sid, 64)])).rows[0] || null
}

async function learning(pool, sbAdmin) {
  const { rows } = await pool.query("SELECT value FROM admin_settings WHERE key='learn_connect_id'")
  const cid = (rows[0] && rows[0].value) || ''
  if (!cid || !sbAdmin) return { cid, dev: null }
  const { data } = await sbAdmin.from('devices').select('*').eq('connect_id', cid).maybeSingle()
  return { cid, dev: data || null }
}

export function mountSmartRoutes({ app, pool, requireAdmin, sbAdmin }) {
  /* ---------- Public: the catalog every user's app reads ---------- */
  app.get('/smart/catalog',
    rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }),
    async (req, res) => {
      try {
        const { rows } = await pool.query('SELECT sid, pub, rev FROM smart_plans WHERE active AND pub IS NOT NULL ORDER BY sort, sid')
        const version = crypto.createHash('md5').update(rows.map((r) => r.sid + ':' + r.rev).join('|')).digest('hex').slice(0, 16)
        if (String(req.query.v || '') === version) return res.json({ version, unchanged: true })
        const groups = []
        const plans = rows.map((r) => {
          if (!groups.includes(r.pub.group)) groups.push(r.pub.group)
          return { sid: r.sid, ...r.pub, rev: Number(r.rev) }
        })
        res.json({ version, groups, plans })
      } catch (e) {
        console.error('smart catalog', e.message)
        res.status(503).json({ error: 'Catalog not available yet.' })
      }
    })

  /* ---------- Admin ---------- */
  const fail = (res, tag) => (e) => { console.error(tag, e); res.status(500).json({ error: 'Something went wrong. Try again.' }) }

  app.get('/admin/smart-plans', requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM smart_plans ORDER BY sort, sid')
      const l = await learning(pool, sbAdmin)
      res.json({ plans: rows.map(toAdmin), phone: { connectId: l.cid, found: !!l.dev, online: l.dev ? isOnline(l.dev) : false } })
    } catch (e) { fail(res, 'smart list')(e) }
  })

  // The phone that learns signatures (enter the Connect ID shown in the app)
  app.put('/admin/smart-plans-phone', requireAdmin, async (req, res) => {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Admin is not configured yet.' })
      const cid = String((req.body && req.body.connectId) || '').trim().toUpperCase()
      if (!/^[A-Z0-9-]{5,20}$/.test(cid)) return res.status(400).json({ error: 'Enter the Connect ID shown in the app, for example AUB-ABC12.' })
      const { data } = await sbAdmin.from('devices').select('id').eq('connect_id', cid).maybeSingle()
      if (!data) return res.status(404).json({ error: 'No phone with that Connect ID. Open AutoBingwa on it and switch on AutoBingwa Portal first.' })
      await pool.query(`INSERT INTO admin_settings (key,value) VALUES ('learn_connect_id',$1)
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [cid])
      res.json({ ok: true })
    } catch (e) { fail(res, 'smart phone')(e) }
  })

  app.post('/admin/smart-plans', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {}
      const grp = str(b.group, 30).trim(), name = str(b.name, 80).trim(), ussd = normUssd(b.ussd), price = Math.round(num(b.safPrice))
      if (!grp) return res.status(400).json({ error: 'Choose or type a group.' })
      if (!name) return res.status(400).json({ error: 'Enter the plan name.' })
      const e = ussdError(ussd)
      if (e) return res.status(400).json({ error: e })
      if (!(price > 0) || price > 100000) return res.status(400).json({ error: 'Enter the Safaricom price.' })
      const tw = b.tw ? cleanTw(b.tw) : NO_TW
      if (tw.on && tw.from === tw.until) return res.status(400).json({ error: 'The start and end time cannot be the same.' })
      const sid = 'sd-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex')
      const { rows } = await pool.query('SELECT COALESCE(MAX(sort),0)+10 AS s FROM smart_plans')
      await pool.query(
        `INSERT INTO smart_plans (sid,grp,name,saf_price,ussd,steps,tw,sort,rev) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
        [sid, grp, name, price, ussd, JSON.stringify(stepsOf(ussd)), JSON.stringify(tw), rows[0].s, Date.now()])
      res.json({ ok: true, sid })
    } catch (e) { fail(res, 'smart add')(e) }
  })

  app.put('/admin/smart-plans/:sid', requireAdmin, async (req, res) => {
    try {
      const cur = await getPlan(pool, req.params.sid)
      if (!cur) return res.status(404).json({ error: 'Plan not found.' })
      const b = req.body || {}
      const n = { ...cur }
      if (b.name !== undefined) n.name = str(b.name, 80).trim()
      if (b.group !== undefined) n.grp = str(b.group, 30).trim()
      if (b.safPrice !== undefined) n.saf_price = Math.round(num(b.safPrice))
      if (b.tw !== undefined) n.tw = cleanTw(b.tw)
      if (b.active !== undefined) n.active = !!b.active
      if (b.sort !== undefined) n.sort = Math.round(num(b.sort))
      let ussdChanged = false
      if (b.ussd !== undefined) {
        const u = normUssd(b.ussd)
        if (u !== cur.ussd) {
          const e = ussdError(u)
          if (e) return res.status(400).json({ error: e })
          n.ussd = u; n.steps = stepsOf(u); n.sig = null // the old signature no longer fits: learn it again
          ussdChanged = true
        }
      }
      if (!n.name) return res.status(400).json({ error: 'Enter the plan name.' })
      if (!n.grp) return res.status(400).json({ error: 'Choose or type a group.' })
      if (!(n.saf_price > 0) || n.saf_price > 100000) return res.status(400).json({ error: 'Enter the Safaricom price.' })
      if (n.tw.on && n.tw.from === n.tw.until) return res.status(400).json({ error: 'The start and end time cannot be the same.' })
      // Users keep the old USSD and signature until the new signature is saved. Everything else goes live now.
      if (cur.pub) n.pub = { ...cur.pub, group: n.grp, name: n.name, safPrice: n.saf_price, tw: n.tw }
      await pool.query(
        `UPDATE smart_plans SET grp=$2,name=$3,saf_price=$4,ussd=$5,steps=$6::jsonb,sig=$7::jsonb,tw=$8::jsonb,active=$9,sort=$10,pub=$11::jsonb,rev=$12 WHERE sid=$1`,
        [cur.sid, n.grp, n.name, n.saf_price, n.ussd, JSON.stringify(n.steps), n.sig ? JSON.stringify(n.sig) : null,
          JSON.stringify(n.tw), n.active, n.sort, n.pub ? JSON.stringify(n.pub) : null, Date.now()])
      res.json({ ok: true, needsLearn: ussdChanged })
    } catch (e) { fail(res, 'smart edit')(e) }
  })

  app.delete('/admin/smart-plans/:sid', requireAdmin, async (req, res) => {
    try {
      const r = await pool.query('DELETE FROM smart_plans WHERE sid=$1', [str(req.params.sid, 64)])
      if (!r.rowCount) return res.status(404).json({ error: 'Plan not found.' })
      res.json({ ok: true })
    } catch (e) { fail(res, 'smart delete')(e) }
  })

  // Learn the signature on the learning phone, using SIM 1 or SIM 2
  app.post('/admin/smart-plans/:sid/learn', requireAdmin, async (req, res) => {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Admin is not configured yet.' })
      const r = await getPlan(pool, req.params.sid)
      if (!r) return res.status(404).json({ error: 'Plan not found.' })
      const sim = req.body && req.body.sim === 'SIM 2' ? 'SIM 2' : 'SIM 1'
      const { dev } = await learning(pool, sbAdmin)
      if (!dev) return res.status(400).json({ error: 'Set the learning phone first (its Connect ID).' })
      if (!isOnline(dev)) return res.status(409).json({ error: 'The learning phone is offline. Open AutoBingwa on it and check that AutoBingwa Portal is on.' })
      const { data: dup } = await sbAdmin.from('device_commands').select('id').eq('device_id', dev.id).eq('type', 'sig_learn')
        .in('status', ['pending', 'sent']).is('result', null).gte('created_at', new Date(Date.now() - 150000).toISOString()).limit(1)
      if (dup && dup.length) return res.status(409).json({ error: 'A signature is already being learned on that phone. Wait for it to finish.' })
      const { data, error } = await sbAdmin.from('device_commands')
        .insert({ device_id: dev.id, type: 'sig_learn', payload: { offerId: r.sid, ussd: r.ussd, testPhone: LEARN_PHONE, sim } })
        .select('id').single()
      if (error) throw new Error(error.message)
      res.json({ ok: true, job: data.id, sim })
    } catch (e) { fail(res, 'smart learn')(e) }
  })

  app.get('/admin/smart-plans/:sid/learn/:job', requireAdmin, async (req, res) => {
    try {
      const { data: c } = await sbAdmin.from('device_commands').select('*').eq('id', num(req.params.job)).eq('type', 'sig_learn').maybeSingle()
      if (!c || !c.payload || c.payload.offerId !== req.params.sid) return res.status(404).json({ error: 'Not found.' })
      if (c.result === 'ok') {
        try {
          const r = JSON.parse(c.result_msg)
          return res.json({ status: 'done', signature: r.signature, screens: r.screens || [] })
        } catch { return res.json({ status: 'error', error: 'The phone returned a signature that could not be read.' }) }
      }
      if (c.result) return res.json({ status: 'error', error: c.result_msg || 'Learning failed on the phone.' })
      if (c.status === 'expired') return res.json({ status: 'error', error: 'The phone did not respond. Check that it is online and try again.' })
      if (Date.now() - new Date(c.created_at).getTime() > 150000) return res.json({ status: 'error', error: 'The phone took too long. Keep it unlocked and try again.' })
      res.json({ status: 'running' })
    } catch (e) { fail(res, 'smart learn status')(e) }
  })

  // Save the learned signature: this publishes the plan to every user
  app.post('/admin/smart-plans/:sid/signature', requireAdmin, async (req, res) => {
    try {
      const r = await getPlan(pool, req.params.sid)
      if (!r) return res.status(404).json({ error: 'Plan not found.' })
      const sig = cleanSigRaw(req.body && req.body.signature)
      if (!sig || !sig.complete) return res.status(400).json({ error: 'This signature is not complete, so it cannot be saved. Learn it again.' })
      if (sig.steps.length !== r.steps.length) return res.status(400).json({ error: 'This signature does not match the plan\'s USSD code. Learn it again.' })
      const pub = pubOf({ ...r, sig })
      await pool.query('UPDATE smart_plans SET sig=$2::jsonb, pub=$3::jsonb, rev=$4 WHERE sid=$1',
        [r.sid, JSON.stringify(sig), JSON.stringify(pub), Date.now()])
      res.json({ ok: true })
    } catch (e) { fail(res, 'smart sig save')(e) }
  })
}