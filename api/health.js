const { setSecurityHeaders } = require('./_auth');
const { configured, supabase } = require('./_http');
module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  let database = false;
  if (configured()) {
    try { database = (await supabase('/rest/v1/rpc/deployment_version', null, {method:'POST',body:'{}'})) === '20261001162012'; } catch { /* Readiness must fail closed. */ }
  }
  const ai = process.env.AI_ENABLED === 'true' && process.env.AI_DATA_PROCESSING_APPROVED === 'true' && !!process.env.ANTHROPIC_API_KEY && !!process.env.AI_MODEL;
  return res.status(database ? 200 : 503).json({application:'mashrooth-spcms',version:'1.1.0',ready:database,
    services:{database:database?'ready':'unavailable',ai:ai?'configured':'disabled'},
    features:{selfServiceRegistration:database,billing:database && !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRICE_GROWTH && process.env.STRIPE_PRICE_ENTERPRISE && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SITE_URL),emailReminders:false}});
};
