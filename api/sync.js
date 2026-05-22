/**
 * api/sync.js — Normalized Supabase sync
 *
 * GET  /api/sync  → reads all entity tables, returns the same JSON shape the frontend expects
 * POST /api/sync  → upserts each entity type into its own Supabase table
 *
 * Tables: projects, contracts, grc_risks, lcgpa_records, claims, document_contents
 * Blob (org_data): wbsPhases, pipelineSteps, contractWorkflowStatus, aiFindings,
 *                  complianceControls, crossDocumentFindings, preBidClarifications
 */
const { verifyToken, setCORS, setSecurityHeaders } = require('./_auth');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SECRET_KEY;

// Keys kept in the org_data JSON blob (complex nested structures)
const BLOB_KEYS = [
  'wbsPhases', 'pipelineSteps', 'contractWorkflowStatus',
  'aiFindings', 'complianceControls', 'procurementItems',
  'crossDocumentFindings', 'preBidClarifications',
];

// ── Supabase REST helpers ─────────────────────────────────────────────────────

function hdrs(extra) {
  return Object.assign({
    'Content-Type': 'application/json',
    apikey: SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
  }, extra || {});
}

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: hdrs() });
  if (!r.ok) throw new Error('GET ' + path + ' [' + r.status + ']: ' + await r.text());
  return r.json();
}

