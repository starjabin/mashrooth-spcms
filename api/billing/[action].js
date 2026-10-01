// One Vercel function keeps the billing release within the Hobby deployment limit.
const handlers={checkout:require('../../lib/billing/checkout.cjs'),portal:require('../../lib/billing/portal.cjs'),status:require('../../lib/billing/status.cjs'),webhook:require('../../lib/billing/webhook.cjs')};
async function handler(req,res){
 const action=req.query?.action;
 if(!Object.hasOwn(handlers,action||''))return res.status(404).json({error:'Unknown billing route'});
 // Never access the webhook body before signature verification.
 if(action!=='webhook'&&req.method==='POST'&&req.body===undefined){
  const chunks=[];let size=0;try{for await(const chunk of req){size+=chunk.length;if(size>5000)return res.status(413).json({error:'Request too large'});chunks.push(Buffer.from(chunk));}req.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return res.status(400).json({error:'Invalid JSON'});}
 }
 return handlers[action](req,res);
}
module.exports=handler;
module.exports.config={api:{bodyParser:false}};
