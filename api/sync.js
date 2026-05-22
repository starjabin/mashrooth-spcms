/**
 * api/sync.js — Supabase-backed org-level state sync
 *
 * GET  /api/sync          → returns the org's stored JSON state
 * POST /api/sync          → upserts the org's state (merges top-level keys)
 *
 * All authenticated users in the same org share one state row (id = 'main').
 * Row-level security is enforced: only authenticated Supabase users may access.
 */
const { verifyToken, setCORS, setSecurityHeaders } = require('./_auth');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const ANON_KEY         = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SECRET_KEY;

const TABLE = 'org_data';
const ROW_ID = 'main';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey:          SERVICE_ROLE_KEY,
    Authorization:  `Bearer ${SERVICE_ROLE_KEY}`,
    Prefer:         'return=representation',
  };
}

async function getOrgData() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${ROW_ID}&select=data`,
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error('Failed to read org data');
  const rows = await r.json();
  return (rows && rows[0] && rows[0].data) ? rows[0].data : {};
}

async function upsertOrgData(merged) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}`,
    {
      method: 'POST',
      headers: {
        ...sbHeaders(),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({ id: ROW_ID, data: merged, updated_at: new Date().toISOString() }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error('Failed to save org data: ' + err);
  }
  return r.json();
}

module.exports = async function handler(req, res) {
  setCORS(req, res, 'GET,POST,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SERVICE_ROLE_KEY)
    return res.status(503).json({ error: 'Cloud sync not configured — add SUPABASE_SERVICE_KEY env var' });

  const user = await verifyToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    // GET — return stored state
    if (req.method === 'GET') {
      const data = await getOrgData();
      return res.status(200).json({ data });
    }

    // POST — merge incoming state with stored state
    if (req.method === 'POST') {
      const incoming = req.body || {};

      // Only merge known safe top-level keys — reject unknown fields
      const SAFE_KEYS = [
        'projects', 'contractDocuments', 'aiFindings', 'wbsPhases',
        'lcgpaRecords', 'claims', 'grcRisks', 'complianceControls',
        'procurementItems', 'documentContents', 'crossDocumentFindings',
        'preBidClarifications', 'pipelineSteps', 'contractWorkflowStatus',
      ];

      const existing = await getOrgData();
      const merged   = { ...existing };

      for (const key of SAFE_KEYS) {
        if (!(key in incoming)) continue;

        const inc = incoming[key];
        const ex  = existing[key];

        // Arrays: merge by id, incoming items win on conflict
        if (Array.isArray(inc)) {
          const map = {};
          (ex || []).forEach(function(item) { if (item && item.id) map[item.id] = item; });
          inc.forEach(function(item) { if (item && item.id) map[item.id] = item; });
          merged[key] = Object.values(map);
        }
        // Objects (maps like contractDocuments, wbsPhases…): deep merge one level
        else if (inc && typeof inc === 'object') {
          const base = (ex && typeof ex === 'object') ? ex : {};
          const out  = { ...base };
          for (const pid of Object.keys(inc)) {
            const incArr = inc[pid];
            const exArr  = base[pid];
            if (Array.isArray(incArr)) {
              const m = {};
              (exArr || []).forEach(function(item) { if (item && item.id) m[item.id] = item; });
              incArr.forEach(function(item) { if (item && item.id) m[item.id] = item; });
              out[pid] = Object.values(m);
            } else {
              out[pid] = incArr;
            }
          }
          merged[key] = out;
        }
      }

      merged._demo  = false;
      merged._synced = new Date().toISOString();

      await upsertOrgData(merged);
      return res.status(200).json({ ok: true, synced: merged._synced });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
};
