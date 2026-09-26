const { requireAccess, setSecurityHeaders, AccessError } = require('./_auth');
const { supabase, fail } = require('./_http');
module.exports=async function(req,res){
  setSecurityHeaders(res);
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{const ctx=await requireAccess(req);if(!['admin','superadmin'].includes(ctx.role))throw new AccessError(403,'Administrator access required');
    const data=await supabase(`/rest/v1/activity_audit?organization_id=eq.${ctx.organizationId}&select=id,actor_id,action,collection_name,record_id,record_version,created_at&order=created_at.desc&limit=100`,ctx.token);
    return res.status(200).json({data});}catch(e){return fail(res,e);}
};
