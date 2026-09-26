const { setSecurityHeaders } = require('./_auth');
const { configured, sameOrigin } = require('./_http');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const seatRanges = new Set(['1-5', '6-20', '21-100', '101+']);
const plans = new Set(['team', 'enterprise']);

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  const open = process.env.PURCHASE_REQUESTS_ENABLED === 'true' && configured();
  if (req.method === 'GET') return res.status(200).json({ open });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { sameOrigin(req); }
  catch { return res.status(403).json({ error: 'This request must come from the Mashrooth website.' }); }
  if (!open) return res.status(503).json({ error: 'Purchase requests are not open yet.' });
  const value = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 2048)
    return res.status(400).json({ error: 'Check the form and try again.' });
  // A hidden field absorbs trivial automated submissions without collecting them.
  if (value.website) return res.status(202).json({ received: true });
  const contact_name = typeof value.contact_name === 'string' ? value.contact_name.trim() : '';
  const work_email = typeof value.work_email === 'string' ? value.work_email.trim().toLowerCase() : '';
  const organization_name = typeof value.organization_name === 'string' ? value.organization_name.trim() : '';
  if (contact_name.length < 2 || contact_name.length > 120 || organization_name.length < 2 || organization_name.length > 160 ||
      /[\x00-\x1f\x7f]/.test(contact_name + organization_name) || work_email.length > 254 || !EMAIL.test(work_email) ||
      !seatRanges.has(value.seat_range) || !plans.has(value.plan) || value.contact_consent !== true)
    return res.status(400).json({ error: 'Check the form and try again.' });
  try {
    const upstream = await fetch(process.env.SUPABASE_URL + '/rest/v1/workspace_purchase_requests', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ contact_name, work_email, organization_name, seat_range: value.seat_range,
        plan: value.plan, contact_consent: true }),
      signal: AbortSignal.timeout(10000),
    });
    // Do not reveal whether an email has already been used for an inquiry.
    if (upstream.ok || upstream.status === 409) return res.status(202).json({ received: true });
  } catch { /* A failure must never be presented as a successful submission. */ }
  return res.status(503).json({ error: 'Purchase requests are temporarily unavailable. Please try again later.' });
};
