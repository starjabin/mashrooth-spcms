const { requireAccess, setSecurityHeaders } = require('./_auth');
const { supabase, fail } = require('./_http');
module.exports=async function(req,res){
  setSecurityHeaders(res);
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{const ctx=await requireAccess(req);const data=await supabase('/rest/v1/rpc/workspace_summary',ctx.token,{method:'POST',body:'{}'});return res.status(200).json(data);}
  catch(e){return fail(res,e);}
};
