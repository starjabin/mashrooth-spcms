const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const ids = {a:'11111111-1111-4111-8111-111111111111', b:'22222222-2222-4222-8222-222222222222', admin:'33333333-3333-4333-8333-333333333333', viewer:'44444444-4444-4444-8444-444444444444', other:'55555555-5555-4555-8555-555555555555'};

test('real PostgreSQL policies isolate tenants and role changes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;`);
    for (const file of ['supabase/schema.sql','supabase/migrations/20260522180000_normalize_tables.sql','supabase/migrations/20260924000100_tenant_isolation.sql','supabase/migrations/20260926000100_security_grants_indexes.sql']) {
      await db.exec(readFileSync(file,'utf8'));
    }
    assert.equal((await db.query("SELECT has_function_privilege('anon','public.set_member_role(uuid,text)','execute') AS allowed")).rows[0].allowed,false);
    await db.exec(`INSERT INTO organizations(id,name) VALUES('${ids.a}','A'),('${ids.b}','B');
      INSERT INTO auth.users VALUES('${ids.admin}'),('${ids.viewer}'),('${ids.other}');
      INSERT INTO organization_memberships(user_id,organization_id,role) VALUES
      ('${ids.admin}','${ids.a}','admin'),('${ids.viewer}','${ids.a}','viewer'),('${ids.other}','${ids.b}','admin');
      INSERT INTO projects(id,name,organization_id) VALUES('shared-id','A project','${ids.a}'),('shared-id','B project','${ids.b}');`);
    async function asUser(id, fn) {
      await db.exec('BEGIN');
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id]);
        await db.exec('SET LOCAL ROLE authenticated');
        const result = await fn();
        await db.exec('COMMIT');
        return result;
      } catch(e) { await db.exec('ROLLBACK'); throw e; }
    }
    await asUser(ids.viewer, async () => {
      assert.deepEqual((await db.query('SELECT name FROM projects')).rows,[{name:'A project'}]);
      assert.equal((await db.query('SELECT * FROM org_data')).rows.length,0, 'legacy main blob is quarantined');
      assert.equal((await db.query('SELECT * FROM organization_memberships')).rows.length,1);
      assert.equal((await db.query("UPDATE projects SET name='bad' RETURNING id")).rows.length,0);
    });
    await assert.rejects(asUser(ids.viewer,()=>db.query(`INSERT INTO projects(id,name,organization_id) VALUES('new','bad','${ids.a}')`)),/row-level security/i);
    await assert.rejects(asUser(ids.admin,()=>db.query(`INSERT INTO projects(id,name,organization_id) VALUES('new','bad','${ids.b}')`)),/row-level security/i);
    await assert.rejects(asUser(ids.admin,()=>db.query(`UPDATE organization_memberships SET role='superadmin' WHERE user_id='${ids.admin}'`)),/permission denied/i);
    await assert.rejects(asUser(ids.admin,()=>db.query('SELECT set_member_role($1,$2)',[ids.other,'viewer'])),/denied/i);
    await assert.rejects(asUser(ids.admin,()=>db.query('SELECT set_member_role($1,$2)',[ids.viewer,'admin'])),/denied/i);
    await assert.rejects(asUser(ids.admin,()=>db.query('SELECT set_member_role($1,$2)',[ids.admin,'viewer'])),/denied/i);
    await asUser(ids.admin,()=>db.query('SELECT set_member_role($1,$2)',[ids.viewer,'manager']));
    await asUser(ids.viewer,async()=>{
      await db.query(`INSERT INTO projects(id,name,organization_id) VALUES('new','allowed','${ids.a}')`);
    });
    assert.equal((await db.query('SELECT * FROM member_role_audit')).rows.length,1);
    await db.query('DELETE FROM organization_memberships WHERE user_id=$1',[ids.viewer]);
    await asUser(ids.viewer,async()=> assert.equal((await db.query('SELECT * FROM projects')).rows.length,0));
  } finally { await db.close(); }
});
