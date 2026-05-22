/*!
 * Mashrooth SPCMS — Dashboard Modules v2
 * Features: Pagination, per-row doc upload/download, in-memory filter+sort
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  var SK        = 'mashrooth_crud_v1';
  var AK        = 'mashrooth_auth_v1';
  var PID       = 'ms-panel';
  var OID       = 'ms-overlay';
  var BID       = 'ms-fab';
  var PAGE_SIZE = 15;

  var activeTab    = 'projects';
  var csvParsed    = {};
  var docQueue     = [];
  var sortDir      = {};
  var activeSortK  = {};
  var pageState    = {};
  var filterState  = {};

  /* ── Auth ──────────────────────────────────────────────────────────────── */
  function getUser() {
    var keys = [AK, 'mashrooth_token', 'mashrooth_user', 'ma', 'Ts'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = sessionStorage.getItem(keys[i]);
        if (!raw) continue;
        var p = JSON.parse(raw);
        if (p && p.user && p.user.id) return p.user;
        if (p && p.id && p.role)      return p;
      } catch(e) {}
    }
    return null;
  }
  function isLoggedIn()  { return !!getUser(); }
  function can(perm)     { var u=getUser(); return u && (u.permissions||[]).indexOf(perm)!==-1; }
  function canWrite()    { return can('write'); }
  function isAdmin()     { return can('admin'); }
  function getToken() {
    var ssKeys = [AK, 'mashrooth_token', 'mashrooth_user', 'ma', 'Ts'];
    for (var i = 0; i < ssKeys.length; i++) {
      try {
        var raw = sessionStorage.getItem(ssKeys[i]);
        if (!raw) continue;
        var p = JSON.parse(raw);
        if (p && typeof p.token === 'string' && p.token.length > 20) return p.token;
        if (p && typeof p.access_token === 'string' && p.access_token.length > 20) return p.access_token;
      } catch(e) {
        try {
          var s = sessionStorage.getItem(ssKeys[i]);
          if (s && s.length > 30 && s.indexOf('{') !== 0) return s;
        } catch(e2) {}
      }
    }
    try {
      for (var k in localStorage) {
        if (k.indexOf('sb-') === 0 && k.indexOf('auth-token') !== -1) {
          var sb = JSON.parse(localStorage.getItem(k) || '{}');
          if (sb && sb.access_token) return sb.access_token;
        }
      }
    } catch(e) {}
    return '';
  }
  var ROLE_PERMS = {
    superadmin:['read','write','delete','admin','superadmin'],
    admin:['read','write','delete','admin'],
    manager:['read','write','delete'],
    viewer:['read']
  };
  function permsFor(role){ return ROLE_PERMS[role]||ROLE_PERMS.viewer; }

  /* ── State ─────────────────────────────────────────────────────────────── */
  function ls()  { try{ return JSON.parse(localStorage.getItem(SK))||{}; }catch(e){ return {}; } }
  function ss(s) { localStorage.setItem(SK,JSON.stringify(s)); }
  function uid() { return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

  /* ── Cloud Sync ─────────────────────────────────────────────────────────── */
  var syncState = { loading: false, lastSync: null, error: null };

  async function cloudLoad() {
    var tok = getToken();
    if (!tok) return;
    syncState.loading = true;
    try {
      var r = await fetch('/api/sync', { headers: { 'Authorization': 'Bearer ' + tok } });
      if (!r.ok) { syncState.error = 'Load failed (' + r.status + ')'; return; }
      var json = await r.json();
      var remote = json.data || {};
      if (!Object.keys(remote).length) return; // nothing stored yet
      // Merge remote into local — remote wins on conflict, preserve local-only keys
      var local = ls();
      var merged = Object.assign({}, local);
      var MERGE_ARRAYS = ['projects','claims','grcRisks','complianceControls','procurementItems','aiFindings','crossDocumentFindings','preBidClarifications'];
      var MERGE_MAPS   = ['contractDocuments','lcgpaRecords','wbsPhases','pipelineSteps','contractWorkflowStatus','documentContents'];
      MERGE_ARRAYS.forEach(function(k){
        if (!remote[k]) return;
        var m = {};
        (local[k]||[]).forEach(function(i){ if(i&&i.id) m[i.id]=i; });
        remote[k].forEach(function(i){ if(i&&i.id) m[i.id]=i; });
        merged[k] = Object.values(m);
      });
      MERGE_MAPS.forEach(function(k){
        if (!remote[k]) return;
        var base = Object.assign({}, local[k]||{});
        Object.keys(remote[k]).forEach(function(pid){
          var rArr = remote[k][pid], lArr = base[pid];
          if (Array.isArray(rArr)) {
            var m = {};
            (lArr||[]).forEach(function(i){ if(i&&i.id) m[i.id]=i; });
            rArr.forEach(function(i){ if(i&&i.id) m[i.id]=i; });
            base[pid] = Object.values(m);
          } else { base[pid] = rArr; }
        });
        merged[k] = base;
      });
      merged._demo = false;
      ss(merged);
      syncState.lastSync = new Date().toISOString();
      syncState.error = null;
    } catch(e) { syncState.error = e.message; }
    finally { syncState.loading = false; }
  }

  async function cloudPush() {
    var tok = getToken();
    if (!tok) return;
    try {
      var state = ls();
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(state)
      });
      syncState.lastSync = new Date().toISOString();
    } catch(e) { /* silent — local state is still saved */ }
  }

  /* ── CSV ───────────────────────────────────────────────────────────────── */
  function parseCSV(txt) {
    var lines=txt.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(function(l){return l.trim();});
    if(lines.length<2) return [];
    var hdr=splitLine(lines[0]);
    return lines.slice(1).map(function(l){
      var v=splitLine(l), o={};
      hdr.forEach(function(h,i){ o[h.trim()]=(v[i]||'').trim(); });
      return o;
    }).filter(function(r){ return Object.values(r).some(Boolean); });
  }
  function splitLine(l) {
    var r=[],c='',q=false;
    for(var i=0;i<l.length;i++){
      var ch=l[i];
      if(ch==='"') q=!q;
      else if(ch===','&&!q){r.push(c);c='';}
      else c+=ch;
    }
    r.push(c); return r;
  }

  /* ── Utils ─────────────────────────────────────────────────────────────── */
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmt(n){ return (parseFloat(n)||0).toLocaleString('en-SA'); }
  function fmtDate(d){ return d?new Date(d).toLocaleDateString('en-SA',{year:'numeric',month:'short',day:'numeric'}):'—'; }
  function badge(v,extra){
    var cls={
      active:'#4ade80',planning:'#a5b4fc','on-hold':'#fbbf24',completed:'#94a3b8',
      draft:'#94a3b8',expired:'#fca5a5',terminated:'#fca5a5',
      open:'#fca5a5',mitigated:'#4ade80',closed:'#94a3b8',monitoring:'#fbbf24',
      submitted:'#a5b4fc','under-review':'#fbbf24',approved:'#4ade80',rejected:'#fca5a5',settled:'#94a3b8',
      superadmin:'#fb923c',admin:'#a5b4fc',manager:'#2dd4bf',viewer:'#94a3b8'
    };
    var c=cls[String(v||'').toLowerCase()]||'#94a3b8';
    return '<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:'+c+'22;color:'+c+'">'+(extra||esc(v))+'</span>';
  }
  function pct(v){ var n=parseFloat(v)||0; var c=n>=40?'#4ade80':n>=25?'#fbbf24':'#ef4444'; return '<span style="font-weight:700;color:'+c+'">'+n+'%</span>'; }
  function score(n){ var c=n>=15?'#ef4444':n>=8?'#fbbf24':'#4ade80'; return '<span style="font-weight:700;color:'+c+'">'+n+'</span>'; }
  function progress(v){
    var n=parseFloat(v)||0;
    var c=n>=75?'#4ade80':n>=40?'#fbbf24':'#64748b';
    return '<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:4px;background:#334155;border-radius:2px"><div style="width:'+Math.min(n,100)+'%;height:100%;background:'+c+';border-radius:2px"></div></div><span style="font-size:11px;color:#94a3b8;white-space:nowrap">'+n+'%</span></div>';
  }

  /* ── CSS ───────────────────────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('ms-css')) return;
    var s = document.createElement('style');
    s.id = 'ms-css';
    s.textContent = `
#ms-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9980;opacity:0;pointer-events:none;transition:opacity .25s;}
#ms-overlay.on{opacity:1;pointer-events:all;}
#ms-panel{
  position:fixed;top:0;right:0;bottom:0;width:min(880px,100vw);
  background:#0f172a;border-left:1px solid #334155;z-index:9981;
  transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);
  display:flex;flex-direction:column;overflow:hidden;
  font-family:'Tajawal','Inter',sans-serif;direction:ltr;
}
#ms-panel.on{transform:translateX(0);}
.ms-head{background:#1e293b;border-bottom:1px solid #334155;padding:14px 20px;display:flex;align-items:center;gap:10px;flex-shrink:0;}
.ms-head h2{font-size:15px;font-weight:700;color:#f1f5f9;flex:1;margin:0;}
.ms-head .ms-user-badge{font-size:11px;color:#64748b;white-space:nowrap;}
.ms-close{background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .15s,color .15s;}
.ms-close:hover{background:#334155;color:#f1f5f9;}
.ms-tabs{display:flex;background:#1e293b;border-bottom:1px solid #334155;overflow-x:auto;flex-shrink:0;scrollbar-width:none;}
.ms-tabs::-webkit-scrollbar{display:none;}
.ms-tab{padding:11px 15px;font-size:12px;font-weight:600;color:#94a3b8;border:none;background:none;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;font-family:inherit;}
.ms-tab:hover{color:#e2e8f0;}
.ms-tab.on{color:#0d9488;border-bottom-color:#0d9488;}
.ms-body{flex:1;overflow-y:auto;padding:18px 20px;}
/* ── Table ── */
.ms-tbl-wrap{overflow-x:auto;border:1px solid #334155;border-radius:10px;margin-bottom:4px;}
.ms-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.ms-tbl thead th{background:#1e293b;color:#64748b;padding:9px 13px;text-align:left;font-weight:700;font-size:10px;letter-spacing:.6px;text-transform:uppercase;position:sticky;top:0;border-bottom:1px solid #334155;cursor:pointer;user-select:none;white-space:nowrap;}
.ms-tbl thead th:hover{color:#f1f5f9;}
.ms-tbl thead th .si{margin-left:4px;opacity:.35;font-size:9px;}
.ms-tbl thead th.sa .si,.ms-tbl thead th.sd .si{opacity:1;color:#0d9488;}
.ms-tbl tbody tr{border-top:1px solid rgba(51,65,85,.4);transition:background .1s;}
.ms-tbl tbody tr:hover{background:rgba(13,148,136,.06);}
.ms-tbl tbody td{padding:9px 13px;color:#cbd5e1;vertical-align:middle;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ms-tbl tbody td:first-child{color:#f1f5f9;font-weight:500;}
.ms-empty{text-align:center;color:#475569;padding:48px 20px;font-size:13px;}
/* ── Toolbar ── */
.ms-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;}
.ms-q{flex:1;min-width:160px;background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:7px 11px;border-radius:8px;font-size:12px;font-family:inherit;outline:none;}
.ms-q:focus{border-color:#0d9488;}
.ms-q::placeholder{color:#475569;}
.ms-cnt{font-size:11px;color:#475569;}
/* ── Pagination ── */
.ms-pg{display:flex;align-items:center;gap:10px;padding:8px 0 12px;justify-content:center;}
.ms-pg-info{font-size:11px;color:#64748b;min-width:140px;text-align:center;}
/* ── Buttons ── */
.ms-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:opacity .15s,transform .1s;font-family:inherit;}
.ms-btn:hover{opacity:.85;transform:translateY(-1px);}
.ms-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}
.ms-btn.p{background:#0d9488;color:#fff;}
.ms-btn.s{background:#6366f1;color:#fff;}
.ms-btn.d{background:#ef4444;color:#fff;}
.ms-btn.o{background:transparent;color:#94a3b8;border:1px solid #334155;}
.ms-btn.sm{padding:4px 9px;font-size:11px;}
/* ── Form ── */
.ms-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
@media(max-width:480px){.ms-grid{grid-template-columns:1fr;}}
.ms-f label{display:block;font-size:10px;color:#64748b;font-weight:700;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;}
.ms-f input,.ms-f select,.ms-f textarea{width:100%;background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:8px 11px;border-radius:8px;font-size:12px;font-family:inherit;outline:none;appearance:none;}
.ms-f input:focus,.ms-f select:focus,.ms-f textarea:focus{border-color:#0d9488;}
.ms-f textarea{resize:vertical;min-height:70px;}
/* ── Drop zone ── */
.ms-drop{border:2px dashed #334155;border-radius:10px;padding:20px;text-align:center;color:#64748b;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s;margin-bottom:12px;display:block;}
.ms-drop:hover,.ms-drop.dg{border-color:#0d9488;background:rgba(13,148,136,.05);color:#cbd5e1;}
/* ── Section label ── */
.ms-sec{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.7px;margin:18px 0 10px;display:flex;align-items:center;gap:8px;}
.ms-sec::after{content:'';flex:1;height:1px;background:#1e293b;}
/* ── Doc card ── */
.ms-dc{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 13px;display:flex;align-items:center;gap:10px;margin-bottom:6px;}
.ms-dc .dn{font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ms-dc .dm{font-size:10px;color:#475569;}
/* ── Role select ── */
.ms-rs{background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:4px 8px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer;outline:none;}
/* ── Toast ── */
#ms-toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:9px 18px;border-radius:10px;font-size:13px;font-family:'Tajawal','Inter',sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);z-index:99999;opacity:0;pointer-events:none;transition:opacity .2s;white-space:nowrap;}
#ms-toast.on{opacity:1;}
/* ── FAB ── */
#ms-fab{position:fixed;bottom:24px;left:24px;z-index:9979;display:flex;align-items:center;gap:8px;background:#0d9488;color:#fff;padding:11px 20px;border-radius:50px;font-family:'Tajawal','Inter',sans-serif;font-size:13px;font-weight:700;border:none;cursor:pointer;box-shadow:0 4px 18px rgba(13,148,136,.4);transition:background .15s,transform .15s,box-shadow .15s;}
#ms-fab:hover{background:#0f766e;transform:translateY(-2px);box-shadow:0 8px 28px rgba(13,148,136,.5);}
#ms-fab.off{display:none;}
/* ── Global table polish for the main React app ── */
#root table thead th{font-size:11px !important;letter-spacing:.5px !important;font-weight:700 !important;}
#root tbody tr{transition:background .1s !important;}
#root table{border-radius:8px;overflow:hidden;}
/* ── No-perm ── */
.ms-noperm{text-align:center;padding:60px 20px;color:#475569;}
.ms-noperm h3{font-size:15px;color:#64748b;margin-bottom:8px;}
    `;
    document.head.appendChild(s);
  }

  /* ── Templates ─────────────────────────────────────────────────────────── */
  var TPL = {
    projects: 'name,status,budget,startDate,endDate,client,contractor,location,description,localContentTarget,completionPct\nKing Salman Park Phase 2,active,12500000,2024-01-15,2025-06-30,Royal Commission,Saudi Binladin Group,"Riyadh, Saudi Arabia",Infrastructure works,40,65',
    contracts:'projectId,title,type,status,value,signedDate,expiryDate,parties,retentionPct,notes\n,Main Civil Works Agreement,FIDIC-Red,active,8500000,2024-02-01,2025-12-31,Client; Contractor; Engineer,5,',
    grc:      'title,category,likelihood,impact,status,owner,mitigation,projectId,dueDate,regulation\nDelay in material delivery,Operational,3,4,open,Ahmed Al-Rashidi,Dual-source procurement,,2025-03-01,',
    lcgpa:    'projectId,category,itemName,totalValue,localValue,supplier,period,certificate,notes\n,Labor,Civil engineering manpower,2500000,1800000,Al-Rashad Contracting,2024-Q1,,',
    claims:   'projectId,title,type,amount,status,submittedDate,clauze,claimant,description,daysRequested\n,EOT Claim for Storm Delay,EOT,750000,submitted,2024-07-10,FIDIC 20.1,,45-day delay,45'
  };

  /* ── Table builder ─────────────────────────────────────────────────────── */
  function tbl(entity, cols, rows, rowFn, extraActionsFn) {
    // Sort
    var sk = activeSortK[entity];
    if (sk) {
      var sdir = sortDir[entity+'_'+sk] || 'asc';
      rows = rows.slice().sort(function(a,b){
        var av=String(a[sk]||''), bv=String(b[sk]||'');
        var isNum=!isNaN(parseFloat(av))&&!isNaN(parseFloat(bv));
        var cmp=isNum?parseFloat(av)-parseFloat(bv):av.localeCompare(bv);
        return sdir==='asc'?cmp:-cmp;
      });
    }
    // Filter
    var q = (filterState[entity]||'').toLowerCase();
    var filtered = q ? rows.filter(function(r){
      return JSON.stringify(r).toLowerCase().indexOf(q)!==-1;
    }) : rows;

    // Paginate
    var page = Math.max(1, pageState[entity]||1);
    var totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
    if (page > totalPages) { page = totalPages; pageState[entity] = page; }
    var start = (page-1)*PAGE_SIZE;
    var pageRows = filtered.slice(start, start+PAGE_SIZE);

    var h = '<div class="ms-tbl-wrap"><table class="ms-tbl" id="ms-t-'+entity+'"><thead><tr>';
    cols.forEach(function(c){
      var dir = (activeSortK[entity]===c.k) ? sortDir[entity+'_'+c.k] : '';
      h += '<th class="'+(dir?'s'+dir.slice(0,1):'')+'" onclick="msSort(\''+entity+'\',\''+c.k+'\')" data-k="'+c.k+'"><span class="si">▲▼</span>'+esc(c.l)+'</th>';
    });
    h += '<th style="width:100px">Actions</th></tr></thead><tbody id="ms-b-'+entity+'">';
    if (!filtered.length) {
      h += '<tr><td colspan="'+(cols.length+1)+'" class="ms-empty">'+(q?'No results for &ldquo;'+esc(q)+'&rdquo;':'No records — use Import below or the Add button')+'</td></tr>';
    } else {
      pageRows.forEach(function(r,i){
        h += '<tr data-sr="'+esc(JSON.stringify(r).toLowerCase())+'" data-idx="'+i+'">' + rowFn(r) +
          '<td style="white-space:nowrap">' +
          (extraActionsFn ? extraActionsFn(r) : '') +
          '<button class="ms-btn d sm" title="Delete" onclick="msDel(\''+entity+'\',\''+esc(r.id||i)+'\')">🗑</button></td></tr>';
      });
    }
    h += '</tbody></table></div>';

    // Pagination controls
    if (filtered.length > PAGE_SIZE) {
      h += '<div class="ms-pg">'+
        '<button class="ms-btn o sm" '+(page<=1?'disabled':'')+' onclick="msPage(\''+entity+'\',-1)">‹ Prev</button>'+
        '<span class="ms-pg-info">Page '+page+' / '+totalPages+' &nbsp;&mdash;&nbsp; '+filtered.length+' total</span>'+
        '<button class="ms-btn o sm" '+(page>=totalPages?'disabled':'')+' onclick="msPage(\''+entity+'\',1)">Next ›</button>'+
      '</div>';
    }
    return h;
  }

  function bar(entity, count, addLabel) {
    var w = canWrite();
    var q = filterState[entity]||'';
    var h = '<div class="ms-bar">';
    h += '<input class="ms-q" id="ms-q-'+entity+'" value="'+esc(q)+'" placeholder="Search '+entity+'…" oninput="msFilter(\''+entity+'\',this.value)" />';
    if (w && addLabel)
      h += '<button class="ms-btn p sm" onclick="msToggleImport(\''+entity+'\')">⊕ '+addLabel+'</button>';
    h += '<span class="ms-cnt" id="ms-c-'+entity+'">'+count+' records</span>';
    h += '</div>';
    return h;
  }

  function importSection(entity) {
    var h = '<details id="ms-imp-'+entity+'" style="margin-top:10px">';
    h += '<summary style="cursor:pointer;font-size:12px;color:#0d9488;font-weight:600;padding:6px 0;list-style:none;">⬇ Import via CSV</summary>';
    h += '<div style="padding:10px 0">';
    h += '<button class="ms-btn o sm" style="margin-bottom:8px" onclick="msTpl(\''+entity+'\')">⬇ Download Template</button>';
    h += '<input type="file" id="ms-fi-'+entity+'" accept=".csv" style="display:none" onchange="msCSV(\''+entity+'\',this)" />';
    h += '<label for="ms-fi-'+entity+'" class="ms-drop" id="ms-dr-'+entity+'">📁 Click or drag CSV file here</label>';
    h += '<div id="ms-is-'+entity+'"></div>';
    h += '<div id="ms-ia-'+entity+'"></div>';
    h += '</div></details>';
    return h;
  }

  /* ── Tab content builders ───────────────────────────────────────────────── */
  function tabProjects() {
    var state = ls(), rows = (state.projects||[]);
    var cd = state.contractDocuments||{};
    var cols = [{k:'name',l:'Project'},{k:'status',l:'Status'},{k:'client',l:'Client'},{k:'budget',l:'Budget SAR'},{k:'startDate',l:'Start'},{k:'endDate',l:'End'},{k:'completionPct',l:'%'}];
    return bar('projects',rows.length,'Add Project') +
      tbl('projects',cols,rows,function(r){
        var cnt = (cd[r.id]||[]).length;
        var nameCell = esc(r.name)+(cnt?' <span style="font-size:10px;background:#0d948820;color:#0d9488;padding:1px 6px;border-radius:10px">'+cnt+' docs</span>':'');
        return '<td title="'+esc(r.name)+'">'+nameCell+'</td>'+
               '<td>'+badge(r.status)+'</td>'+
               '<td>'+esc(r.client||'—')+'</td>'+
               '<td>'+fmt(r.budget)+'</td>'+
               '<td>'+fmtDate(r.startDate)+'</td>'+
               '<td>'+fmtDate(r.endDate)+'</td>'+
               '<td style="min-width:110px">'+progress(r.completionPct)+'</td>';
      }, canWrite() ? function(r){
        var sid = esc(r.id||'');
        return '<input type="file" id="ms-pfi-'+sid+'" accept=".pdf,.docx,.txt" style="display:none" onchange="msUploadToProject(\''+sid+'\',this)" />'+
               '<label for="ms-pfi-'+sid+'" class="ms-btn o sm" title="Upload document to this project" style="margin-right:4px">📎</label>';
      } : null) +
      (canWrite() ? importSection('projects') : '');
  }

  function tabContracts() {
    var state = ls(), cd = state.contractDocuments||{}, dc = state.documentContents||{}, rows=[];
    Object.keys(cd).forEach(function(pid){
      (cd[pid]||[]).forEach(function(d){ rows.push(Object.assign({},d,{_ai: dc[d.id]?1:0})); });
    });
    var cols = [{k:'title',l:'Title'},{k:'type',l:'Type'},{k:'status',l:'Status'},{k:'value',l:'Value SAR'},{k:'signedDate',l:'Signed'},{k:'expiryDate',l:'Expires'},{k:'_ai',l:'AI Ready'}];
    return bar('contracts',rows.length,'Add Contract') +
      tbl('contracts',cols,rows,function(r){
        var ai = r._ai ? badge('active','✓ Ready') : badge('draft','—');
        return '<td title="'+esc(r.title)+'">'+esc(r.title)+'</td>'+
               '<td>'+badge('planning',esc(r.type||'—'))+'</td>'+
               '<td>'+badge(r.status)+'</td>'+
               '<td>'+fmt(r.value)+'</td>'+
               '<td>'+fmtDate(r.signedDate)+'</td>'+
               '<td>'+fmtDate(r.expiryDate)+'</td>'+
               '<td>'+ai+'</td>';
      }, canWrite() ? function(r){
        var sid = esc(r.id||'');
        var dlBtn = r._ai ? '<button class="ms-btn o sm" title="Download extracted text" style="margin-right:4px" onclick="msDlDoc(\''+sid+'\',\''+esc(r.title||'contract')+'\')">⬇</button>' : '';
        return '<input type="file" id="ms-cfi-'+sid+'" accept=".pdf,.docx,.txt" style="display:none" onchange="msUploadToContract(\''+sid+'\',this)" />'+
               '<label for="ms-cfi-'+sid+'" class="ms-btn o sm" title="Upload contract file" style="margin-right:4px">📎</label>'+
               dlBtn;
      } : null) +
      (canWrite() ? importSection('contracts') : '');
  }

  function tabGRC() {
    var state = ls(), rows = (state.grcRisks||[]);
    var cols = [{k:'title',l:'Risk'},{k:'category',l:'Category'},{k:'likelihood',l:'L'},{k:'impact',l:'I'},{k:'riskScore',l:'Score'},{k:'status',l:'Status'},{k:'owner',l:'Owner'},{k:'dueDate',l:'Due'}];
    return bar('grc',rows.length,'Add Risk') +
      tbl('grc',cols,rows,function(r){
        var sc = r.riskScore||(r.likelihood*r.impact)||0;
        return '<td title="'+esc(r.title)+'">'+esc(r.title)+'</td>'+
               '<td>'+badge('planning',esc(r.category||'—'))+'</td>'+
               '<td style="text-align:center;font-weight:600">'+esc(r.likelihood||'—')+'</td>'+
               '<td style="text-align:center;font-weight:600">'+esc(r.impact||'—')+'</td>'+
               '<td style="text-align:center">'+score(sc)+'</td>'+
               '<td>'+badge(r.status)+'</td>'+
               '<td>'+esc(r.owner||'—')+'</td>'+
               '<td>'+fmtDate(r.dueDate)+'</td>';
      }) +
      (canWrite() ? importSection('grc') : '');
  }

  function tabLCGPA() {
    var state = ls(), lr = state.lcgpaRecords||{}, rows=[];
    Object.keys(lr).forEach(function(pid){ (lr[pid]||[]).forEach(function(r){ rows.push(r); }); });
    var cols = [{k:'itemName',l:'Item'},{k:'category',l:'Category'},{k:'totalValue',l:'Total SAR'},{k:'localValue',l:'Local SAR'},{k:'localContentPct',l:'LC %'},{k:'supplier',l:'Supplier'},{k:'period',l:'Period'}];
    return bar('lcgpa',rows.length,'Add Record') +
      tbl('lcgpa',cols,rows,function(r){
        var p = r.localContentPct||(r.totalValue>0?Math.round((r.localValue/r.totalValue)*1000)/10:0);
        return '<td title="'+esc(r.itemName)+'">'+esc(r.itemName)+'</td>'+
               '<td>'+badge('planning',esc(r.category||'—'))+'</td>'+
               '<td>'+fmt(r.totalValue)+'</td>'+
               '<td>'+fmt(r.localValue)+'</td>'+
               '<td>'+pct(p)+'</td>'+
               '<td>'+esc(r.supplier||'—')+'</td>'+
               '<td>'+esc(r.period||'—')+'</td>';
      }) +
      (canWrite() ? importSection('lcgpa') : '');
  }

  function tabClaims() {
    var state = ls(), rows = (state.claims||[]);
    var cols = [{k:'title',l:'Claim'},{k:'type',l:'Type'},{k:'amount',l:'Amount SAR'},{k:'status',l:'Status'},{k:'submittedDate',l:'Submitted'},{k:'clauze',l:'Clause'},{k:'claimant',l:'Claimant'}];
    return bar('claims',rows.length,'Add Claim') +
      tbl('claims',cols,rows,function(r){
        return '<td title="'+esc(r.title)+'">'+esc(r.title)+'</td>'+
               '<td>'+badge('planning',esc(r.type||'—'))+'</td>'+
               '<td>'+fmt(r.amount)+'</td>'+
               '<td>'+badge(r.status)+'</td>'+
               '<td>'+fmtDate(r.submittedDate)+'</td>'+
               '<td>'+esc(r.clauze||'—')+'</td>'+
               '<td>'+esc(r.claimant||'—')+'</td>';
      }) +
      (canWrite() ? importSection('claims') : '');
  }

  function tabDocs() {
    var state = ls(), cd = state.contractDocuments||{}, dc = state.documentContents||{}, rows=[];
    Object.keys(cd).forEach(function(pid){
      (cd[pid]||[]).forEach(function(d){ rows.push(Object.assign({},d,{_hasText:!!dc[d.id]})); });
    });
    var cols = [{k:'title',l:'Document'},{k:'type',l:'Type'},{k:'status',l:'Status'},{k:'_hasText',l:'AI Ready'},{k:'signedDate',l:'Signed'}];
    var h = bar('docs',rows.length,null) +
      tbl('docs',cols,rows,function(r){
        var ai = r._hasText ? badge('active','✓ Extracted') : badge('draft','No text');
        return '<td title="'+esc(r.title)+'">'+esc(r.title)+'</td>'+
               '<td>'+badge('planning',esc(r.type||'—'))+'</td>'+
               '<td>'+badge(r.status)+'</td>'+
               '<td>'+ai+'</td>'+
               '<td>'+fmtDate(r.signedDate)+'</td>';
      }, function(r){
        return r._hasText
          ? '<button class="ms-btn o sm" title="Download extracted text" style="margin-right:4px" onclick="msDlDoc(\''+esc(r.id)+'\',\''+esc(r.title||'document')+'\')">⬇ TXT</button>'
          : '';
      });
    if (canWrite()) h += docUploadSection();
    return h;
  }

  function docUploadSection() {
    var state = ls(), projects = state.projects||[];
    var h = '<div class="ms-sec">Upload Document Files</div>';
    h += '<div class="ms-grid">';
    h += '<div class="ms-f"><label>Link to Project</label><select id="ms-dp"><option value="">— No project —</option>';
    projects.forEach(function(p){ h += '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>'; });
    h += '</select></div>';
    h += '<div class="ms-f"><label>Document Type</label><select id="ms-dt">';
    ['Contract','Appendix','BOQ','Specification','Claim','Variation','Insurance','Report','Correspondence','Other'].forEach(function(t){ h += '<option>'+t+'</option>'; });
    h += '</select></div></div>';
    h += '<input type="file" id="ms-fi-docs" accept=".pdf,.docx,.txt" multiple style="display:none" onchange="msDocFiles(this)" />';
    h += '<label for="ms-fi-docs" class="ms-drop" id="ms-dr-docs">📎 Click or drag PDF / DOCX / TXT files<br><small style="color:#334155">Multiple files · up to 10 MB each</small></label>';
    h += '<div id="ms-dq"></div>';
    h += '<div style="display:flex;gap:8px;margin-top:10px"><button class="ms-btn p" id="ms-ub" onclick="msUpload()" disabled>⬆ Extract & Store All</button><button class="ms-btn o sm" onclick="msClearDocs()">✕ Clear</button></div>';
    return h;
  }

  function tabUsers() {
    if (!isAdmin()) return '<div class="ms-noperm"><h3>🔒 Admin Access Required</h3><p>Manage users and roles with admin permissions.</p></div>';
    var state = ls(), users = state.users||[], cu = getUser();

    var h = '<div class="ms-bar"><input class="ms-q" id="ms-q-users" value="'+esc(filterState.users||'')+'" placeholder="Search users…" oninput="msFilter(\'users\',this.value)" /><span class="ms-cnt" id="ms-c-users">'+users.length+' users</span></div>';

    if (!users.length) {
      h += '<div class="ms-empty">No registered users yet. Register users below.</div>';
    } else {
      h += '<div class="ms-tbl-wrap"><table class="ms-tbl" id="ms-t-users"><thead><tr>';
      ['Name','Email','Role','Department','Permissions','Actions'].forEach(function(l){ h += '<th>'+l+'</th>'; });
      h += '</tr></thead><tbody id="ms-b-users">';
      users.forEach(function(u){
        var isSelf = cu && u.id === cu.id;
        var canEdit = isAdmin() && !isSelf;
        var roles = ['viewer','manager','admin','superadmin'];
        var roleSel = canEdit
          ? '<select class="ms-rs" onchange="msRoleChange(\''+esc(u.id)+'\',this.value)">'+
            roles.map(function(r){ return '<option value="'+r+'"'+(r===u.role?' selected':'')+'>'+r+'</option>'; }).join('')+
            '</select>'
          : badge(u.role);
        h += '<tr data-sr="'+esc(JSON.stringify(u).toLowerCase())+'">' +
          '<td style="font-weight:600">'+esc(u.name||u.email||'—')+'</td>'+
          '<td style="color:#94a3b8">'+esc(u.email||'—')+'</td>'+
          '<td>'+roleSel+'</td>'+
          '<td>'+esc(u.department||'General')+'</td>'+
          '<td style="color:#475569;font-size:10px">'+esc((u.permissions||[]).join(', '))+'</td>'+
          '<td>'+(canEdit?'<button class="ms-btn d sm" onclick="msDelUser(\''+esc(u.id)+'\')">Remove</button>':isSelf?'<span style="color:#475569;font-size:11px">You</span>':'')+'</td>'+
        '</tr>';
      });
      h += '</tbody></table></div>';
    }

    h += '<div class="ms-sec">Register New User</div>';
    h += '<div class="ms-grid">';
    h += '<div class="ms-f"><label>Full Name</label><input type="text" id="inv-name" placeholder="Ahmed Al-Rashidi" /></div>';
    h += '<div class="ms-f"><label>Email</label><input type="email" id="inv-email" placeholder="ahmed@company.com.sa" /></div>';
    h += '<div class="ms-f"><label>Role</label><select id="inv-role"><option value="viewer">Viewer</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div>';
    h += '<div class="ms-f"><label>Department</label><input type="text" id="inv-dept" placeholder="Engineering" /></div>';
    h += '</div>';
    h += '<button class="ms-btn p" onclick="msRegister()">📧 Register &amp; Set Temporary Password</button>';
    h += '<div id="ms-reg-status" style="margin-top:10px"></div>';
    return h;
  }

  /* ── Panel DOM ─────────────────────────────────────────────────────────── */
  var TABS = [
    {id:'projects',  l:'🏗 Projects'},
    {id:'contracts', l:'📋 Contracts'},
    {id:'grc',       l:'🛡 GRC Risks'},
    {id:'lcgpa',     l:'🇸🇦 LCGPA'},
    {id:'claims',    l:'⚖ Claims'},
    {id:'docs',      l:'📄 Documents'},
    {id:'users',     l:'👥 Users & Roles', admin:true}
  ];

  function buildPanel() {
    var u = getUser();
    var panel = document.getElementById(PID);
    if (!panel) return;
    var tabsH = TABS.map(function(t){
      if (t.admin && !isAdmin()) return '';
      return '<button class="ms-tab'+(activeTab===t.id?' on':'')+'" data-tab="'+t.id+'" onclick="msTab(\''+t.id+'\')">'+t.l+'</button>';
    }).join('');
    panel.innerHTML =
      '<div class="ms-head"><h2>📊 Data Management</h2>'+
      (u?'<span class="ms-user-badge">'+esc(u.name||u.email||'')+'&nbsp;·&nbsp;'+badge(u.role)+'</span>':'')+
      '<button class="ms-close" onclick="msClose()">✕</button></div>'+
      '<div class="ms-tabs" id="ms-tabs">'+tabsH+'</div>'+
      '<div class="ms-body" id="ms-body"></div>';
    loadTab(activeTab);
  }

  function loadTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.ms-tab').forEach(function(t){ t.classList.toggle('on', t.dataset.tab===tab); });
    var body = document.getElementById('ms-body');
    if (!body) return;
    var fn = {projects:tabProjects,contracts:tabContracts,grc:tabGRC,lcgpa:tabLCGPA,claims:tabClaims,docs:tabDocs,users:tabUsers};
    body.innerHTML = (fn[tab]||function(){ return ''; })();
    hookDrop();
  }

  /* ── Drag-drop hook ────────────────────────────────────────────────────── */
  function hookDrop() {
    ['projects','contracts','grc','lcgpa','claims'].forEach(function(e){
      var el = document.getElementById('ms-dr-'+e);
      if (!el) return;
      el.addEventListener('dragover',function(ev){ev.preventDefault();el.classList.add('dg');});
      el.addEventListener('dragleave',function(){el.classList.remove('dg');});
      el.addEventListener('drop',function(ev){
        ev.preventDefault();el.classList.remove('dg');
        var f=ev.dataTransfer.files[0]; if(!f) return;
        var dt=new DataTransfer(); dt.items.add(f);
        var fi=document.getElementById('ms-fi-'+e); if(!fi) return;
        fi.files=dt.files; msCSV(e,fi);
      });
    });
    var docDr = document.getElementById('ms-dr-docs');
    if (docDr) {
      docDr.addEventListener('dragover',function(ev){ev.preventDefault();docDr.classList.add('dg');});
      docDr.addEventListener('dragleave',function(){docDr.classList.remove('dg');});
      docDr.addEventListener('drop',function(ev){
        ev.preventDefault();docDr.classList.remove('dg');
        var files=Array.from(ev.dataTransfer.files).filter(function(f){return f.name.match(/\.(pdf|docx|txt)$/i);});
        msAddDocs(files);
      });
    }
  }

  /* ── Global handlers ───────────────────────────────────────────────────── */
  window.msOpen  = function(){
    ensurePanel();
    document.getElementById(OID).classList.add('on');
    document.getElementById(PID).classList.add('on');
    // Pull latest data from cloud on every open, then refresh current tab
    cloudLoad().then(function(){ loadTab(activeTab); });
  };
  window.msClose = function(){ document.getElementById(OID).classList.remove('on'); document.getElementById(PID).classList.remove('on'); };
  window.msTab   = function(t){ pageState[t]=1; loadTab(t); };

  window.msPage = function(e, delta) {
    pageState[e] = Math.max(1, (pageState[e]||1) + delta);
    loadTab(activeTab);
    var input = document.getElementById('ms-q-'+e);
    if (input) { input.value = filterState[e]||''; }
  };

  window.msFilter = function(e, q) {
    filterState[e] = q;
    pageState[e] = 1;
    loadTab(activeTab);
    var input = document.getElementById('ms-q-'+e);
    if (input) {
      input.value = q;
      input.focus();
      try { input.setSelectionRange(q.length, q.length); } catch(ex){}
    }
  };

  window.msSort = function(e, k) {
    var key = e+'_'+k;
    sortDir[key] = sortDir[key]==='asc' ? 'desc' : 'asc';
    activeSortK[e] = k;
    pageState[e] = 1;
    loadTab(activeTab);
  };

  window.msToggleImport = function(e) {
    var d=document.getElementById('ms-imp-'+e); if(d) d.open=!d.open;
  };
  window.msTpl = function(e) {
    var csv=TPL[e]||''; var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=e+'_template.csv'; a.click();
  };
  window.msCSV = function(e,input) {
    var file=input.files&&input.files[0]; if(!file) return;
    var reader=new FileReader();
    reader.onload=function(ev){
      var rows=parseCSV(ev.target.result);
      csvParsed[e]=rows;
      var s=document.getElementById('ms-is-'+e);
      var a=document.getElementById('ms-ia-'+e);
      if(s) s.innerHTML='<div style="color:#4ade80;font-size:12px;margin:6px 0">✓ '+rows.length+' rows parsed from '+esc(file.name)+'</div>';
      if(a) a.innerHTML='<button class="ms-btn p sm" onclick="msImport(\''+e+'\')">⬆ Import '+rows.length+' records</button>';
    };
    reader.readAsText(file,'UTF-8');
    input.value='';
  };

  window.msImport = function(e) {
    var rows=csvParsed[e]; if(!rows||!rows.length) return;
    var state=ls(); state._demo=false; var added=0;
    if(e==='projects'){
      if(!Array.isArray(state.projects)) state.projects=[];
      rows.forEach(function(r){
        if(!r.name) return;
        state.projects.push({id:'proj_'+uid(),name:r.name,status:r.status||'active',budget:parseFloat(r.budget)||0,startDate:r.startDate||'',endDate:r.endDate||'',client:r.client||'',contractor:r.contractor||'',location:r.location||'',description:r.description||'',localContentTarget:parseFloat(r.localContentTarget)||0,completionPct:parseFloat(r.completionPct)||0,createdAt:new Date().toISOString()});
        added++;
      });
    } else if(e==='contracts'){
      if(!state.contractDocuments) state.contractDocuments={};
      rows.forEach(function(r){
        if(!r.title) return;
        var pid=r.projectId||'__unlinked';
        if(!state.contractDocuments[pid]) state.contractDocuments[pid]=[];
        state.contractDocuments[pid].push({id:'doc_'+uid(),projectId:pid,title:r.title,type:r.type||'Contract',status:r.status||'active',value:parseFloat(r.value)||0,signedDate:r.signedDate||'',expiryDate:r.expiryDate||'',parties:r.parties?r.parties.split(';').map(function(p){return p.trim();}):[], retentionPct:parseFloat(r.retentionPct)||0,notes:r.notes||'',createdAt:new Date().toISOString()});
        added++;
      });
    } else if(e==='grc'){
      if(!Array.isArray(state.grcRisks)) state.grcRisks=[];
      rows.forEach(function(r){
        if(!r.title) return;
        var l=parseInt(r.likelihood)||1,im=parseInt(r.impact)||1;
        state.grcRisks.push({id:'risk_'+uid(),title:r.title,category:r.category||'Operational',likelihood:l,impact:im,riskScore:l*im,status:r.status||'open',owner:r.owner||'',mitigation:r.mitigation||'',projectId:r.projectId||'',dueDate:r.dueDate||'',regulation:r.regulation||'',createdAt:new Date().toISOString()});
        added++;
      });
    } else if(e==='lcgpa'){
      if(!state.lcgpaRecords) state.lcgpaRecords={};
      rows.forEach(function(r){
        if(!r.itemName) return;
        var pid=r.projectId||'__unlinked';
        if(!state.lcgpaRecords[pid]) state.lcgpaRecords[pid]=[];
        var tv=parseFloat(r.totalValue)||0,lv=parseFloat(r.localValue)||0;
        state.lcgpaRecords[pid].push({id:'lc_'+uid(),projectId:pid,category:r.category||'Labor',itemName:r.itemName,totalValue:tv,localValue:lv,localContentPct:tv>0?Math.round((lv/tv)*1000)/10:0,supplier:r.supplier||'',period:r.period||'',certificate:r.certificate||'',notes:r.notes||'',createdAt:new Date().toISOString()});
        added++;
      });
    } else if(e==='claims'){
      if(!Array.isArray(state.claims)) state.claims=[];
      rows.forEach(function(r){
        if(!r.title) return;
        state.claims.push({id:'claim_'+uid(),projectId:r.projectId||'',title:r.title,type:r.type||'EOT',amount:parseFloat(r.amount)||0,status:r.status||'draft',submittedDate:r.submittedDate||'',clauze:r.clauze||'',claimant:r.claimant||'',description:r.description||'',daysRequested:parseInt(r.daysRequested)||0,createdAt:new Date().toISOString()});
        added++;
      });
    }
    ss(state);
    toast('✅ Imported '+added+' '+e+' records');
    cloudPush();
    loadTab(activeTab);
  };

  window.msDel = function(e,id) {
    if(!confirm('Delete this record?')) return;
    var state=ls();
    if(e==='projects') state.projects=(state.projects||[]).filter(function(r){return String(r.id)!==String(id);});
    else if(e==='contracts') Object.keys(state.contractDocuments||{}).forEach(function(p){ state.contractDocuments[p]=(state.contractDocuments[p]||[]).filter(function(r){return String(r.id)!==String(id);}); });
    else if(e==='docs') { Object.keys(state.contractDocuments||{}).forEach(function(p){ state.contractDocuments[p]=(state.contractDocuments[p]||[]).filter(function(r){return String(r.id)!==String(id);}); }); delete (state.documentContents||{})[id]; }
    else if(e==='grc') state.grcRisks=(state.grcRisks||[]).filter(function(r){return String(r.id)!==String(id);});
    else if(e==='lcgpa') Object.keys(state.lcgpaRecords||{}).forEach(function(p){ state.lcgpaRecords[p]=(state.lcgpaRecords[p]||[]).filter(function(r){return String(r.id)!==String(id);}); });
    else if(e==='claims') state.claims=(state.claims||[]).filter(function(r){return String(r.id)!==String(id);});
    ss(state); cloudPush(); toast('Record deleted'); loadTab(activeTab);
  };

  /* ── Document download ─────────────────────────────────────────────────── */
  window.msDlDoc = function(docId, title) {
    var state = ls();
    var text = (state.documentContents||{})[docId];
    if (!text) { toast('No extracted text available for download'); return; }
    var safeName = (title||'document').replace(/[^\w\s\-\.]/g,'_').replace(/\s+/g,'_');
    var blob = new Blob([text], {type:'text/plain;charset=utf-8;'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast('⬇ Downloaded ' + safeName + '.txt');
  };

  /* ── Shared file-to-text extractor ────────────────────────────────────── */
  async function extractText(file) {
    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      return await file.text();
    }
    var b64 = await new Promise(function(res){
      var fr = new FileReader();
      fr.onload = function(e){ res(e.target.result.split(',')[1]); };
      fr.readAsDataURL(file);
    });
    var resp = await fetch('/api/parse', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+getToken()},
      body: JSON.stringify({content:b64, name:file.name, type:file.type})
    });
    var json = await resp.json();
    if (!resp.ok) throw new Error(json.error||'Parse failed');
    if (!json.text || !json.text.trim()) throw new Error('No text extracted (scanned or image PDF?)');
    return json.text;
  }

  /* ── Per-project inline upload ─────────────────────────────────────────── */
  window.msUploadToProject = async function(projectId, input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    input.value = '';
    toast('⏳ Uploading to project…');
    try {
      var text = await extractText(file);
      var state = ls(); state._demo = false;
      if (!state.contractDocuments) state.contractDocuments = {};
      if (!state.documentContents)  state.documentContents  = {};
      var docId = 'doc_'+uid();
      var title = file.name.replace(/\.[^.]+$/, '');
      if (!state.contractDocuments[projectId]) state.contractDocuments[projectId] = [];
      state.contractDocuments[projectId].push({
        id:docId, projectId:projectId, title:title,
        type:'Document', status:'active', value:0,
        signedDate:'', expiryDate:'', parties:[], retentionPct:0,
        notes:'Uploaded '+new Date().toLocaleDateString(),
        createdAt:new Date().toISOString()
      });
      state.documentContents[docId] = text;
      ss(state);
      cloudPush();
      toast('✅ Document uploaded ('+text.length+' chars extracted)');
      loadTab(activeTab);
    } catch(ex) {
      toast('❌ '+ex.message);
    }
  };

  /* ── Per-contract inline upload ────────────────────────────────────────── */
  window.msUploadToContract = async function(contractId, input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    input.value = '';
    toast('⏳ Extracting contract text…');
    try {
      var text = await extractText(file);
      var state = ls(); state._demo = false;
      if (!state.documentContents) state.documentContents = {};
      state.documentContents[contractId] = text;
      ss(state);
      cloudPush();
      toast('✅ Contract file extracted ('+text.length+' chars) — AI Ready');
      loadTab(activeTab);
    } catch(ex) {
      toast('❌ '+ex.message);
    }
  };

  /* ── Users & Roles handlers ────────────────────────────────────────────── */
  window.msRoleChange = function(uid, role) {
    var state=ls(), users=state.users||[];
    var u=users.find(function(x){return x.id===uid;});
    if(u){ u.role=role; u.permissions=permsFor(role); ss(state); }
    var tok=getToken();
    if(tok) fetch('/api/admin/users',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({userId:uid,role:role})}).catch(function(){});
    toast('Role updated → '+role);
  };

  window.msDelUser = function(uid) {
    if(!confirm('Remove this user?')) return;
    var state=ls(); state.users=(state.users||[]).filter(function(u){return u.id!==uid;}); ss(state);
    toast('User removed'); loadTab('users');
  };

  window.msRegister = async function() {
    var email=(document.getElementById('inv-email')||{}).value||'';
    var name =(document.getElementById('inv-name')||{}).value||'';
    var role =(document.getElementById('inv-role')||{}).value||'viewer';
    var dept =(document.getElementById('inv-dept')||{}).value||'General';
    var statusEl=document.getElementById('ms-reg-status');
    if(!email){ toast('Email required'); return; }
    var tmpPass='Tmp@'+Math.random().toString(36).slice(2,8)+'!';
    if(statusEl) statusEl.innerHTML='<span style="color:#94a3b8;font-size:12px">Registering…</span>';
    try {
      var resp=await fetch('/api/trpc/auth.register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{json:{email,name,role,department:dept,password:tmpPass}}])});
      var data=await resp.json();
      var newUser=data?.[0]?.result?.data?.json?.user;
      if(newUser){
        var state=ls(); if(!Array.isArray(state.users)) state.users=[];
        if(!state.users.some(function(u){return u.id===newUser.id;})) state.users.push(Object.assign({},newUser,{department:dept}));
        ss(state);
        if(statusEl) statusEl.innerHTML='<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);padding:10px 14px;border-radius:8px;font-size:12px;color:#4ade80">✅ User registered: '+esc(email)+'<br>Temporary password: <code style="background:#0f172a;padding:2px 6px;border-radius:4px">'+esc(tmpPass)+'</code><br><small style="color:#64748b">Share this password securely. User should change it after first login.</small></div>';
        loadTab('users');
      } else {
        var err=data?.[0]?.error?.json?.message||'Registration failed';
        if(statusEl) statusEl.innerHTML='<div style="color:#fca5a5;font-size:12px">❌ '+esc(err)+'</div>';
      }
    } catch(ex) {
      if(statusEl) statusEl.innerHTML='<div style="color:#fca5a5;font-size:12px">❌ '+esc(ex.message)+'</div>';
    }
  };

  /* ── Document queue upload handlers ───────────────────────────────────── */
  function msAddDocs(files) {
    files.forEach(function(f){
      if(docQueue.some(function(q){return q.n===f.name&&q.sz===f.size;})) return;
      docQueue.push({f:f,n:f.name,sz:f.size,id:'dq_'+uid(),st:'pending'});
    });
    renderDQ();
    var b=document.getElementById('ms-ub'); if(b) b.disabled=docQueue.length===0;
  }
  function renderDQ(){
    var el=document.getElementById('ms-dq'); if(!el) return;
    var icon={pdf:'📕',docx:'📘',txt:'📄'};
    var tagColor={done:'#4ade80',error:'#fca5a5',processing:'#a5b4fc',pending:'#64748b'};
    var tagLabel={done:'✓ Stored',error:'Error',processing:'Extracting…',pending:'Pending'};
    el.innerHTML=docQueue.map(function(item,i){
      var ext=(item.n.split('.').pop()||'').toLowerCase();
      var ic=icon[ext]||'📄';
      var tc=tagColor[item.st]||'#64748b';
      var tl=item.st==='error'?'❌ '+(item.err||'Error'):tagLabel[item.st]||item.st;
      return '<div class="ms-dc">'+
        '<span style="font-size:20px">'+ic+'</span>'+
        '<div style="flex:1;min-width:0"><div class="dn">'+esc(item.n)+'</div><div class="dm">'+Math.round(item.sz/1024)+' KB</div></div>'+
        '<span style="font-size:11px;font-weight:700;color:'+tc+'">'+tl+'</span>'+
        (item.st!=='processing'?'<button style="background:none;border:none;color:#475569;cursor:pointer;font-size:15px;padding:0" onclick="msRemDoc('+i+')">✕</button>':'')+
      '</div>';
    }).join('');
  }
  window.msDocFiles=function(input){ msAddDocs(Array.from(input.files)); input.value=''; };
  window.msRemDoc=function(i){ docQueue.splice(i,1); renderDQ(); var b=document.getElementById('ms-ub'); if(b) b.disabled=docQueue.length===0; };
  window.msClearDocs=function(){ docQueue=[]; renderDQ(); var b=document.getElementById('ms-ub'); if(b) b.disabled=true; };
  window.msUpload=async function(){
    var pid=(document.getElementById('ms-dp')||{}).value||'__unlinked';
    var dt=(document.getElementById('ms-dt')||{}).value||'Contract';
    var btn=document.getElementById('ms-ub');
    if(btn){btn.disabled=true;btn.textContent='⏳ Processing…';}
    for(var i=0;i<docQueue.length;i++){
      var item=docQueue[i]; if(item.st==='done') continue;
      item.st='processing'; renderDQ();
      try{
        var text = await extractText(item.f);
        var state=ls(); state._demo=false;
        if(!state.documentContents) state.documentContents={};
        if(!state.contractDocuments) state.contractDocuments={};
        var docId='doc_'+uid();
        if(!state.contractDocuments[pid]) state.contractDocuments[pid]=[];
        state.contractDocuments[pid].push({id:docId,projectId:pid,title:item.f.name.replace(/\.[^.]+$/,''),type:dt,status:'active',value:0,signedDate:'',expiryDate:'',parties:[],retentionPct:0,notes:'Uploaded '+new Date().toLocaleDateString(),createdAt:new Date().toISOString()});
        state.documentContents[docId]=text;
        ss(state);
        item.st='done';
      } catch(ex){ item.st='error'; item.err=ex.message; }
      renderDQ();
    }
    if(btn){btn.disabled=false;btn.textContent='⬆ Extract & Store All';}
    cloudPush();
    toast('✅ Upload complete');
  };

  /* ── Panel creation ────────────────────────────────────────────────────── */
  function ensurePanel() {
    if(document.getElementById(PID)) { buildPanel(); return; }
    var ov=document.createElement('div'); ov.id=OID;
    ov.onclick=function(e){ if(e.target===ov) msClose(); };
    document.body.appendChild(ov);
    var panel=document.createElement('div'); panel.id=PID;
    document.body.appendChild(panel);
    var t=document.createElement('div'); t.id='ms-toast';
    document.body.appendChild(t);
    buildPanel();
  }

  /* ── Toast ─────────────────────────────────────────────────────────────── */
  function toast(msg){
    var el=document.getElementById('ms-toast');
    if(!el) return;
    el.textContent=msg; el.classList.add('on');
    clearTimeout(el._t); el._t=setTimeout(function(){el.classList.remove('on');},3500);
  }

  /* ── FAB ───────────────────────────────────────────────────────────────── */
  function ensureFAB(){
    if(document.getElementById(BID)) return;
    var b=document.createElement('button'); b.id=BID;
    b.innerHTML='📊 Data Management';
    b.onclick=function(){ ensurePanel(); msOpen(); };
    document.body.appendChild(b);
  }
  function updateFAB(){
    var b=document.getElementById(BID); if(!b) return;
    b.classList.toggle('off',!isLoggedIn());
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  function init(){
    injectCSS();
    ensureFAB();
    updateFAB();
    window.addEventListener('storage',function(e){ if(e.key&&e.key.indexOf('mashrooth')!==-1) updateFAB(); });
    var obs=new MutationObserver(updateFAB);
    obs.observe(document.body,{childList:true,subtree:false});
    setInterval(updateFAB,4000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
