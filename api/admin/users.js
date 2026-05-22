const { verifyToken, setCORS, setSecurityHeaders, UUID_RE } = require('../_auth');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const ANON_KEY         = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SECRET_KEY;

const ROLE_PERMISSIONS = {
  superadmin: ['read', 'write', 'delete', 'admin', 'superadmin'],
  admin:      ['read', 'write', 'delete', 'admin'],
  manager:    ['read', 'write', 'delete'],
  viewer:     ['read'],
};
const VALID_ROLES = Object.keys(ROLE_PERMISSIONS);
const ROLE_RANK   = { viewer: 0, manager: 1, admin: 2, superadmin: 3 };

module.exports = async function handler(req, res) {
  setCORS(req, res, 'GET,PATCH,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify caller identity
  const callerUser = await verifyToken(req.headers.authorization);
  if (!callerUser) return res.status(401).json({ error: 'Unauthorized' });

  const callerRole = callerUser.user_metadata?.role || 'viewer';
  const callerRank = ROLE_RANK[callerRole] || 0;

  if (!['admin', 'superadmin'].includes(callerRole))
    return res.status(403).json({ error: 'Admin permission required' });

  try {
    // ── GET — list users ───────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (!SERVICE_ROLE_KEY)
        return res.status(503).json({ error: 'User management not configured' });

      const listResp = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`,
        { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
      );
      if (!listResp.ok) return res.status(502).json({ error: 'Failed to fetch users' });
      const listData = await listResp.json();

      const users = (listData.users || []).map(u => ({
        id:          u.id,
        email:       u.email,
        name:        u.user_metadata?.name || u.email.split('@')[0],
        role:        VALID_ROLES.includes(u.user_metadata?.role) ? u.user_metadata.role : 'viewer',
        department:  u.user_metadata?.department || 'General',
        permissions: ROLE_PERMISSIONS[u.user_metadata?.role] || ROLE_PERMISSIONS.viewer,
        lastSignIn:  u.last_sign_in_at,
        createdAt:   u.created_at,
      }));

      return res.status(200).json({ users });
    }

    // ── PATCH — update user role ───────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { userId, role } = req.body || {};

      // Validate inputs
      if (!userId || !role)
        return res.status(400).json({ error: 'userId and role required' });
      if (!UUID_RE.test(userId))
        return res.status(400).json({ error: 'Invalid userId format' });
      if (!VALID_ROLES.includes(role))
        return res.status(400).json({ error: 'Invalid role' });
      if (!SERVICE_ROLE_KEY)
        return res.status(503).json({ error: 'User management not configured' });

      // Prevent self-demotion/modification
      if (userId === callerUser.id)
        return res.status(403).json({ error: 'Cannot modify your own role' });

      // Privilege escalation guard: cannot assign a role above your own rank
      const targetRank = ROLE_RANK[role] || 0;
      if (targetRank > callerRank)
        return res.status(403).json({ error: 'Cannot assign a role above your own level' });

      const upResp = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
        {
          method: 'PUT',
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_metadata: { role } }),
        }
      );

      if (!upResp.ok)
        return res.status(upResp.status).json({ error: 'Role update failed' });

      const upData = await upResp.json();
      return res.status(200).json({
        id:          upData.id,
        role,
        permissions: ROLE_PERMISSIONS[role],
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (_) {
    return res.status(500).json({ error: 'An internal error occurred' });
  }
};
