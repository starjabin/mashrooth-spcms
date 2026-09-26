const { setSecurityHeaders } = require('./_auth');
const { configured, supabase } = require('./_http');
module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  let database = false;
  if (configured()) {
    try { database = (await supabase('/rest/v1/rpc/deployment_version', null, {method:'POST',body:'{}'})) === '20260925000100'; } catch { /* Readiness must fail closed. */ }
  }
  const ai = process.env.AI_ENABLED === 'true' && process.env.AI_DATA_PROCESSING_APPROVED === 'true' && !!process.env.ANTHROPIC_API_KEY && !!process.env.AI_MODEL;
  return res.status(database ? 200 : 503).json({application:'mashrooth-spcms',version:'1.1.0',ready:database,
    services:{database:database?'ready':'unavailable',ai:ai?'configured':'disabled'},
    features:{selfServiceRegistration:false,billing:false,emailReminders:false}});
};
