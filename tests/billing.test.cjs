const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {entitled,verifySignature}=require('../api/_billing');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',u='33333333-3333-4333-8333-333333333333';
test('trial expiry and paid-period checks fail closed',()=>{
 const now=Date.now(),future=new Date(now+10000).toISOString(),past=new Date(now-10000).toISOString();
 assert.equal(entitled(null,now),false);
 assert.equal(entitled({status:'trialing',trial_ends_at:past},now),false);
 assert.equal(entitled({status:'trialing',trial_ends_at:future},now),true);
 assert.equal(entitled({status:'past_due',trial_ends_at:future,current_period_end:future,plan:'Enterprise'},now),false);
 assert.equal(entitled({status:'active',plan:'Growth',current_period_end:future},now),true);
 assert.equal(entitled({status:'canceled',plan:'Growth',current_period_end:future},now),false);
 assert.equal(entitled({status:'active',plan:'Growth',current_period_end:past},now),false);
});
test('webhook validates unmodified body, timestamp and multiple signature candidates',()=>{
 const now=1770000000,raw=Buffer.from('{"id":"evt_test"}'),secret='whsec_test';
 const sig=crypto.createHmac('sha256',secret).update(now+'.').update(raw).digest('hex');
 assert.equal(verifySignature(raw,`t=${now},v1=${'0'.repeat(64)},v1=${sig}`,secret,now).id,'evt_test');
 assert.throws(()=>verifySignature(Buffer.from('{}'),`t=${now},v1=${sig}`,secret,now));
 assert.throws(()=>verifySignature(raw,`t=${now},v1=${sig}`,secret,now+301));
 assert.throws(()=>verifySignature(raw,`t=${now},v1=x`,secret,now));
});
test('Postgres billing: RLS, expired direct access, service-only writes, event retries and bootstrap',async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   GRANT USAGE ON SCHEMA auth TO authenticated;`);
  for(const f of ['supabase/schema.sql','supabase/migrations/20260522180000_normalize_tables.sql','supabase/migrations/20260924000100_tenant_isolation.sql','supabase/migrations/20260925000100_release_controls.sql','supabase/migrations/20260926000100_security_grants_indexes.sql','supabase/migrations/20261001162012_paid_trial.sql'])await db.exec(readFileSync(f,'utf8'));
  await db.exec(`INSERT INTO organizations(id,name) VALUES('${a}','A'),('${b}','B'); INSERT INTO auth.users VALUES('${u}',now()); INSERT INTO organization_memberships(user_id,organization_id,role) VALUES('${u}','${a}','admin'); INSERT INTO projects(id,name,organization_id) VALUES('one','Private project','${a}');`);
  async function asUser(fn){await db.exec('BEGIN');try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[u]);await db.exec('SET LOCAL ROLE authenticated');const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}
  await asUser(async()=>{assert.equal((await db.query('SELECT * FROM subscriptions')).rows.length,1);assert.equal((await db.query('SELECT * FROM projects')).rows.length,1);});
  await assert.rejects(asUser(()=>db.query("UPDATE subscriptions SET plan='Enterprise'")),/permission denied/);
  await assert.rejects(asUser(()=>db.query("SELECT apply_billing_event('evt_bad',1,$1,'{}')",[a])),/permission denied/);
  await db.query("UPDATE subscriptions SET trial_ends_at=now()-interval '1 day' WHERE organization_id=$1",[a]);
  await asUser(async()=>{assert.equal((await db.query('SELECT * FROM projects')).rows.length,0);assert.equal((await db.query('SELECT * FROM subscriptions')).rows.length,1);});
  await assert.rejects(asUser(()=>db.query("SELECT mutate_record('projects','create','two',null,'{\"name\":\"Two\"}')")),/Subscription required/);
  await assert.rejects(asUser(()=>db.query("SELECT consume_service_quota('ai')")),/Subscription required/);
  const snapshot={status:'active',plan:'Enterprise',price_id:'price_ent',stripe_customer:'cus_test',stripe_subscription:'sub_test',current_period_end:new Date(Date.now()+86400000).toISOString(),cancel_at_period_end:true};
  const apply=(event,created,s)=>db.query('SELECT apply_billing_event($1,$2,$3,$4) AS applied',[event,created,a,JSON.stringify(s)]);
  assert.equal((await apply('evt_10',10,snapshot)).rows[0].applied,true);
  assert.equal((await apply('evt_10',10,snapshot)).rows[0].applied,false);
  await apply('evt_old',9,{...snapshot,status:'past_due'});
  assert.equal((await db.query('SELECT status FROM subscriptions WHERE organization_id=$1',[a])).rows[0].status,'active');
  await asUser(async()=>assert.equal((await db.query('SELECT * FROM projects')).rows.length,1));
  await apply('evt_cancel',11,{...snapshot,status:'canceled'});
  await asUser(async()=>assert.equal((await db.query('SELECT * FROM projects')).rows.length,0));
  // A malformed write rolls back event recording, allowing a corrected retry.
  await assert.rejects(apply('evt_retry',12,{...snapshot,status:'invalid'}));
  assert.equal((await apply('evt_retry',12,snapshot)).rows[0].applied,true);
  assert.equal((await asUser(()=>db.query("SELECT ensure_trial_workspace('Ignored new name') AS id"))).rows[0].id,a);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,2);
 }finally{await db.close();}
});

test('Checkout and portal use membership mapping without entitlement writes; webhook failures retry',async()=>{
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_ANON_KEY='anon';process.env.SUPABASE_SERVICE_ROLE_KEY='service';process.env.STRIPE_SECRET_KEY='sk_test_example';process.env.STRIPE_WEBHOOK_SECRET='whsec_test';process.env.STRIPE_PRICE_GROWTH='price_growth';process.env.STRIPE_PRICE_ENTERPRISE='price_enterprise';process.env.NEXT_PUBLIC_SITE_URL='https://app.test';process.env.APP_ALLOWED_ORIGINS='https://app.test';
 // Reload modules whose public auth configuration is captured at load time.
 for(const p of ['../api/_auth','../api/_http','../api/_billing'])delete require.cache[require.resolve(p)];
 const checkout=require('../api/billing/checkout'),portal=require('../api/billing/portal'),webhook=require('../api/billing/webhook');
 let role='admin',hasCustomer=false,failWrite=false;const calls=[];
 global.fetch=async(url,opts={})=>{calls.push({url,opts});let d=[];
  if(url.includes('/auth/v1/user'))d={id:u,email:'test@example.test'};
  else if(url.includes('organization_memberships'))d=[{organization_id:a,role}];
  else if(url.includes('/subscriptions?'))d=[{status:'trialing',plan:'Growth',trial_ends_at:new Date(Date.now()+86400000).toISOString(),...(hasCustomer?{stripe_customer:'cus_test'}:{})}];
  else if(url.includes('checkout/sessions'))d={url:'https://checkout.stripe.com/test'};
  else if(url.includes('billing_portal/sessions'))d={url:'https://billing.stripe.com/test'};
  else if(url.includes('api.stripe.com/v1/subscriptions'))d={id:'sub_test',status:'active',metadata:{organization_id:a},customer:'cus_test',items:{data:[{price:{id:'price_growth'}}]},current_period_end:Math.floor(Date.now()/1000)+86400};
  return {ok:!failWrite||!url.includes('apply_billing_event'),status:failWrite?500:200,json:async()=>d};};
 async function run(fn,body,extra={}){const out={};await fn({method:'POST',body,headers:{origin:'https://app.test',authorization:'Bearer token'},...extra},{setHeader(){},status(n){out.status=n;return this;},json(d){out.data=d;return this;}});return out;}
 assert.equal((await run(checkout,{tier:'growth',organization_id:b})).status,200);
 const created=calls.find(c=>c.url.includes('checkout/sessions'));assert.equal(new URLSearchParams(created.opts.body).get('client_reference_id'),a);
 assert.equal(calls.some(c=>c.url.includes('apply_billing_event')),false);
 assert.equal((await run(checkout,{tier:'free'})).status,400);
 role='viewer';assert.equal((await run(checkout,{tier:'growth'})).status,403);role='admin';
 assert.equal((await run(portal,{})).status,400);hasCustomer=true;assert.equal((await run(portal,{})).status,200);
 const ts=Math.floor(Date.now()/1000),event={id:'evt_real',created:ts,type:'checkout.session.completed',data:{object:{client_reference_id:a,subscription:'sub_test'}}};const raw=Buffer.from(JSON.stringify(event));const sig=crypto.createHmac('sha256','whsec_test').update(ts+'.').update(raw).digest('hex');
 const extra={rawBody:raw,headers:{'stripe-signature':`t=${ts},v1=${sig}`}};
 failWrite=true;assert.equal((await run(webhook,null,extra)).status,500);failWrite=false;
 assert.equal((await run(webhook,null,extra)).status,200);
 assert.equal((await run(webhook,null,{rawBody:raw,headers:{'stripe-signature':'invalid'}})).status,400);
});
