const BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

let cache = { token: null, exp: 0 };

async function getToken() {
  if (cache.token && Date.now() < cache.exp) return cache.token;
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');
  const r = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!r.ok) throw new Error(`Daraja auth failed (${r.status})`);
  const j = await r.json();
  cache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) - 60) * 1000 };
  return cache.token;
}

function timestamp() {
  // Nairobi time (UTC+3), format YYYYMMDDHHmmss
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function password(ts) {
  return Buffer.from(
    process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + ts
  ).toString('base64');
}

function normalizePhone(p) {
  const s = String(p).replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(s)) return '254' + s.slice(1);
  if (/^254[17]\d{8}$/.test(s)) return s;
  if (/^[17]\d{8}$/.test(s)) return '254' + s;
  return null;
}

async function stkPush({ phone, amount, ref, desc }) {
  const ts = timestamp();
  const body = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,       // store / head office number
    Password: password(ts),
    Timestamp: ts,
    TransactionType: process.env.MPESA_TX_TYPE || 'CustomerBuyGoodsOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: process.env.MPESA_TILL,                        // your till number
    PhoneNumber: phone,
    CallBackURL: `${process.env.PUBLIC_URL}/api/mpesa/callback/${process.env.CALLBACK_SECRET}`,
    AccountReference: ref,
    TransactionDesc: desc,
  };
  const r = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function stkQuery(checkoutRequestId) {
  const ts = timestamp();
  const r = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  return r.json();
}

module.exports = { stkPush, stkQuery, normalizePhone };