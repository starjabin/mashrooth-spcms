const crypto = require('node:crypto');
const { AccessError, requireAccess } = require('../api/_auth');
const { supabase } = require('../api/_http');
function entitled(s, now = Date.now()) {
  if (!s) return false;
  if (s.status === 'trialing') return Number.isFinite(Date.parse(s.trial_ends_at)) && now < Date.parse(s.trial_ends_at);
  return s.status === 'active' && ['Growth','Enterprise'].includes(s.plan) && now < Date.parse(s.current_period_end);
}
async function subscription(ctx) {
  const rows = await supabase(`/rest/v1/subscriptions?organization_id=eq.${ctx.organizationId}&select=plan,status,trial_ends_at,current_period_end,cancel_at_period_end,stripe_customer,stripe_subscription`, ctx.token);
  return rows?.[0] || null;
}
async function billingAccess(req) {
  const ctx = await requireAccess(req, false, true);
  if (!['admin','superadmin'].includes(ctx.role)) throw new AccessError(403, 'Workspace administrator required');
  return ctx;
}
function site() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || '');
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new AccessError(503, 'Billing site is not configured');
  return url.origin;
}
async function stripe(path, form, key) {
  if (!process.env.STRIPE_SECRET_KEY) throw new AccessError(503, 'Stripe is not configured');
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: form ? 'POST' : 'GET', headers: { Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,
      'Stripe-Version':'2024-06-20', ...(form ? {'Content-Type':'application/x-www-form-urlencoded'} : {}), ...(key ? {'Idempotency-Key':key} : {}) },
    ...(form ? {body:new URLSearchParams(form).toString()} : {}), signal:AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new AccessError(502, 'Stripe billing is temporarily unavailable');
  return data;
}
async function adminRpc(name, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AccessError(503, 'Webhook database credentials are not configured');
  const r = await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/'+name, {method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if (!r.ok) throw new Error('Billing persistence failed');
  return r.json();
}
function verifySignature(raw, header, secret, now = Math.floor(Date.now()/1000)) {
  if (!secret || !Buffer.isBuffer(raw) || typeof header !== 'string') throw new Error('Invalid signature');
  const parts = header.split(',').map(p=>p.split('='));
  const ts = parts.find(p=>p[0]==='t')?.[1];
  if (!/^\d+$/.test(ts || '') || Math.abs(now-Number(ts))>300) throw new Error('Expired signature');
  const expected=crypto.createHmac('sha256',secret).update(ts+'.').update(raw).digest();
  if (!parts.some(([k,v])=>k==='v1' && /^[a-f0-9]{64}$/i.test(v || '') && crypto.timingSafeEqual(expected,Buffer.from(v,'hex')))) throw new Error('Invalid signature');
  return JSON.parse(raw.toString('utf8'));
}
module.exports={entitled,subscription,billingAccess,site,stripe,adminRpc,verifySignature};
