const { verifyToken, extractToken, setCORS, setSecurityHeaders } = require('../_auth');

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
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, { ...options, headers });
  return { status: res.status, data: await res.json() };
}

function mapUser(u) {
  const meta = u.user_metadata || {};
  const role = VALID_ROLES.includes(meta.role) ? meta.role : 'viewer';
  return {
    id:          u.id,
    name:        meta.name || u.email.split('@')[0],
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
      if (!EMAIL_RE.test(email))
        return res.status(400).json(failBad('Invalid email format'));
      if (typeof password !== 'string' || password.length < 1)
        return res.status(400).json(failBad('Password required'));

      const { status, data } = await supabaseAuth('/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
      });

      if (!data.access_token)
        return res.status(401).json(fail('Invalid email or password'));

      return res.status(200).json(ok({ token: data.access_token, user: mapUser(data.user) }));
    }

    // ── SESSION VALIDATION ─────────────────────────────────────────────────
    if (procedure === 'auth.me' && req.method === 'GET') {
      const token = extractToken(req.headers.authorization || '');
      if (!token) return res.status(401).json(fail('Unauthorized'));

      const { status, data } = await supabaseAuth('/user', {}, token);
      if (status !== 200 || !data.id)
        return res.status(401).json(fail('Session expired. Please log in again.'));

      return res.status(200).json(ok(mapUser(data)));
    }

    // ── REGISTER ───────────────────────────────────────────────────────────
    if (procedure === 'auth.register' && req.method === 'POST') {
      const input = req.body?.['0']?.json || req.body || {};
      const { name, email, password, role: requestedRole, department } = input;

      // Input validation
      if (!email || !password)
        return res.status(400).json(failBad('Email and password required'));
      if (!EMAIL_RE.test(email))
        return res.status(400).json(failBad('Invalid email format'));
      if (typeof password !== 'string' || password.length < 8)
        return res.status(400).json(failBad('Password must be at least 8 characters'));

      // ── SECURITY: Role assignment ─────────────────────────────────────────
      // Self-registration ALWAYS gets viewer. Only authenticated admins can
      // assign higher roles, and only up to (not exceeding) their own level.
      let assignedRole = 'viewer';

      const callerToken = extractToken(req.headers.authorization || '');
      if (callerToken) {
        const callerUser = await verifyToken(req.headers.authorization);
        if (callerUser) {
          const callerRole = callerUser.user_metadata?.role || 'viewer';
          const callerRank = ROLE_RANK[callerRole] || 0;
          const requestedRank = ROLE_RANK[requestedRole] || 0;
          // Admin can assign roles, but never above their own rank
          if (['admin', 'superadmin'].includes(callerRole) &&
              VALID_ROLES.includes(requestedRole) &&
              requestedRank <= callerRank) {
            assignedRole = requestedRole;
          }
        }
      }

      const { status, data } = await supabaseAuth('/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          password,
          data: {
            name:       name || email.split('@')[0],
            role:       assignedRole,
            department: department || 'General',
          },
        }),
      });

      if (data.error || !data.user)
        return res.status(400).json(failBad('Registration failed. Email may already be in use.'));

      return res.status(200).json(ok({
        token: data.access_token || '',
        user:  mapUser(data.user),
      }));
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (_) {
    return res.status(500).json(fail('An internal error occurred. Please try again.'));
  }
};
