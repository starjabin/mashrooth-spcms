const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('versioned records enforce tenant ownership, concurrency, references, quotas and audit in PostgreSQL',async()=>{
 const db=new PGlite();
 const orgA='11111111-1111-4111-8111-111111111111',orgB='22222222-2222-4222-8222-222222222222';
 const manager='33333333-3333-4333-8333-333333333333',viewer='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
 try{
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;`);
  for(const f of ['supabase/schema.sql',...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>'supabase/migrations/'+f)])await db.exec(fs.readFileSync(f,'utf8'));
  await db.exec(`INSERT INTO organizations(id,name) VALUES('${orgA}','A'),('${orgB}','B');
    INSERT INTO auth.users VALUES('${manager}'),('${viewer}'),('${other}');
    INSERT INTO organization_memberships(user_id,organization_id,role) VALUES('${manager}','${orgA}','admin'),('${viewer}','${orgA}','viewer'),('${other}','${orgB}','manager');`);
  async function asUser(id,fn){await db.exec('BEGIN');try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id]);await db.exec('SET LOCAL ROLE authenticated');const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}
  const mutate=(table,op,id,version,values={})=>db.query('SELECT public.mutate_record($1,$2,$3,$4,$5) AS data',[table,op,id,version,JSON.stringify(values)]);
  await asUser(manager,()=>mutate('projects','create','project1',null,{name:'First',budget:100}));
  await asUser(other,()=>mutate('projects','create','project1',null,{name:'Other tenant'}));
  await assert.rejects(asUser(viewer,()=>mutate('projects','create','denied',null,{name:'bad'})),/permission/i);
  await assert.rejects(asUser(manager,()=>mutate('projects','update','project1',1,{organization_id:orgB})),/field/i);
  await assert.rejects(asUser(manager,()=>db.exec(`INSERT INTO projects(id,name,organization_id) VALUES('direct','bypass','${orgA}')`)),/permission/i);
  const updated=await asUser(manager,()=>mutate('projects','update','project1',1,{name:'Saved'}));
  assert.equal(updated.rows[0].data.version,2);
  await assert.rejects(asUser(manager,()=>mutate('projects','update','project1',1,{name:'Lost update'})),/changed/i);
  await assert.rejects(asUser(manager,()=>mutate('contracts','create','c1',null,{title:'Contract',project_id:'foreign-project'})),/Project not found/i);
  await asUser(manager,()=>mutate('contracts','create','c1',null,{title:'Contract',project_id:'project1',value:900}));
  await assert.rejects(asUser(manager,()=>mutate('projects','delete','project1',2)),/linked/i);
  await asUser(manager,()=>mutate('lcgpa_records','create','lc1',null,{item_name:'Steel',total_value:100,local_value:40}));
  await assert.rejects(asUser(manager,()=>mutate('lcgpa_records','update','lc1',1,{local_value:200})),/Local exceeds/i);
  await asUser(manager,()=>mutate('obligations','create','o1',null,{title:'Notice',due_date:'2026-09-20',source_reference:'Contract A, section 2'}));
  await asUser(manager,()=>mutate('procurement_items','create','p1',null,{title:'Package'}));
  await asUser(manager,()=>mutate('document_contents','create','doc1',null,{content:'Confidential text'}));
  await asUser(viewer,async()=>{
    assert.deepEqual((await db.query('SELECT name FROM projects')).rows,[{name:'Saved'}]);
    assert.equal((await db.query('SELECT workspace_summary() AS data')).rows[0].data.contractValue,900);
    assert.equal((await db.query('SELECT * FROM activity_audit')).rows.length,0);
  });
  await asUser(other,async()=>{assert.equal((await db.query('SELECT workspace_summary() AS data')).rows[0].data.contractValue,0);assert.equal((await db.query('SELECT * FROM document_contents')).rows.length,0);});
  const audits=(await asUser(manager,()=>db.query('SELECT * FROM activity_audit'))).rows;
  assert.equal(audits.length,7);assert.ok(!JSON.stringify(audits).includes('Confidential text'));
  await asUser(manager,()=>mutate('contracts','delete','c1',1));
  await asUser(manager,()=>mutate('projects','delete','project1',2));
  await asUser(manager,()=>db.exec("SELECT consume_service_quota('ai') FROM generate_series(1,100)"));
  await assert.rejects(asUser(manager,()=>db.exec("SELECT consume_service_quota('ai')")),/quota/i);
  await asUser(other,()=>db.exec("SELECT consume_service_quota('ai')"));
  await db.query('DELETE FROM organization_memberships WHERE user_id=$1',[manager]);
  await assert.rejects(asUser(manager,()=>mutate('projects','create','blocked',null,{name:'After offboarding'})),/Membership/i);
 }finally{await db.close();}
});
