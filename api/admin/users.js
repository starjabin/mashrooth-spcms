const { requireAccess, setCORS, setSecurityHeaders, UUID_RE } = require('../_auth');
const { sameOrigin } = require('../_http');
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PERMISSIONS = {
  superadmin: ['read','write','delete','admin','superadmin'],
  admin: ['read','write','delete','admin'], manager: ['read','write','delete'], viewer: ['read'],
};
module.exports = async function handler(req, res) {
  setCORS(req, res, 'GET,PATCH,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET','PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (req.method === 'PATCH') sameOrigin(req);
    const ctx = await requireAccess(req);
    if (!['admin','superadmin'].includes(ctx.role)) return res.status(403).json({ error: 'Admin permission required' });
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' };
    if (req.method === 'GET') {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/organization_memberships?organization_id=eq.${ctx.organizationId}&select=user_id,role,display_name,email,department,created_at&order=created_at&limit=200`, { headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return res.status(502).json({ error: 'Member list unavailable' });
      const members = await response.json();
      return res.status(200).json({ users: members.map(m => ({ id: m.user_id, name: m.display_name, email: m.email, department: m.department, role: m.role, permissions: PERMISSIONS[m.role], createdAt: m.created_at })) });
    }
    const { userId, role } = req.body || {};
    if (!UUID_RE.test(userId || '') || !Object.hasOwn(PERMISSIONS, role || '')) return res.status(400).json({ error: 'Valid userId and role are required' });
    // The SQL function checks caller/target scope and hierarchy transactionally.
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_member_role`, {
      method: 'POST', headers, body: JSON.stringify({ target_user_id: userId, new_role: role }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return res.status(response.status === 403 ? 403 : 400).json({ error: 'Role change was not permitted' });
    const result = await response.json();
    return res.status(200).json({ ...result, permissions: PERMISSIONS[role] });
  } catch (err) { return res.status(err.status || 503).json({ error: err.status ? err.message : 'User management unavailable' }); }
};
