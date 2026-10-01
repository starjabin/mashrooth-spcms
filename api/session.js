const { cookie, requestToken, verifyToken, membershipFor, AccessError, setSecurityHeaders } = require('./_auth');
const { configured, sameOrigin, supabase, objectBody, fail } = require('./_http');

function cookies(res, data) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  const opts = '; HttpOnly; SameSite=Strict; Path=/' + secure;
  res.setHeader('Set-Cookie', [
    `mashrooth_access=${encodeURIComponent(data?.access_token || '')}; Max-Age=${data ? Math.min(data.expires_in || 3600, 3600) : 0}${opts}`,
    `mashrooth_refresh=${encodeURIComponent(data?.refresh_token || '')}; Max-Age=${data?.refresh_token ? 604800 : 0}${opts}`,
  ]);
}
async function profile(user, token) {
  const m = await membershipFor(user.id, token);
  const orgs = await supabase(`/rest/v1/organizations?id=eq.${m.organization_id}&select=id,name`, token);
  return { id: user.id, email: user.email, name: user.user_metadata?.name || user.email,
    organizationId: m.organization_id, organization: orgs[0]?.name || '', role: m.role };
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
  try {
    if (!configured()) throw new AccessError(503, 'Application services are not configured');
    if (req.method === 'GET') {
      const token = requestToken(req);
      const user = await verifyToken('Bearer ' + token);
      if (!user) throw new AccessError(401, 'Please sign in');
      return res.status(200).json({user: await profile(user, token)});
    }
    sameOrigin(req);
    const {action, email, password} = objectBody(req, 5000);
    if (action === 'logout') {
      const token = requestToken(req);
      try { if (token) await supabase('/auth/v1/logout?scope=local', token, {method:'POST'}); }
      finally { cookies(res, null); }
      return res.status(200).json({ok:true});
    }
    if (action === 'refresh') {
      const refresh = cookie(req, 'mashrooth_refresh');
      if (!refresh) throw new AccessError(401, 'Please sign in');
      let data;
      try { data = await supabase('/auth/v1/token?grant_type=refresh_token', null, {method:'POST', body:JSON.stringify({refresh_token:refresh})}); }
      catch (e) { cookies(res, null); throw new AccessError(e.status === 429 ? 429 : 401, 'Please sign in again'); }
      // Validate membership again before allowing the rotated session to proceed.
      const user = await profile(data.user, data.access_token);
      cookies(res, data);
      return res.status(200).json({user});
    }
    if (action === 'register') {
      const body = req.body;
      if (typeof email !== 'string' || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length<12 || password.length>1024 || typeof body.workspaceName !== 'string' || body.workspaceName.trim().length<2 || body.workspaceName.length>160) throw new AccessError(400,'Enter a work email, workspace name and password of at least 12 characters');
      await supabase('/auth/v1/signup', null, {method:'POST',body:JSON.stringify({email:email.trim().toLowerCase(),password,data:{workspace_name:body.workspaceName.trim()}})});
      return res.status(200).json({message:'Check your email to confirm your account, then sign in. Your 14-day trial starts after confirmation.'});
    }
    if (action !== 'login') throw new AccessError(400, 'Unknown session action');
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || !password || password.length > 1024) throw new AccessError(400, 'Enter your email and password');
    let data;
    try { data = await supabase('/auth/v1/token?grant_type=password', null, {method:'POST', body:JSON.stringify({email:email.trim().toLowerCase(),password})}); }
    catch (e) { throw new AccessError(e.status === 429 ? 429 : 401, e.status === 429 ? 'Too many sign-in attempts. Please wait.' : 'Invalid email or password'); }
    if (!data?.access_token || !data.user?.id) throw new AccessError(401, 'Invalid email or password');
    await supabase('/rest/v1/rpc/ensure_trial_workspace', data.access_token, {method:'POST',body:JSON.stringify({workspace_name:data.user.user_metadata?.workspace_name || 'My workspace'})});
    const user = await profile(data.user, data.access_token);
    cookies(res, data);
    return res.status(200).json({user});
  } catch (e) { return fail(res, e); }
};
