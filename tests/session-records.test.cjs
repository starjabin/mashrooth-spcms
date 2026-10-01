const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.SUPABASE_URL='https://supabase.test';
process.env.SUPABASE_ANON_KEY='test-public-key';
process.env.APP_ALLOWED_ORIGINS='https://app.test';
process.env.NODE_ENV='production';
const session=require('../api/session'),records=require('../api/records'),ai=require('../api/ai/analyze');
const uid='33333333-3333-4333-8333-333333333333',org='11111111-1111-4111-8111-111111111111';
const headers={origin:'https://app.test',cookie:'mashrooth_access=test-access;mashrooth_refresh=test-refresh'};
function mock(role='manager',conflict=false){const calls=[];global.fetch=async(url,options={})=>{calls.push({url,options});let data=[];let status=200;
 if(url.includes('/auth/v1/token'))data={access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:uid,email:'tester@example.test'}};
 else if(url.includes('/auth/v1/user'))data={id:uid,email:'tester@example.test'};
 else if(url.includes('/subscriptions?'))data=[{status:'trialing',plan:'Growth',trial_ends_at:new Date(Date.now()+86400000).toISOString()}];
 else if(url.includes('organization_memberships'))data=role?[{organization_id:org,role}]:[];
 else if(url.includes('/organizations?'))data=[{id:org,name:'Test Org'}];
 else if(url.includes('/rpc/mutate_record')){data=conflict?{code:'PT409'}:{id:'record1',version:2};if(conflict)status=409;}
 return {ok:status<400,status,json:async()=>data};};return calls;}
async function run(handler,method,body,query={},h=headers){const result={headers:{}};const res={setHeader(k,v){result.headers[k]=v;},status(n){result.status=n;return this;},json(v){result.data=v;return this;},end(){}};await handler({method,body,query,headers:h},res);return result;}
test('session tokens are HttpOnly Secure cookies and absent from login JSON',async()=>{
 mock();const r=await run(session,'POST',{action:'login',email:'tester@example.test',password:'test-only-password'});
 assert.equal(r.status,200);assert.equal(r.data.user.organizationId,org);assert.equal(JSON.stringify(r.data).includes('test-access'),false);
 assert.equal(r.headers['Set-Cookie'].length,2);for(const c of r.headers['Set-Cookie']){assert.match(c,/HttpOnly/);assert.match(c,/SameSite=Strict/);assert.match(c,/Secure/);}
});
test('cross-origin cookie mutations fail before any upstream request',async()=>{
 const calls=mock();const evil={...headers,origin:'https://evil.test'};
 assert.equal((await run(session,'POST',{action:'login'}, {},evil)).status,403);
 assert.equal((await run(records,'POST',{id:'new',values:{name:'Bad'}},{collection:'projects'},evil)).status,403);
 assert.equal(calls.length,0);
 assert.equal((await run(records,'POST',{}, {collection:'projects'}, {cookie:headers.cookie})).status,403);
});
test('refresh checks current membership and session endpoints reject anonymous requests',async()=>{
 mock(null);assert.equal((await run(session,'POST',{action:'refresh'})).status,403);
 mock();assert.equal((await run(session,'GET',undefined,{},{})).status,401);
});
test('record writes validate schema and propagate optimistic conflicts',async()=>{
 const calls=mock();
 assert.equal((await run(records,'POST',{id:'new',values:{name:'Project',organization_id:'forged'}},{collection:'projects'})).status,400);
 assert.equal((await run(records,'POST',{id:'new',values:{name:'Project',end_date:'2026-02-30'}},{collection:'projects'})).status,400);
 assert.equal((await run(records,'PATCH',{id:'new',values:{name:'Project'}},{collection:'projects'})).status,428);
 assert.equal(calls.some(c=>c.url.includes('/rpc/mutate_record')),false);
 mock('manager',true);assert.equal((await run(records,'PATCH',{id:'new',version:1,values:{name:'Project'}},{collection:'projects'})).status,409);
 mock('viewer');assert.equal((await run(records,'DELETE',{id:'new',version:1},{collection:'projects'})).status,403);
});
test('record reads are tenant-filtered and exclude internal row columns',async()=>{
 const calls=mock();assert.equal((await run(records,'GET',null,{collection:'contracts'})).status,200);
 const read=calls.find(c=>c.url.includes('/rest/v1/contracts'));
 assert.match(read.url,new RegExp('organization_id=eq.'+org));assert.match(read.url,/limit=51/);assert.ok(!read.url.includes('select=*'));
 assert.equal(read.options.headers.Authorization,'Bearer test-access');
});
test('AI does not transmit contract text before data-processing approval',async()=>{
 const calls=mock();delete process.env.AI_DATA_PROCESSING_APPROVED;
 process.env.AI_ENABLED='true';process.env.ANTHROPIC_API_KEY='test-key';process.env.AI_MODEL='configured-test-model';
 assert.equal((await run(ai,'POST',{messages:[{role:'user',content:'private contract'}]})).status,503);
 assert.equal(calls.some(c=>c.url.includes('anthropic.com')),false);
});