async function sbUpsert(table, rows) {
  if (!rows || !rows.length) return;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: hdrs({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error('UPSERT ' + table + ' [' + r.status + ']: ' + await r.text());
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function projToRow(p) {
  return {
    id: p.id, name: p.name,
    status: p.status || 'active',
    budget: parseFloat(p.budget) || 0,
    start_date: p.startDate || null,
    end_date: p.endDate || null,
    client: p.client || '',
    contractor: p.contractor || '',
    location: p.location || '',
    description: p.description || '',
    local_content_target: parseFloat(p.localContentTarget) || 0,
    completion_pct: parseFloat(p.completionPct) || 0,
    updated_at: new Date().toISOString(),
  };
}
function rowToProj(r) {
  return {
    id: r.id, name: r.name, status: r.status,
    budget: r.budget,
    startDate: r.start_date, endDate: r.end_date,
    client: r.client, contractor: r.contractor,
    location: r.location, description: r.description,
    localContentTarget: r.local_content_target,
    completionPct: r.completion_pct,
    createdAt: r.created_at,
  };
}

function contractToRow(c) {
  return {
    id: c.id,
    project_id: c.projectId || '__unlinked',
    title: c.title, type: c.type || 'Contract', status: c.status || 'active',
    value: parseFloat(c.value) || 0,
    signed_date: c.signedDate || null,
    expiry_date: c.expiryDate || null,
    parties: Array.isArray(c.parties) ? c.parties : [],
    retention_pct: parseFloat(c.retentionPct) || 0,
    notes: c.notes || '',
    has_text: !!c.has_text,
    updated_at: new Date().toISOString(),
  };
}
function rowToContract(r) {
  return {
    id: r.id, projectId: r.project_id,
    title: r.title, type: r.type, status: r.status,
    value: r.value,
    signedDate: r.signed_date, expiryDate: r.expiry_date,
    parties: r.parties || [],
    retentionPct: r.retention_pct,
    notes: r.notes, has_text: r.has_text,
    createdAt: r.created_at,
  };
}

function riskToRow(r) {
  var l = parseInt(r.likelihood) || 1, i = parseInt(r.impact) || 1;
  return {
    id: r.id, project_id: r.projectId || null,
    title: r.title, category: r.category || 'Operational',
    likelihood: l, impact: i,
    risk_score: parseInt(r.riskScore) || l * i,
    status: r.status || 'open',
    owner: r.owner || '', mitigation: r.mitigation || '',
    due_date: r.dueDate || null, regulation: r.regulation || '',
    updated_at: new Date().toISOString(),
  };
}
function rowToRisk(r) {
  return {
    id: r.id, projectId: r.project_id,
    title: r.title, category: r.category,
    likelihood: r.likelihood, impact: r.impact, riskScore: r.risk_score,
    status: r.status, owner: r.owner, mitigation: r.mitigation,
    dueDate: r.due_date, regulation: r.regulation,
    createdAt: r.created_at,
  };
}

function lcToRow(item, pid) {
  var tv = parseFloat(item.totalValue) || 0;
  var lv = parseFloat(item.localValue) || 0;
  return {
    id: item.id,
    project_id: pid || item.projectId || '__unlinked',
    category: item.category || 'Labor',
    item_name: item.itemName,
    total_value: tv, local_value: lv,
    local_content_pct: parseFloat(item.localContentPct) || (tv > 0 ? Math.round((lv / tv) * 1000) / 10 : 0),
    supplier: item.supplier || '', period: item.period || '',
    certificate: item.certificate || '', notes: item.notes || '',
    updated_at: new Date().toISOString(),
  };
}
function rowToLC(r) {
  return {
    id: r.id, projectId: r.project_id,
    category: r.category, itemName: r.item_name,
    totalValue: r.total_value, localValue: r.local_value,
    localContentPct: r.local_content_pct,
    supplier: r.supplier, period: r.period,
    certificate: r.certificate, notes: r.notes,
    createdAt: r.created_at,
  };
}

function claimToRow(c) {
  return {
    id: c.id, project_id: c.projectId || null,
    title: c.title, type: c.type || 'EOT',
    amount: parseFloat(c.amount) || 0,
    status: c.status || 'draft',
    submitted_date: c.submittedDate || null,
    clauze: c.clauze || '', claimant: c.claimant || '',
    description: c.description || '',
    days_requested: parseInt(c.daysRequested) || 0,
    updated_at: new Date().toISOString(),
  };
}
function rowToClaim(r) {
  return {
    id: r.id, projectId: r.project_id,
    title: r.title, type: r.type,
    amount: r.amount, status: r.status,
    submittedDate: r.submitted_date,
    clauze: r.clauze, claimant: r.claimant,
    description: r.description,
    daysRequested: r.days_requested,
    createdAt: r.created_at,
  };
}

// ── Blob helpers ──────────────────────────────────────────────────────────────

async function getBlob() {
  var rows = await sbGet('org_data?id=eq.main&select=data').catch(function() { return []; });
  return (rows[0] && rows[0].data) ? rows[0].data : {};
}

async function upsertBlob(data) {
  await sbUpsert('org_data', [{ id: 'main', data: data, updated_at: new Date().toISOString() }]);
}

// ── GET — assemble all tables into one response object ───────────────────────

async function handleGet() {
  var results = await Promise.all([
    sbGet('projects?select=*&order=created_at').catch(function() { return []; }),
    sbGet('contracts?select=*&order=created_at').catch(function() { return []; }),
    sbGet('grc_risks?select=*&order=created_at').catch(function() { return []; }),
    sbGet('lcgpa_records?select=*&order=created_at').catch(function() { return []; }),
    sbGet('claims?select=*&order=created_at').catch(function() { return []; }),
    sbGet('document_contents?select=*&order=created_at').catch(function() { return []; }),
    getBlob(),
  ]);

  var projects   = results[0];
  var contracts  = results[1];
  var risks      = results[2];
  var lcRows     = results[3];
  var claimRows  = results[4];
  var docRows    = results[5];
  var blob       = results[6];

  // Re-nest contracts → { projectId: [doc, ...] }
  var contractDocuments = {};
  contracts.forEach(function(r) {
    var pid = r.project_id || '__unlinked';
    if (!contractDocuments[pid]) contractDocuments[pid] = [];
    contractDocuments[pid].push(rowToContract(r));
  });

  // Re-nest lcgpa_records → { projectId: [record, ...] }
  var lcgpaRecords = {};
  lcRows.forEach(function(r) {
    var pid = r.project_id || '__unlinked';
    if (!lcgpaRecords[pid]) lcgpaRecords[pid] = [];
    lcgpaRecords[pid].push(rowToLC(r));
  });

  // Flatten document_contents → { id: text }
  var documentContents = {};
  docRows.forEach(function(r) { documentContents[r.id] = r.content; });

  return {
    projects:            projects.map(rowToProj),
    contractDocuments:   contractDocuments,
    grcRisks:            risks.map(rowToRisk),
    lcgpaRecords:        lcgpaRecords,
    claims:              claimRows.map(rowToClaim),
    documentContents:    documentContents,
    wbsPhases:           blob.wbsPhases           || {},
    pipelineSteps:       blob.pipelineSteps        || {},
    contractWorkflowStatus: blob.contractWorkflowStatus || {},
    aiFindings:          blob.aiFindings           || [],
    complianceControls:  blob.complianceControls   || [],
    procurementItems:    blob.procurementItems     || [],
    crossDocumentFindings: blob.crossDocumentFindings || [],
    preBidClarifications: blob.preBidClarifications || [],
    _demo:   false,
    _synced: new Date().toISOString(),
  };
}

// ── POST — upsert each entity to its table ───────────────────────────────────

async function handlePost(incoming) {
  var now = new Date().toISOString();
  var ops = [];

  // projects — flat array
  if (Array.isArray(incoming.projects)) {
    var projRows = incoming.projects
      .filter(function(p) { return p && p.id && p.name; })
      .map(projToRow);
    ops.push(sbUpsert('projects', projRows));
  }

  // contractDocuments — { projectId: [doc, ...] }
  if (incoming.contractDocuments && typeof incoming.contractDocuments === 'object') {
    var contractRows = [];
    Object.keys(incoming.contractDocuments).forEach(function(pid) {
      var docs = incoming.contractDocuments[pid];
      if (!Array.isArray(docs)) return;
      docs.forEach(function(doc) {
        if (doc && doc.id && doc.title)
          contractRows.push(contractToRow(Object.assign({}, doc, { projectId: pid })));
      });
    });
    ops.push(sbUpsert('contracts', contractRows));
  }

  // grcRisks — flat array
  if (Array.isArray(incoming.grcRisks)) {
    var riskRows = incoming.grcRisks
      .filter(function(r) { return r && r.id && r.title; })
      .map(riskToRow);
    ops.push(sbUpsert('grc_risks', riskRows));
  }

  // lcgpaRecords — { projectId: [record, ...] }
  if (incoming.lcgpaRecords && typeof incoming.lcgpaRecords === 'object') {
    var lcRows = [];
    Object.keys(incoming.lcgpaRecords).forEach(function(pid) {
      var items = incoming.lcgpaRecords[pid];
      if (!Array.isArray(items)) return;
      items.forEach(function(item) {
        if (item && item.id && item.itemName) lcRows.push(lcToRow(item, pid));
      });
    });
    ops.push(sbUpsert('lcgpa_records', lcRows));
  }

  // claims — flat array
  if (Array.isArray(incoming.claims)) {
    var claimRows = incoming.claims
      .filter(function(c) { return c && c.id && c.title; })
      .map(claimToRow);
    ops.push(sbUpsert('claims', claimRows));
  }

  // documentContents — { docId: text }
  if (incoming.documentContents && typeof incoming.documentContents === 'object') {
    var docRows = [];
    Object.keys(incoming.documentContents).forEach(function(id) {
      var content = incoming.documentContents[id];
      if (id && content && typeof content === 'string')
        docRows.push({ id: id, content: content, updated_at: now });
    });
    ops.push(sbUpsert('document_contents', docRows));
  }

  // Blob keys — merge into org_data
  var blobUpdate = {};
  BLOB_KEYS.forEach(function(key) {
    if (key in incoming) blobUpdate[key] = incoming[key];
  });
  if (Object.keys(blobUpdate).length) {
    ops.push(
      getBlob().then(function(existing) {
        return upsertBlob(Object.assign({}, existing, blobUpdate));
      })
    );
  }

  await Promise.all(ops);
  return now;
}

// ── Vercel handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCORS(req, res, 'GET,POST,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SERVICE_ROLE_KEY)
    return res.status(503).json({ error: 'Cloud sync not configured — add SUPABASE_SERVICE_KEY env var' });

  var user = await verifyToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    if (req.method === 'GET') {
      var data = await handleGet();
      return res.status(200).json({ data: data });
    }

    if (req.method === 'POST') {
      var synced = await handlePost(req.body || {});
      return res.status(200).json({ ok: true, synced: synced });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[sync]', err.message);
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
};
