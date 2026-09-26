const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_ANON_KEY = 'test-publishable-key';
process.env.PURCHASE_REQUESTS_ENABLED = 'true';
const handler = require('../api/purchase-requests');
const valid = { contact_name:'Ada Lovelace',work_email:'ADA@example.com',organization_name:'Example Projects',seat_range:'6-20',plan:'team',contact_consent:true };
async function submit(body, origin='http://localhost:3000') {
  const result = {};
  const res = {setHeader(){},status(n){result.status=n;return this},json(value){result.body=value;return this}};
  await handler({method:'POST',headers:{origin},body},res);
  return result;
}

test('purchase request writes only permitted contact fields and never grants account access',async()=>{
  const calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:201}};
  const r=await submit({...valid,role:'superadmin',status:'active',organization_id:'another-tenant'});
  assert.equal(r.status,202);
  const sent=JSON.parse(calls[0].options.body);
  assert.deepEqual(sent,{contact_name:valid.contact_name,work_email:'ada@example.com',organization_name:valid.organization_name,seat_range:'6-20',plan:'team',contact_consent:true});
  assert.equal(calls[0].options.headers.apikey,'test-publishable-key');
  assert.equal(calls[0].options.headers.Prefer,'return=minimal');
});

test('invalid or cross-origin requests are rejected before reaching the database',async()=>{
  let count=0;global.fetch=async()=>{count++;return {ok:true,status:201}};
  assert.equal((await submit(valid,'https://another.example')).status,403);
  assert.equal((await submit({...valid,contact_consent:false})).status,400);
  assert.equal((await submit({...valid,plan:'unlimited-free-access'})).status,400);
  assert.equal(count,0);
});

test('duplicate emails are indistinguishable and database failures never appear successful',async()=>{
  global.fetch=async()=>({ok:false,status:409});
  assert.equal((await submit(valid)).status,202);
  global.fetch=async()=>({ok:false,status:500});
  assert.equal((await submit(valid)).status,503);
});
test('purchase inquiries remain closed until explicitly enabled',async()=>{
  process.env.PURCHASE_REQUESTS_ENABLED='false';
  try { assert.equal((await submit(valid)).status,503); }
  finally { process.env.PURCHASE_REQUESTS_ENABLED='true'; }
});
