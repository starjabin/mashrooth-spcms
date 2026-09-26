const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
test('local server serves real assets, protects source files and reports missing services',async()=>{
 const port=33000+Math.floor(Math.random()*10000);
 const server=spawn(process.execPath,['scripts/dev.cjs'],{env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_ANON_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});
  const base='http://127.0.0.1:'+port;
  const home=await fetch(base);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);
  const landing=await home.text();assert.match(landing,/Private pilot/);assert.doesNotMatch(landing,/SCCC|PDPL-resident|self-hosted in Riyadh|14-day free trial/i);
  assert.match(landing,/src="\/landing.js"/);
  const landingJs=await fetch(base+'/landing.js');assert.equal(landingJs.status,200);assert.match(landingJs.headers.get('content-type'),/javascript/);
  const signup=await fetch(base+'/signup');assert.equal(signup.status,200);assert.match(await signup.text(),/Sign up for a workspace/);
  assert.equal((await fetch(base+'/signup.js')).status,200);
  const inquiry=await fetch(base+'/api/purchase-requests',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000'},body:JSON.stringify({contact_name:'Test Person',work_email:'test@example.com',organization_name:'Example',seat_range:'1-5',plan:'team',contact_consent:true})});
  assert.equal(inquiry.status,503);assert.equal((await inquiry.json()).received,undefined);
  const app=await fetch(base+'/app');assert.equal(app.status,200);assert.match(await app.text(),/src="\/app.js"/);
  const js=await fetch(base+'/app.js');assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
  assert.equal((await fetch(base+'/supabase/schema.sql')).status,404);
  assert.equal((await fetch(base+'/.env.local')).status,404);
  const health=await fetch(base+'/api/health');assert.equal(health.status,503);assert.equal((await health.json()).ready,false);
  assert.equal((await fetch(base+'/api/records?collection=projects')).status,401);
 }finally{server.kill();}
});
