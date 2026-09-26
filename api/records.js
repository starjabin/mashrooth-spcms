const schema = require('../web/schema.json');
const { requireAccess, setSecurityHeaders, AccessError } = require('./_auth');
const { sameOrigin, supabase, objectBody, fail } = require('./_http');

function validate(collection, input, create) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccessError(400, 'Record values must be an object');
  const fields = schema[collection].fields;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(fields, key)) throw new AccessError(400, 'Unknown record field: ' + key);
    const [, , type, required] = fields[key];
    if (value === null || value === '') {
      if (required) throw new AccessError(400, 'Required field: ' + key);
      if (['number','percent','integer','score'].includes(type)) continue;
      out[key] = key === 'project_id' || type === 'date' ? null : '';
      continue;
    }
    if (Array.isArray(type)) {
      if (!type.includes(value)) throw new AccessError(400, 'Invalid selection: ' + key);
    } else if (['number','percent','integer','score'].includes(type)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e14 ||
          (type === 'percent' && value > 100) || (type === 'score' && (value < 1 || value > 5 || !Number.isInteger(value))) ||
          (type === 'integer' && !Number.isInteger(value))) throw new AccessError(400, 'Invalid number: ' + key);
    } else {
      if (typeof value !== 'string' || value.length > (type === 'document' ? 750000 : type === 'textarea' ? 10000 : 500)) throw new AccessError(400, 'Invalid text: ' + key);
      if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new AccessError(400, 'Invalid date: ' + key);
    }
    out[key] = value;
  }
  if (create) for (const [key, value] of Object.entries(fields)) {
    if (value[3] && !Object.hasOwn(out, key)) throw new AccessError(400, 'Required field: ' + key);
  }
  return out;
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  if (!['GET','POST','PATCH','DELETE'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
  try {
    const write = req.method !== 'GET';
    if (write) sameOrigin(req);
    const ctx = await requireAccess(req, write);
    const collection = req.query.collection;
    if (!Object.hasOwn(schema, collection || '')) throw new AccessError(400, 'Unknown collection');
    if (!write) {
      const cursor = req.query.cursor || '';
      if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new AccessError(400, 'Invalid cursor');
      const select = ['id','row_id','version','created_at','updated_at',...Object.keys(schema[collection].fields)].filter((v,i,a)=>a.indexOf(v)===i);
      let path = `/rest/v1/${collection}?organization_id=eq.${ctx.organizationId}&select=${select.join(',')}&order=row_id&limit=51`;
      if (cursor) path += '&row_id=gt.' + cursor;
      const rows = await supabase(path, ctx.token);
      const data = rows.slice(0,50);
      return res.status(200).json({data, nextCursor: rows.length > 50 ? data.at(-1).row_id : null});
    }
    const body = objectBody(req);
    const id = body.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(id)) throw new AccessError(400, 'Invalid record ID');
    const create = req.method === 'POST';
    if (!create && (!Number.isSafeInteger(body.version) || body.version < 1)) throw new AccessError(428, 'A current record version is required');
    const values = req.method === 'DELETE' ? {} : validate(collection, body.values || {}, create);
    const row = await supabase('/rest/v1/rpc/mutate_record', ctx.token, {method:'POST',body:JSON.stringify({
      collection_name:collection, operation:create?'create':req.method==='DELETE'?'delete':'update', record_id:id,
      expected_version:create?null:body.version, record_values:values,
    })});
    return res.status(create ? 201 : 200).json({data:row});
  } catch (e) { return fail(res, e); }
};
module.exports.validate = validate;
