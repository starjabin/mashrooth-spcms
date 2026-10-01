const {verifySignature,stripe,adminRpc}=require('../billing.cjs');
const {UUID_RE,setSecurityHeaders}=require('../../api/_auth');
const events=new Set(['checkout.session.completed','customer.subscription.updated','customer.subscription.deleted','invoice.payment_failed','invoice.payment_succeeded']);
async function rawBody(req){
 if(Buffer.isBuffer(req.rawBody))return req.rawBody;
 // Never access req.body: a platform JSON parser can consume or transform it.
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>1048576)throw new Error('Body too large');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
async function handler(req,res){
 setSecurityHeaders(res);if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 let event;
 try{event=verifySignature(await rawBody(req),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
 catch{return res.status(400).json({error:'Invalid webhook signature or payload'});}
 if(!events.has(event.type))return res.status(200).json({received:true});
 try{
  const object=event.data.object;
  const id=event.type.startsWith('customer.subscription.')?object.id:typeof object.subscription==='string'?object.subscription:object.subscription?.id;
  if(!id)return res.status(200).json({received:true}); // Non-subscription invoices.
  const sub=await stripe('subscriptions/'+encodeURIComponent(id));
  const organization=sub.metadata?.organization_id;
  if(!UUID_RE.test(organization||'') || (event.type==='checkout.session.completed' && object.client_reference_id!==organization))throw new Error('Workspace mapping missing or inconsistent');
  const price=sub.items.data[0]?.price.id;
  const plan=price===process.env.STRIPE_PRICE_GROWTH?'Growth':price===process.env.STRIPE_PRICE_ENTERPRISE?'Enterprise':null;
  if(!plan)throw new Error('Unrecognized price');
  await adminRpc('apply_billing_event',{event_id:event.id,event_created:event.created,workspace:organization,
   snapshot:{status:sub.status,plan,price_id:price,stripe_customer:typeof sub.customer==='string'?sub.customer:sub.customer.id,
    stripe_subscription:sub.id,current_period_end:new Date(sub.current_period_end*1000).toISOString(),cancel_at_period_end:!!sub.cancel_at_period_end}});
  // ZATCA issuance is deferred. A successful-payment webhook only synchronizes billing here.
  return res.status(200).json({received:true});
 }catch(e){console.error('[billing webhook]',e.message);return res.status(500).json({error:'Webhook processing failed; retry required'});}
}
module.exports=handler;
module.exports.config={api:{bodyParser:false}};
