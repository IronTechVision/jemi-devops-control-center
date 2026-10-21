(() => {
  'use strict';
  if (window.__jemi) return;            // never register timers/listeners twice
  window.__jemi = true;

  const VERSION = '0.2.0';
  // Set a URL to switch an integration on. Each must return a JSON array (see the setup panels). null = not configured.
  const CFG = Object.assign({ metrics: '/api/metrics', health: '/api/health', interval: 5000, timeout: 4000, cap: 120, auto: true,
    endpoints: { docker: null, deployments: null, incidents: '/api/incidents', github: null } }, window.JEMI_CONFIG || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NA = 'N/A';
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const pct = v => num(v) === null ? NA : v.toFixed(1) + '%';
  const hhmmss = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtB = b => {
    if (num(b) === null) return NA;
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (b >= 1024 && i < 4) { b /= 1024; i++; }
    return b.toFixed(i ? 1 : 0) + ' ' + u[i];
  };
  const set = (k, t) => $$(`[data-f="${k}"]`).forEach(e => { e.textContent = t; });
  const attr = (sel, a, v) => $$(sel).forEach(e => e.setAttribute(a, v));
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const S = { hist: { cpu: [], mem: [], disk: [] }, net: null, last: null, data: {}, int: {}, hok: null, mok: null, ok: false, busy: false, queued: false, timer: null };

  /* ---------- API layer ---------- */
  async function getJson(url) {
    const ac = new AbortController(), t0 = performance.now();
    const to = setTimeout(() => ac.abort(), CFG.timeout);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal, headers: { Accept: 'application/json' } });
      const ms = Math.round(performance.now() - t0);
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      let data;
      try { data = await r.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: r.status }); }
      return { data, status: r.status, ms };
    } catch (e) {
      throw e.name === 'AbortError' ? new Error('Timeout') : e;
    } finally { clearTimeout(to); }
  }

  /* ---------- connection state ---------- */
  function setConn(state, text) {
    attr('[data-conn]', 'data-conn', state);
    set('conn', text);
    set('last', S.last ? hhmmss(S.last) : NA);
  }

  /* ---------- metrics ---------- */
  const push = (k, t, v) => {
    const a = S.hist[k];
    if (num(v) === null || (a.length && a[a.length - 1].t >= t)) return false;
    a.push({ t, v }); if (a.length > CFG.cap) a.shift();
    return true;
  };
  function ring(k, v) {
    const el = $(`[data-ring="${k}"]`);
    el.style.setProperty('--p', num(v) === null ? 0 : Math.max(0, Math.min(100, v)));
    el.dataset.level = num(v) === null ? '' : v >= 90 ? 'bad' : v >= 75 ? 'warn' : '';
  }
  function applyMetrics(d) {
    if (!d || typeof d !== 'object') throw new Error('Unexpected metrics format');
    const ts = Date.parse(d.timestamp), t = isNaN(ts) ? Date.now() : ts, when = hhmmss(t);
    const cpu = d.cpu || {}, mem = d.memory || {}, disk = d.disk || {}, net = d.network || {};
    const fresh = [push('cpu', t, cpu.usage_percent), push('mem', t, mem.usage_percent), push('disk', t, disk.usage_percent)];
    S.last = Date.now(); S.ok = true;

    [['cpu', cpu.usage_percent], ['mem', mem.usage_percent], ['disk', disk.usage_percent]].forEach(([k, v]) => {
      set(k, pct(v)); ring(k, v); set(k + '-ts', when);
    });
    set('cpu-sub', num(cpu.logical_cores) === null ? NA : cpu.logical_cores + ' logical cores');
    set('mem-sub', `${fmtB(mem.used_bytes)} used / ${fmtB(mem.total_bytes)}`);
    set('disk-sub', `${fmtB(disk.used_bytes)} used / ${fmtB(disk.total_bytes)}`);

    set('sent', fmtB(net.bytes_sent)); set('recv', fmtB(net.bytes_received)); set('net-ts', when);
    const sent = num(net.bytes_sent), recv = num(net.bytes_received);
    if (sent !== null && recv !== null) {
      const p = S.net, dt = p ? (t - p.t) / 1000 : 0;
      if (p && dt > 0 && sent >= p.sent && recv >= p.recv) {       // reject counter resets
        set('up', fmtB((sent - p.sent) / dt) + '/s'); set('down', fmtB((recv - p.recv) / dt) + '/s');
      }
      S.net = { t, sent, recv };
    }
    set('host', d.host ?? NA); set('os', d.platform ?? NA);
    set('cores', num(cpu.logical_cores) === null ? NA : String(cpu.logical_cores));
    set('memtotal', fmtB(mem.total_bytes)); set('disktotal', fmtB(disk.total_bytes));
    set('stamp', isNaN(ts) ? NA : new Date(ts).toLocaleString());
    [['cpu', cpu.usage_percent], ['mem', mem.usage_percent], ['disk', disk.usage_percent]].forEach(([k, v]) => chk(k, v));
    setConn('online', 'Backend connected');
    if (fresh.some(Boolean)) redraw();
  }
  function metricsFailed(e) {
    if (S.ok) { setConn('stale', 'Refresh failed'); return; }          // keep last valid data on screen
    setConn('offline', 'Backend unavailable');
    ['cpu', 'mem', 'disk'].forEach(k => { set(k + '-sub', 'Unavailable: ' + e.message); });
    set('net-ts', 'Unavailable');
  }

  /* ---------- health ---------- */
  function applyHealth(res) {
    const box = $('.hbox'), setH = (s, a, b) => { box.dataset.hstate = s; set('hstatus', a); set('hmsg', b); };
    set('hlast', hhmmss(Date.now()));
    if (res.status === 'fulfilled') {
      const { data, status, ms } = res.value, label = data && typeof data.status === 'string' ? data.status : null;
      set('hhttp', String(status)); set('hms', ms + ' ms');
      const good = !label || ['ok', 'healthy', 'up'].includes(label.toLowerCase());
      setH(good ? 'ok' : 'warn', good ? 'Healthy' : label, good ? 'Backend is responding' : 'Backend reports a non-OK status');
    } else {
      set('hhttp', res.reason.status ? String(res.reason.status) : NA); set('hms', NA);
      setH('bad', 'Unreachable', res.reason.message);
    }
  }

  /* ---------- charts (native canvas) ---------- */
  function plot(cv, pts, big) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const L = big ? 38 : 2, B = big ? 20 : 2, T = 6, pw = w - L - 4, ph = h - B - T;
    const Y = v => T + ph - (v / 100) * ph;
    if (big) {
      x.font = '11px Segoe UI, sans-serif'; x.fillStyle = css('--mu'); x.strokeStyle = 'rgba(139,92,246,.15)'; x.textAlign = 'right';
      [0, 25, 50, 75, 100].forEach(v => { x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(w - 2, Y(v)); x.stroke(); x.fillText(v + '%', L - 6, Y(v) + 4); });
    }
    if (pts.length < 2) return;
    const t0 = pts[0].t, span = Math.max(pts[pts.length - 1].t - t0, 1), X = t => L + ((t - t0) / span) * pw;
    const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, css('--vi')); g.addColorStop(1, css('--bl'));
    x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p.t), Y(p.v)) : x.moveTo(X(p.t), Y(p.v)));
    x.strokeStyle = g; x.lineWidth = 2; x.stroke();
    x.lineTo(X(pts[pts.length - 1].t), Y(0)); x.lineTo(X(t0), Y(0)); x.closePath();
    const f = x.createLinearGradient(0, T, 0, T + ph); f.addColorStop(0, 'rgba(139,92,246,.35)'); f.addColorStop(1, 'rgba(59,130,246,0)');
    x.fillStyle = f; x.fill();
    if (big) {
      x.fillStyle = css('--mu'); x.textAlign = 'center';
      [0, .5, 1].forEach(f2 => x.fillText(hhmmss(t0 + span * f2).slice(0, 8), Math.min(Math.max(L + pw * f2, L + 22), w - 26), h - 4));
    }
  }
  let raf = 0;
  function redraw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      $$('[data-chart]').forEach(c => { const k = c.dataset.chart; plot(c, S.hist[k], true); $(`[data-empty="${k}"]`).hidden = S.hist[k].length >= 2; });
      $$('[data-spark]').forEach(c => plot(c, S.hist[c.dataset.spark], false));
    });
  }

  /* ---------- integrations, tables, details ---------- */
  const tri = v => v === null ? 'Unknown' : v ? 'Connected' : 'Disconnected';
  const stat = k => k === 'backend' ? tri(S.hok) : k === 'metrics' ? tri(S.mok) : !CFG.endpoints[k] ? 'Not configured' : S.int[k] || 'Unknown';
  const tone = v => ({ success: 'ok', passed: 'ok', running: 'ok', up: 'ok', healthy: 'ok', resolved: 'ok', active: 'warn', warning: 'warn', in_progress: 'warn', queued: 'warn', starting: 'warn', failed: 'bad', failure: 'bad', critical: 'bad', unhealthy: 'bad', exited: 'bad', stopped: 'bad' }[String(v).toLowerCase()] || '');
  const fdate = v => isNaN(Date.parse(v)) ? String(v) : new Date(v).toLocaleString();
  const fdur = sec => { sec = Math.round(Number(sec)); if (!isFinite(sec) || sec < 0) return NA; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + 'h ' : '') + (m || h ? m + 'm ' : '') + x + 's'; };
  const durOf = r => { const a = Date.parse(r.detected), e = r.resolved ? Date.parse(r.resolved) : Date.now(); return isNaN(a) || isNaN(e) ? undefined : fdur((e - a) / 1000); };
  const decorate = (k, r) => k === 'docker' ? { ...r, _b: String(r.health).toLowerCase() === 'unhealthy' ? 'unhealthy' : ['running', 'up'].includes(String(r.state).toLowerCase()) ? 'running' : 'stopped' } : k === 'incidents' ? { ...r, _dur: durOf(r) } : r;
  const short = n => v => String(v).slice(0, n);
  const TABLES = {
    docker: [['name'], ['image'], ['id', short(12)], ['state', 'b'], ['health', 'b'], ['uptime'], ['cpu_percent', pct], ['memory_percent', pct]],
    deployments: [['version'], ['branch'], ['commit', short(7)], ['environment'], ['build_status', 'b'], ['deploy_status', 'b'], ['time', fdate], ['url', 'l']],
    incidents: [['severity', 'b'], ['title'], ['service'], ['status', 'b'], ['detected', fdate], ['_dur'], ['url', 'l']],
    github: [['workflow'], ['branch'], ['commit', short(7)], ['event'], ['status', 'b'], ['started', fdate], ['duration_s', fdur], ['url', 'l']]
  };
  function td(row, [k, f]) {
    const c = document.createElement('td'), v = row[k];
    if (v === undefined || v === null || v === '') { c.textContent = NA; return c; }
    if (f === 'b') { const b = document.createElement('span'); b.className = 'b ' + tone(v); b.textContent = String(v); c.append(b); }
    else if (f === 'l') {
      if (/^https:\/\//.test(v)) { const a = document.createElement('a'); a.href = v; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open'; a.addEventListener('click', e => e.stopPropagation()); c.append(a); } else c.textContent = NA;
    } else c.textContent = f ? f(v) : String(v);
    return c;
  }
  function showDetail(key, r) {
    const box = $(`[data-detail="${key}"] [data-dbody]`); if (!box) return;
    box.replaceChildren();
    const dl = document.createElement('dl'), extra = []; dl.className = 'info';
    Object.entries(r).forEach(([k, v]) => {
      if (k.startsWith('_') || v === null || v === undefined) return;
      if (typeof v === 'object') { extra.push([k, Array.isArray(v) ? v.map(String).join('\n') : JSON.stringify(v, null, 1)]); return; }
      const d = document.createElement('div'), a = document.createElement('dt'), b = document.createElement('dd');
      a.textContent = k.replace(/_/g, ' '); b.textContent = String(v); d.append(a, b); dl.append(d);
    });
    box.append(dl);
    extra.forEach(([k, t]) => { const h = document.createElement('h4'), p = document.createElement('pre'); h.textContent = k.replace(/_/g, ' '); p.textContent = t; box.append(h, p); });
  }
  function renderTable(key) {
    const body = $(`[data-body="${key}"]`), nd = $(`[data-nodata="${key}"]`), tb = $(`[data-tb="${key}"]`);
    const all = (S.data[key] || []).map(r => decorate(key, r));
    $$('select[data-dyn]', tb).forEach(sel => {
      const cur = sel.value, vals = [...new Set(all.map(r => r[sel.dataset.key]).filter(Boolean).map(String))].sort();
      sel.replaceChildren(new Option(sel.dataset.label, 'all'), ...vals.map(v => new Option(v, v.toLowerCase())));
      sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
    });
    const q = $('[data-q]', tb).value.trim().toLowerCase(), sels = $$('select', tb);
    const rows = all.filter(r => (!q || JSON.stringify(Object.values(r)).toLowerCase().includes(q)) && sels.every(x => x.value === 'all' || String(r[x.dataset.key]).toLowerCase() === x.value));
    body.replaceChildren(...rows.map(r => {
      const tr = document.createElement('tr'); tr.tabIndex = 0;
      TABLES[key].forEach(c => tr.append(td(r, c)));
      const pick = () => { $$('tr', body).forEach(x => x.removeAttribute('aria-selected')); tr.setAttribute('aria-selected', 'true'); showDetail(key, r); };
      tr.addEventListener('click', pick); tr.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
      return tr;
    }));
    nd.hidden = rows.length > 0;
    nd.textContent = S.data[key] ? (all.length ? 'No records match the current search or filters.' : 'The source is connected but returned no records.')
      : CFG.endpoints[key] ? 'The configured source cannot be reached right now.' : nd.dataset.def;
  }
  const FLOW = { success: 'passed', passed: 'passed', failure: 'failed', failed: 'failed', running: 'running', in_progress: 'running', queued: 'waiting', pending: 'waiting' };
  function applyFlow(name, stages) {
    if (!stages || typeof stages !== 'object') return;
    $$(`[data-flow="${name}"] .node`).forEach(n => { const v = String(stages[n.dataset.key] || '').toLowerCase(); n.dataset.state = FLOW[v] || 'notconfigured'; $('small', n).textContent = v ? v.replace('_', ' ') : 'Not reported'; });
  }
  function renderStats() {
    const D = S.data, n = (a, f) => String(a.filter(f).length), lc = v => String(v).toLowerCase();
    const latest = a => [...a].sort((x, y) => (Date.parse(y.time || y.started || y.detected) || 0) - (Date.parse(x.time || x.started || x.detected) || 0))[0] || {};
    if (D.docker) { const a = D.docker.map(r => decorate('docker', r)); set('d-total', String(a.length)); set('d-run', n(a, r => r._b === 'running')); set('d-stop', n(a, r => r._b === 'stopped')); set('d-bad', n(a, r => r._b === 'unhealthy')); }
    if (D.deployments) { const a = D.deployments, l = latest(a); set('p-latest', l.deploy_status ?? NA); set('p-build', l.build_status ?? NA); set('p-ok', n(a, r => lc(r.deploy_status) === 'success')); set('p-fail', n(a, r => lc(r.deploy_status) === 'failed')); set('p-env', l.environment ?? NA); set('p-rel', l.version ?? NA); applyFlow('deploy', l.stages); }
    if (D.incidents) { const a = D.incidents, act = a.filter(r => lc(r.status) !== 'resolved'); set('i-active', String(act.length)); set('i-crit', n(act, r => lc(r.severity) === 'critical')); set('i-warn', n(act, r => lc(r.severity) === 'warning')); set('i-res', n(a, r => lc(r.status) === 'resolved')); }
    if (D.github) { const a = D.github, l = latest(a), ok = latest(a.filter(r => lc(r.status) === 'success')); set('g-repo', l.repo ?? NA); set('g-branch', l.branch ?? NA); set('g-latest', l.status ?? NA); set('g-ok', ok.started ? fdate(ok.started) : NA); set('g-fail', n(a, r => ['failure', 'failed'].includes(lc(r.status)))); applyFlow('github', l.stages); }
    set('g-conn', stat('github'));
  }
  function renderIntegrations() {
    ['backend', 'metrics', 'docker', 'deployments', 'incidents', 'github'].forEach(k => {
      const s = stat(k), id = s.toLowerCase().replace(' ', '');
      $$(`[data-cs="${k}"],[data-nav="${k}"]`).forEach(e => { e.dataset.s = id; if (e.dataset.cs) e.textContent = s; e.title = s; });
      $$(`[data-integ="${k}"]`).forEach(e => { e.dataset.s = id; e.textContent = s === 'Not configured' ? e.dataset.off : s.toUpperCase(); });
    });
    $$('[data-flow=docker] .node').forEach(n => {
      const k = n.dataset.key, s = k === 'browser' ? 'Running' : stat(k === 'flask' ? 'backend' : 'docker');
      n.dataset.state = s === 'Running' || s === 'Connected' ? 'passed' : s === 'Disconnected' ? 'failed' : 'notconfigured'; $('small', n).textContent = s;
    });
  }
  const chk = (k, v) => {
    const e = $(`[data-chk="${k}"]`), x = num(v); if (!e) return;
    e.dataset.s = x === null ? 'na' : x >= 90 ? 'bad' : x >= 75 ? 'warn' : 'ok';
    e.textContent = x === null ? NA : x >= 90 ? 'Critical' : x >= 75 ? 'Warning' : 'Within limits';
    set('chk-' + k, pct(v));
  };
  function renderAll() {
    renderIntegrations(); renderStats(); Object.keys(TABLES).forEach(renderTable);
    set('dver', VERSION); set('dua', navigator.userAgent);
    set('dlast', S.last ? new Date(S.last).toLocaleString() : NA); set('dint', CFG.auto ? CFG.interval / 1000 + ' s' : 'Manual only');
  }

  /* ---------- preferences (localStorage, no secrets) ---------- */
  const PREF_DEF = { accent: 'violet', density: 'comfortable', motion: false, auto: true, interval: 5, hist: 120 };
  const OK = { accent: ['violet', 'blue', 'cyan'], density: ['comfortable', 'compact'], interval: [5, 10, 30], hist: [30, 60, 120] };
  const ACC = { violet: '#8B5CF6', blue: '#3B82F6', cyan: '#22D3EE' };
  const valid = (k, v) => k in OK ? OK[k].includes(v) : typeof v === 'boolean';
  const prefs = { ...PREF_DEF, motion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  try { const sv = JSON.parse(localStorage.getItem('jemi.prefs')); if (sv && typeof sv === 'object') Object.keys(PREF_DEF).forEach(k => { if (valid(k, sv[k])) prefs[k] = sv[k]; }); } catch { /* storage unavailable */ }
  function applyPrefs() {
    document.documentElement.style.setProperty('--vi', ACC[prefs.accent]);
    document.body.classList.toggle('compact', prefs.density === 'compact');
    document.body.classList.toggle('reduce', prefs.motion);
    CFG.interval = prefs.interval * 1000; CFG.cap = prefs.hist; CFG.auto = prefs.auto;
    Object.keys(S.hist).forEach(k => { S.hist[k] = S.hist[k].slice(-CFG.cap); });
    $$('[data-pref]').forEach(el => {
      const k = el.dataset.pref;
      if (el.tagName === 'SELECT') el.value = String(prefs[k]);
      else if (el.getAttribute('role') === 'switch') el.setAttribute('aria-checked', String(prefs[k]));
      else el.setAttribute('aria-pressed', String(String(prefs[k]) === el.dataset.val));
    });
    set('interval', `every ${CFG.interval / 1000}s · last ${Math.round(CFG.cap * CFG.interval / 60000)} min max`);
    set('dint', CFG.auto ? CFG.interval / 1000 + ' s' : 'Manual only'); redraw();
  }
  function setPref(k, v) {
    if (!valid(k, v)) return;
    prefs[k] = v; try { localStorage.setItem('jemi.prefs', JSON.stringify(prefs)); } catch { /* ignore */ }
    applyPrefs();
    if (k === 'auto' && v) poll(); else if (k === 'auto' || k === 'interval') { clearTimeout(S.timer); if (!S.busy && CFG.auto) S.timer = setTimeout(poll, CFG.interval); }
  }
  const diag = () => ['JEMI DevOps Control Center v' + VERSION, 'Time: ' + new Date().toISOString(), 'Browser: ' + navigator.userAgent,
    'Last metrics update: ' + (S.last ? new Date(S.last).toISOString() : 'N/A'), 'Refresh: ' + (CFG.auto ? CFG.interval / 1000 + ' s' : 'manual'), 'History: ' + CFG.cap + ' samples',
    ...['backend', 'metrics', 'docker', 'deployments', 'incidents', 'github'].map(k => k + ': ' + stat(k))].join('\n');
  function initUI() {
    applyPrefs(); renderAll();
    $$('[data-tb]').forEach(tb => { const k = tb.dataset.tb; tb.addEventListener('input', () => renderTable(k)); tb.addEventListener('change', () => renderTable(k)); });
    $$('[data-act=refresh]').forEach(b => b.addEventListener('click', poll));
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-pref]');
      if (el && el.tagName !== 'SELECT') { const k = el.dataset.pref; setPref(k, el.getAttribute('role') === 'switch' ? !prefs[k] : el.dataset.val); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) {
        const txt = cp.dataset.copy === 'diag' ? diag() : $(cp.dataset.copy).textContent, old = cp.textContent;
        const flash = m => { cp.textContent = m; setTimeout(() => { cp.textContent = old; }, 1500); };
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => flash('Copied'), () => flash('Copy failed'));
      }
    });
    document.addEventListener('change', e => { const el = e.target.closest('select[data-pref]'); if (el) setPref(el.dataset.pref, +el.value); });
  }

  /* ---------- polling (never overlaps) ---------- */
  async function poll() {
    if (S.busy) { S.queued = true; return; }
    S.busy = true; clearTimeout(S.timer);
    const b = $('#refresh'); b.disabled = true; b.classList.add('busy');
    const ext = Object.entries(CFG.endpoints).filter(([, u]) => u);
    const [m, h, ...xs] = await Promise.allSettled([getJson(CFG.metrics), getJson(CFG.health), ...ext.map(([, u]) => getJson(u))]);
    xs.forEach((r, i) => {
      const k = ext[i][0];
      if (r.status === 'fulfilled' && Array.isArray(r.value.data)) { S.data[k] = r.value.data; S.int[k] = 'Connected'; } else S.int[k] = 'Disconnected';
    });
    try {
      if (m.status === 'fulfilled') applyMetrics(m.value.data); else metricsFailed(m.reason);
    } catch (e) { metricsFailed(e); }
    applyHealth(h); S.hok = h.status === 'fulfilled'; S.mok = m.status === 'fulfilled'; renderAll();
    b.disabled = false; b.classList.remove('busy');
    S.busy = false;
    if (S.queued || CFG.auto) S.timer = setTimeout(poll, S.queued ? 0 : CFG.interval); S.queued = false;
  }

  /* ---------- UI wiring ---------- */
  function init() {
    set('interval', `every ${CFG.interval / 1000}s · last ${Math.round(CFG.cap * CFG.interval / 60000)} min max`);
    set('poll', `${CFG.interval / 1000} s`); set('cap', `${CFG.cap} samples`);
    const tick = () => { const n = new Date(); $('#clock').textContent = n.toLocaleTimeString([], { hour12: false }); $('#date').textContent = n.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }); };
    tick(); setInterval(tick, 1000);

    $('#refresh').addEventListener('click', poll);
    const menu = $('#menu'), nav = open => { document.body.classList.toggle('nav-open', open); menu.setAttribute('aria-expanded', String(open)); };
    menu.addEventListener('click', () => nav(!document.body.classList.contains('nav-open')));
    $('#scrim').addEventListener('click', () => nav(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') nav(false); });
    $$('.nav a').forEach(a => a.addEventListener('click', () => nav(false)));

    const PAGES = ['overview', 'monitoring', 'health', 'docker', 'deploy', 'incidents', 'pipeline', 'settings'];
    const links = $$('.nav a'), tagline = $('#sub').textContent;
    const route = () => {                                   // one page at a time, no backend route needed
      const h = location.hash.slice(1), page = PAGES.includes(h) ? h : 'overview';
      document.body.dataset.page = page;
      $$('[data-view]').forEach(e => { e.hidden = !e.dataset.view.split(' ').includes(page); });
      links.forEach(l => { if (l.getAttribute('href') === '#' + page) { l.setAttribute('aria-current', 'true'); $('#sub').textContent = page === 'overview' ? tagline : $('.lb', l).textContent.toUpperCase(); } else l.removeAttribute('aria-current'); });
      window.scrollTo(0, 0); redraw();
    };
    window.addEventListener('hashchange', route); route();

    const ro = new ResizeObserver(redraw); $$('[data-chart],[data-spark]').forEach(c => ro.observe(c));
    initUI(); redraw(); poll();
  }
  init();
})();