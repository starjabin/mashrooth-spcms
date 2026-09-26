// Shared server-side auth helper — NOT exposed as an API route (underscore prefix)
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

// Allowed origins for CORS
const ALLOWED_ORIGINS = new Set([
  ...(process.env.APP_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000','http://localhost:5173','http://localhost:4173']),
  ...(process.env.VERCEL_URL ? ['https://' + process.env.VERCEL_URL] : []),
]);

// Strict UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = ['viewer', 'manager', 'admin', 'superadmin'];

class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Membership is database controlled. Never authorize from user_metadata.
async function membershipFor(userId, token) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(userId)}&select=organization_id,role&limit=1`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AccessError(503, 'Organization access is unavailable');
  const rows = await response.json();
  const membership = rows[0];
  if (!membership || !UUID_RE.test(membership.organization_id) || !ROLES.includes(membership.role))
    throw new AccessError(403, 'An organization membership is required');
  return membership;
}

async function requireAccess(req, write = false) {
  const token = requestToken(req);
  const user = await verifyToken('Bearer ' + token);
  if (!user) throw new AccessError(401, 'Authentication required');
  const membership = await membershipFor(user.id, token);
  if (write && membership.role === 'viewer') throw new AccessError(403, 'Write permission required');
  return { user, token, organizationId: membership.organization_id, role: membership.role };
}

function cookie(req, name) {
  const part = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  try { return part ? decodeURIComponent(part.slice(name.length + 1)) : ''; } catch { return ''; }
}

function requestToken(req) {
  return extractToken(req.headers.authorization) || cookie(req, 'mashrooth_access');
}

// Extract bearer token — handles case-insensitive prefix, only strips leading "Bearer "
function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return '';
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

// Verify a Supabase JWT — returns Supabase user object or null
async function verifyToken(authHeader) {
  const token = extractToken(authHeader);
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data : null;
  } catch (_) {
    return null;
  }
}

// Set CORS headers — restrict to known origins only
function setCORS(req, res, methods = 'POST,OPTIONS') {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
}

// Set standard API security headers
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

module.exports = { verifyToken, extractToken, requestToken, cookie, setCORS, setSecurityHeaders, UUID_RE, requireAccess, membershipFor, AccessError };
