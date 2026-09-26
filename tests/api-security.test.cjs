const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_ANON_KEY = 'test-public-key';
process.env.ANTHROPIC_API_KEY = 'test-provider-key';
const org='11111111-1111-4111-8111-111111111111';
const uid='33333333-3333-4333-8333-333333333333';
const sync=require('../api/sync');
const ai=require('../api/ai/analyze');
const auth=require('../api/trpc/[path]');
const admin=require('../api/admin/users');
function mock(role='manager',failRead=false) {
  const calls=[];
  global.fetch=async (url,options={})=>{
    calls.push({url,options});
    let data=[]; let ok=true;
    if(url.includes('/auth/v1/user')) data={id:uid,email:'member@test.invalid',user_metadata:{role:'superadmin'}};
    else if(url.includes('/organization_memberships?user_id=')) data=role ? [{organization_id:org,role}] : [];
    else if(url.includes('/auth/v1/token')) data={access_token:'valid-session',user:{id:uid,email:'member@test.invalid',user_metadata:{role:'superadmin'}}};
    else if(failRead && url.includes('/rest/v1/projects')) ok=false;
    return {ok,status:ok?200:500,json:async()=>data};
  };
  return calls;
}
async function run(handler,method,body,headers={},query={}) {
  const result={};
  const res={setHeader(){},status(n){result.status=n;return this},json(data){result.data=data;return this},end(){return this}};
  await handler({method,body,headers,query},res);
  return result;
}
test('AI rejects the published proxy key without a session',async()=>{
  const calls=mock();
  assert.equal((await run(ai,'POST',{}, {'x-api-key':'mashrooth-proxy-ai-2024'})).status,401);
  assert.equal(calls.length,0);
});
test('user-editable superadmin metadata does not grant writes or admin',async()=>{
  mock('viewer');
  const headers={authorization:'Bearer valid-session'};
  assert.equal((await run(sync,'POST',{projects:[]},headers)).status,403);
  assert.equal((await run(ai,'POST',{},headers)).status,403);
  assert.equal((await run(admin,'GET',undefined,headers)).status,403);
});
test('sync sends end-user token and server-owned tenant filter',async()=>{
  const calls=mock();
  const result=await run(sync,'GET',undefined,{authorization:'Bearer valid-session'});
  assert.equal(result.status,200);
  const reads=calls.filter(c=>c.url.includes('/rest/v1/')&&!c.url.includes('organization_memberships'));
  assert.equal(reads.length,7);
  for(const c of reads){ assert.ok(c.url.includes('organization_id=eq.'+org));assert.equal(c.options.headers.Authorization,'Bearer valid-session');assert.equal(c.options.headers.apikey,'test-public-key'); }
});
test('retired full-state sync cannot overwrite tenant records',async()=>{
  const calls=mock();
  assert.equal((await run(sync,'POST',{organization_id:'other',projects:[{id:'one',name:'Project',organization_id:'other'}]},{authorization:'Bearer valid-session'})).status,410);
  assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
});
test('upstream read failure is not returned as an empty successful state',async()=>{
  mock('manager',true);
  assert.equal((await run(sync,'GET',undefined,{authorization:'Bearer valid-session'})).status,502);
});
test('unprovisioned account cannot read organization data',async()=>{
  mock(null);
  assert.equal((await run(sync,'GET',undefined,{authorization:'Bearer valid-session'})).status,403);
});
test('login reports only database membership role; public registration is closed',async()=>{
  mock('viewer');
  const result=await run(auth,'POST',{email:'member@test.invalid',password:'example-password'},{},{path:'auth.login'});
  assert.equal(result.status,200);
  assert.equal(result.data[0].result.data.json.user.role,'viewer');
  assert.equal((await run(auth,'POST',{role:'superadmin'},{},{path:'auth.register'})).status,403);
});

test('document parser checks membership, file type and expanded size',async()=>{
  const parse=require('../api/parse');
  const AdmZip=require('adm-zip');
  const headers={authorization:'Bearer valid-session'};
  mock('viewer');
  assert.equal((await run(parse,'POST',{},headers)).status,403);
  mock('manager');
  assert.equal((await run(parse,'POST',{content:'not-base64!',name:'x.docx'},headers)).status,400);
  assert.equal((await run(parse,'POST',{content:Buffer.from('plain text').toString('base64'),name:'x.exe'},headers)).status,415);
  const zip=new AdmZip();
  zip.addFile('word/document.xml',Buffer.from('<w:p><w:t>Contract notice within 28 days</w:t></w:p>'));
  const result=await run(parse,'POST',{content:zip.toBuffer().toString('base64'),name:'contract.docx'},headers);
  assert.equal(result.status,200);
  assert.match(result.data.text,/Contract notice within 28 days/);
  const large=new AdmZip();
  large.addFile('word/document.xml',Buffer.alloc(33*1024*1024,120));
  assert.equal((await run(parse,'POST',{content:large.toBuffer().toString('base64'),name:'large.docx'},headers)).status,413);
});
