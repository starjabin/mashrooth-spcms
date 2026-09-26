const { AccessError } = require('./_auth');

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    if (req.headers.cookie || req.headers['sec-fetch-site'] === 'cross-site')
      throw new AccessError(403, 'Origin is required');
    return; // Authenticated command-line API clients have no browser cookies.
  }
  const allowed = new Set((process.env.APP_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
  if (process.env.VERCEL_URL) allowed.add('https://' + process.env.VERCEL_URL);
  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
  }
  if (!allowed.has(origin)) throw new AccessError(403, 'Origin is not allowed');
}

async function supabase(path, token, options = {}) {
  if (!configured()) throw new AccessError(503, 'Application services are not configured');
  const r = await fetch(process.env.SUPABASE_URL + path, {
    ...options,
    headers: { apikey: process.env.SUPABASE_ANON_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(10000),
  });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const code = data?.code;
    const status = code === 'PT409' || code === '23505' ? 409 : code === 'PT404' ? 404 : code === '42501' ? 403 : code === 'PT429' ? 429 : (['23503','23514','23502','22023','22P02','PT400'].includes(code) ? 400 : (r.status === 401 || r.status === 403 || r.status === 429 ? r.status : 502));
    const messages = {409:'This record changed or already exists. Reload before saving.',404:'Record not found.',403:'This action is not permitted.',429:'Request limit reached. Please try again later.',400:'Invalid record or linked record. Check the values and try again.',401:'Session expired. Please sign in again.',502:'Database service is unavailable or migrations are incomplete.'};
    throw new AccessError(status, messages[status]);
  }
  return data;
}

function objectBody(req, limit = 1000000) {
  const value = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccessError(400, 'A JSON object is required');
  if (Buffer.byteLength(JSON.stringify(value)) > limit) throw new AccessError(413, 'Request is too large');
  return value;
}

function fail(res, error) {
  return res.status(error.status || 503).json({ error: error.status ? error.message : 'Service temporarily unavailable. Please try again.' });
}
module.exports = { configured, sameOrigin, supabase, objectBody, fail };
