const { setSecurityHeaders, AccessError }=require('../../api/_auth');
const { sameOrigin,objectBody,fail }=require('../../api/_http');
const { billingAccess,subscription,site,stripe }=require('../billing.cjs');
module.exports=async(req,res)=>{
 setSecurityHeaders(res);
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  sameOrigin(req);const ctx=await billingAccess(req);const {tier}=objectBody(req,1000);
  const price={growth:process.env.STRIPE_PRICE_GROWTH,enterprise:process.env.STRIPE_PRICE_ENTERPRISE}[tier];
  if(!['growth','enterprise'].includes(tier))throw new AccessError(400,'Choose Growth or Enterprise');
  if(!price?.startsWith('price_'))throw new AccessError(503,'This plan is not configured');
  const sub=await subscription(ctx);
  if(sub?.stripe_subscription && !['canceled','incomplete_expired'].includes(sub.status))throw new AccessError(409,'Manage your existing subscription in the billing portal');
  const form={mode:'subscription','line_items[0][price]':price,'line_items[0][quantity]':'1',client_reference_id:ctx.organizationId,
   'subscription_data[metadata][organization_id]':ctx.organizationId,'metadata[organization_id]':ctx.organizationId,
   success_url:site()+'/billing?checkout=success',cancel_url:site()+'/billing?checkout=cancelled',
   'billing_address_collection':'required','tax_id_collection[enabled]':'true'};
  if(sub?.stripe_customer)form.customer=sub.stripe_customer;else form.customer_email=ctx.user.email;
  // Repeated clicks within this window reuse the same session. No entitlement write here.
  const session=await stripe('checkout/sessions',form,`checkout-${ctx.organizationId}-${tier}-${Math.floor(Date.now()/1800000)}`);
  return res.status(200).json({url:session.url});
 }catch(e){return fail(res,e);}
};
