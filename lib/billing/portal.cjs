const {setSecurityHeaders,AccessError}=require('../../api/_auth');
const {sameOrigin,fail}=require('../../api/_http');
const {billingAccess,subscription,site,stripe}=require('../billing.cjs');
module.exports=async(req,res)=>{
 setSecurityHeaders(res);if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{sameOrigin(req);const ctx=await billingAccess(req),sub=await subscription(ctx);
  if(!sub?.stripe_customer)throw new AccessError(400,'No Stripe customer exists yet');
  const portal=await stripe('billing_portal/sessions',{customer:sub.stripe_customer,return_url:site()+'/billing'});
  return res.status(200).json({url:portal.url});
 }catch(e){return fail(res,e);}
};
