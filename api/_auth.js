// Shared server-side auth helper — NOT exposed as an API route (underscore prefix)
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

// Allowed origins for CORS
const ALLOWED_ORIGINS = new Set([
  'https://patchedapp.vercel.app',
  'https://mashrooth.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
]);

// Strict UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

module.exports = { verifyToken, extractToken, setCORS, setSecurityHeaders, UUID_RE };
