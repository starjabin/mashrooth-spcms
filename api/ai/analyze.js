const { verifyToken, setCORS, setSecurityHeaders } = require('../_auth');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// The proxy key baked into the patched React bundle — prevents unauthenticated direct calls
const PROXY_KEY = 'mashrooth-proxy-ai-2024';

// Allowlisted Claude models — prevents billing surprises from arbitrary model requests
const ALLOWED_MODELS = new Set([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
  'claude-3-opus-20240229',
]);

// Hard cap on tokens per request — prevents runaway cost
const MAX_TOKENS_CAP = 4096;

module.exports = async function handler(req, res) {
  setCORS(req, res, 'POST,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!ANTHROPIC_API_KEY)
    return res.status(503).json({ error: 'AI service not configured' });

  // ── Auth: require proxy key (set in the React bundle) ─────────────────────
  // This prevents external callers who don't know the patched key from using the endpoint.
  const proxyKey = req.headers['x-api-key'] || '';
  if (proxyKey !== PROXY_KEY) {
    // Also allow requests that carry a valid Supabase session token
    const user = await verifyToken(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const { model, max_tokens, messages } = req.body || {};

  if (!model || typeof model !== 'string')
    return res.status(400).json({ error: 'model is required' });
  if (!ALLOWED_MODELS.has(model))
    return res.status(400).json({ error: 'Requested model is not permitted' });
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  if (messages.length > 50)
    return res.status(400).json({ error: 'Too many messages in request' });

  // Cap max_tokens — never let the caller exceed the limit
  const cappedTokens = Math.min(Math.max(parseInt(max_tokens) || 1024, 1), MAX_TOKENS_CAP);

  // Validate message structure — each message must have role + string content
  for (const m of messages) {
    if (!m || !['user', 'assistant'].includes(m.role))
      return res.status(400).json({ error: 'Invalid message role' });
    if (typeof m.content !== 'string' && !Array.isArray(m.content))
      return res.status(400).json({ error: 'Invalid message content' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: cappedTokens, messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Forward Anthropic error status but sanitize the message
      const msg = data?.error?.message || 'AI service error';
      return res.status(response.status).json({ error: msg });
    }

    return res.status(200).json(data);
  } catch (_) {
    return res.status(500).json({ error: 'AI service temporarily unavailable' });
  }
};
