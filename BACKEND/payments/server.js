require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { stkPush, stkQuery, normalizePhone } = require('./daraja');

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN?.split(',') || true }));

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---- verify the logged-in Supabase user
async function requireUser(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid session' });
  req.user = data.user;
  next();
}

app.get('/', (_, res) => res.send('AutoBingwa payments OK'));

// ---- 1. start payment
app.post('/api/mpesa/stkpush', requireUser, async (req, res) => {
  try {
    const { packageId, phone } = req.body || {};
    const msisdn = normalizePhone(phone);
    if (!msisdn) return res.status(400).json({ error: 'Enter a valid Safaricom number' });

    const { data: pkg } = await db.from('token_packages')
      .select('*').eq('id', packageId).eq('active', true).single();
    if (!pkg) return res.status(400).json({ error: 'Unknown package' });

    const { data: pay, error: insErr } = await db.from('token_payments')
      .insert({ user_id: req.user.id, package_id: pkg.id, amount: pkg.price, phone: msisdn })
      .select().single();
    if (insErr) throw insErr;

    const r = await stkPush({
      phone: msisdn, amount: pkg.price, ref: 'AutoBingwa', desc: `Tokens ${pkg.label}`.slice(0, 20),
    });

    if (r.ResponseCode !== '0') {
      await db.from('token_payments')
        .update({ status: 'failed', result_desc: r.errorMessage || r.ResponseDescription, updated_at: new Date() })
        .eq('id', pay.id);
      return res.status(502).json({ error: r.errorMessage || 'Could not send the M-Pesa prompt' });
    }

    await db.from('token_payments')
      .update({ checkout_request_id: r.CheckoutRequestID, merchant_request_id: r.MerchantRequestID })
      .eq('id', pay.id);

    res.json({ paymentId: pay.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- 2. Safaricom callback (public, secret in the URL)
app.post('/api/mpesa/callback/:secret', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });   // answer fast
  if (req.params.secret !== process.env.CALLBACK_SECRET) return;
  try {
    const cb = req.body?.Body?.stkCallback;
    if (!cb) return;
    const checkout = cb.CheckoutRequestID;

    if (Number(cb.ResultCode) === 0) {
      const items = cb.CallbackMetadata?.Item || [];
      const get = (n) => items.find((i) => i.Name === n)?.Value;
      const { data: pay } = await db.from('token_payments')
        .select('amount').eq('checkout_request_id', checkout).single();
      if (!pay || Number(get('Amount')) !== Number(pay.amount)) {
        await db.from('token_payments')
          .update({ status: 'failed', result_desc: 'Amount mismatch' })
          .eq('checkout_request_id', checkout);
        return;
      }
      await db.rpc('credit_token_payment', { p_checkout: checkout, p_receipt: get('MpesaReceiptNumber') || null });
    } else {
      await db.from('token_payments')
        .update({
          status: Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed',
          result_desc: cb.ResultDesc, updated_at: new Date(),
        })
        .eq('checkout_request_id', checkout).eq('credited', false);
    }
  } catch (e) { console.error('callback error', e); }
});

// ---- 3. app polls this
app.get('/api/mpesa/status/:id', requireUser, async (req, res) => {
  const { data: pay } = await db.from('token_payments')
    .select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!pay) return res.status(404).json({ error: 'Not found' });

  // Callback missed (e.g. Render was asleep)? Ask Safaricom directly.
  const ageSec = (Date.now() - new Date(pay.created_at).getTime()) / 1000;
  if (pay.status === 'pending' && pay.checkout_request_id && ageSec > 20) {
    try {
      const q = await stkQuery(pay.checkout_request_id);
      if (q.ResultCode !== undefined) {
        if (Number(q.ResultCode) === 0) {
          await db.rpc('credit_token_payment', { p_checkout: pay.checkout_request_id, p_receipt: null });
        } else {
          await db.from('token_payments')
            .update({
              status: Number(q.ResultCode) === 1032 ? 'cancelled' : 'failed',
              result_desc: q.ResultDesc, updated_at: new Date(),
            })
            .eq('id', pay.id).eq('credited', false);
        }
        const { data: fresh } = await db.from('token_payments').select('*').eq('id', pay.id).single();
        return res.json({ status: fresh.status, message: fresh.result_desc });
      }
    } catch (_) { /* still processing; keep polling */ }
  }
  res.json({ status: pay.status, message: pay.result_desc });
});

app.listen(process.env.PORT || 3000, () => console.log('Payments server running'));