const { membershipFor, extractToken, setCORS, setSecurityHeaders } = require('../_auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

const ROLE_PERMISSIONS = {
  superadmin: ['read', 'write', 'delete', 'admin', 'superadmin'],
  admin:      ['read', 'write', 'delete', 'admin'],
  manager:    ['read', 'write', 'delete'],
  viewer:     ['read'],
};
const VALID_ROLES = Object.keys(ROLE_PERMISSIONS);
const ROLE_RANK   = { viewer: 0, manager: 1, admin: 2, superadmin: 3 };

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;
}

// tRPC batch response helpers
function ok(data)  { return [{ result: { data: { json: data } } }]; }
function fail(msg) { return [{ error: { json: { message: msg, code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } } } }]; }
function failBad(msg) { return [{ error: { json: { message: msg, code: -32001, data: { code: 'BAD_REQUEST', httpStatus: 400 } } } }]; }

// Email regex (basic but effective)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Supabase auth call — never exposes raw tokens in error messages
async function supabaseAuth(path, options = {}, userToken = null) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: ANON_KEY,
    ...options.headers,
  };
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, data: await res.json() };
}

function mapUser(u, membership) {
  const meta = u.user_metadata || {};
  const role = membership.role;
  return {
    id:          u.id,
    organizationId: membership.organization_id,
    name:        meta.name || (u.email || '').split('@')[0],
    email:       u.email,
    role,
    department:  meta.department || 'General',
    permissions: permissionsFor(role),
  };
}

module.exports = async function handler(req, res) {
  setCORS(req, res, 'GET,POST,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const procedure = req.query.path;

  try {
    // ── LOGIN ──────────────────────────────────────────────────────────────
    if (procedure === 'auth.login' && req.method === 'POST') {
      const input = req.body?.['0']?.json || req.body || {};
      const { email, password } = input;

      if (!email || !password)
        return res.status(400).json(failBad('Email and password required'));
      if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email))
        return res.status(400).json(failBad('Invalid email format'));
      if (typeof password !== 'string' || password.length < 1 || password.length > 1024)
        return res.status(400).json(failBad('Password required'));

      const { status, data } = await supabaseAuth('/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
      });

      if (!data.access_token)
        return res.status(401).json(fail('Invalid email or password'));

      return res.status(200).json(ok({ token: data.access_token, user: mapUser(data.user, await membershipFor(data.user.id, data.access_token)) }));
    }

    // ── SESSION VALIDATION ─────────────────────────────────────────────────
    if (procedure === 'auth.me' && req.method === 'GET') {
      const token = extractToken(req.headers.authorization || '');
      if (!token) return res.status(401).json(fail('Unauthorized'));

      const { status, data } = await supabaseAuth('/user', {}, token);
      if (status !== 200 || !data.id)
        return res.status(401).json(fail('Session expired. Please log in again.'));

      return res.status(200).json(ok(mapUser(data, await membershipFor(data.id, token))));
    }

    // Account provisioning must use a verified organization invitation workflow.
    // Do not provision roles or membership from browser registration fields.
    if (procedure === 'auth.register' && req.method === 'POST') {
      return res.status(403).json(failBad('Registration requires an organization invitation. Contact your administrator.'));
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (err) {
    if (err.status) return res.status(err.status).json(fail(err.message));
    return res.status(500).json(fail('An internal error occurred. Please try again.'));
  }
};
