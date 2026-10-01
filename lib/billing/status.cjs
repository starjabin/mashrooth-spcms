const {requireAccess,setSecurityHeaders}=require('../../api/_auth');
const {fail}=require('../../api/_http');
const {subscription,entitled}=require('../billing.cjs');
module.exports=async(req,res)=>{
 setSecurityHeaders(res);if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{const ctx=await requireAccess(req,false,true),s=await subscription(ctx);
  return res.status(200).json({entitled:entitled(s),plan:s?.plan,status:s?.status||'missing',trialEndsAt:s?.trial_ends_at,
   periodEnd:s?.current_period_end,cancelAtPeriodEnd:s?.cancel_at_period_end,
   canManage:['admin','superadmin'].includes(ctx.role),hasCustomer:!!s?.stripe_customer});
 }catch(e){return fail(res,e);}
};
