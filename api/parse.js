const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { requireAccess, setSecurityHeaders, AccessError } = require('./_auth');
const { sameOrigin, supabase, objectBody, fail } = require('./_http');
function parse(content, extension) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(path.join(__dirname,'../lib/parser-worker.cjs'),{workerData:{content,extension},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    const timer = setTimeout(()=>{worker.terminate();reject(new AccessError(422,'Document parsing timed out'));},8000);
    worker.once('message',data=>{clearTimeout(timer);worker.terminate();data.error?reject(new AccessError(data.status,data.error)):resolve(data.text);});
    worker.once('error',()=>{clearTimeout(timer);worker.terminate();reject(new AccessError(422,'Document could not be parsed safely'));});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new AccessError(422,'Document parsing stopped'));});
  });
}
module.exports = async function handler(req,res) {
  setSecurityHeaders(res);
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try {
    sameOrigin(req);
    const ctx = await requireAccess(req,true);
    const {content,name} = objectBody(req,4100000);
    if (typeof content!=='string' || !content || content.length%4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new AccessError(400,'Invalid base64 file content');
    if(content.length>4000000) throw new AccessError(413,'Maximum file size is 3 MB');
    if(typeof name!=='string' || name.length>255) throw new AccessError(400,'A valid filename is required');
    const extension=name.split('.').pop().toLowerCase();
    if(!['pdf','docx','txt'].includes(extension)) throw new AccessError(415,'Use PDF, DOCX or plain text');
    await supabase('/rest/v1/rpc/consume_service_quota',ctx.token,{method:'POST',body:JSON.stringify({service_name:'parse'})});
    const text=await parse(content,extension);
    return res.status(200).json({text,chars:text.length,name});
  } catch(e) {return fail(res,e);}
};
