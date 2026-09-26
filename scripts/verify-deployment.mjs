// Read-only checks. A zero exit code is not a production security/compliance certification.
import { lookup } from 'node:dns/promises';
const target=process.argv[2]||process.env.DEPLOYMENT_URL;
if(!target){console.error('Usage: npm run verify:deployment -- https://your-deployment.example');process.exit(1);}
const base=new URL(target);
if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw new Error('Supply an HTTP(S) application URL without credentials');
let failed=0;
async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function assert(value,message){if(!value)throw new Error(message);}
const request=p=>fetch(new URL(p,base),{redirect:'error',signal:AbortSignal.timeout(15000)});
await check('DNS or proxy reachability',async()=>{
  try { await lookup(base.hostname); }
  catch (error) {
    const proxied = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (!proxied || !['EAI_AGAIN','ENOTFOUND'].includes(error.code)) throw error;
    const response = await request('/');
    assert(response.ok,'Local DNS is unavailable and the deployment is not reachable through the configured proxy');
    console.log('Local DNS unavailable; deployment reachable through the configured proxy');
  }
});
await check('HTTPS',async()=>assert(base.protocol==='https:'||['localhost','127.0.0.1'].includes(base.hostname),'Use HTTPS for deployed environments'));
await check('Public page and security headers',async()=>{const r=await request('/');assert(r.ok,'HTTP '+r.status);assert(r.headers.get('content-type')?.includes('text/html'),'Expected HTML');assert(r.headers.get('content-security-policy')?.includes("script-src 'self'"),'Missing script policy');const html=await r.text();assert(html.includes('Private pilot'),'Expected current public page');assert(!/SCCC|PDPL-resident|self-hosted in Riyadh|14-day free trial/i.test(html),'Unsupported public claims remain');});
await check('Application login page',async()=>{const r=await request('/app');assert(r.ok,'HTTP '+r.status);assert((await r.text()).includes('/app.js'),'Expected maintained application');});
await check('Purchase inquiry page',async()=>{const r=await request('/signup');assert(r.ok,'HTTP '+r.status);assert((await r.text()).includes('purchase-form'),'Expected signup form');});
await check('JavaScript asset',async()=>{const r=await request('/app.js');assert(r.ok&&r.headers.get('content-type')?.includes('javascript'),'Asset route must return JavaScript');});
await check('Landing preview asset',async()=>{const r=await request('/landing.js');assert(r.ok&&r.headers.get('content-type')?.includes('javascript'),'Landing preview controls must be deployed');});
await check('Signup asset and intake status',async()=>{const [script,intake]=await Promise.all([request('/signup.js'),request('/api/purchase-requests')]);assert(script.ok&&script.headers.get('content-type')?.includes('javascript'),'Signup controls must be deployed');assert(intake.ok&&typeof (await intake.json()).open==='boolean','Signup availability must be explicit');});
await check('Database migration readiness',async()=>{const r=await request('/api/health');const h=await r.json();assert(r.ok&&h.ready,'Database/configuration is not ready');console.log('Features: '+JSON.stringify(h.features)+'; AI: '+h.services?.ai);});
await check('Anonymous record access rejected',async()=>{const r=await request('/api/records?collection=projects');assert(r.status===401,'Expected 401; received '+r.status);});
await check('Anonymous member access rejected',async()=>{const r=await request('/api/admin/users');assert(r.status===401,'Expected 401; received '+r.status);});
if(process.env.TEST_ACCESS_TOKEN){
  await check('Authenticated workspace read',async()=>{const r=await fetch(new URL('/api/records?collection=projects',base),{headers:{Authorization:'Bearer '+process.env.TEST_ACCESS_TOKEN},signal:AbortSignal.timeout(15000)});const data=await r.json();assert(r.ok&&Array.isArray(data.data),'Authenticated read failed');});
}else console.log('NOT TESTED: login, session refresh, two-tenant access, CRUD, parsing, AI, backup restore and provider regions require authenticated live acceptance testing.');
process.exitCode=failed?1:0;
