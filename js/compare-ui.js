/* compare-ui.js — explicit pin / compare controls. Comparison work lives in its own stoppable worker. */
(function (root) {
  'use strict';
  const RF = root.RF, el = (...a) => RF.Panels.el(...a), C = RF.Compare, cache = RF.SolveCache;
  let A = null, worker = null, serial = 0, inputKey = null, result = null, ui, restored = false, pinError = '';
  const id = (s) => document.getElementById(s);
  const text = (s) => { id('ab-status').textContent = s; };
  const currentKey = () => RF.History.key(C.snapshot(ui.store.scene));
  function embed() {
    delete ui.store.scene.compareA;
    if (A && C.pinSize(A) <= C.PIN_BYTES) ui.store.scene.compareA = { version: 1, scene: C.snapshot(A) };
  }
  function cancel() { serial++; if (worker) worker.terminate(); worker = null; id('ab-stop').hidden = true; }
  async function persist() {
    embed(); ui.autosave();
    try { await cache.pin(A); pinError = ''; refresh(ui); return true; }
    catch (e) { pinError = ' Browser pin save failed: ' + e.message; text((A ? 'A is available this session.' : 'A cleared for this session.') + pinError); refresh(ui); return false; }
  }
  async function pin() {
    cancel(); A = C.snapshot(ui.store.scene); result = null; inputKey = null;
    const small = C.pinSize(A) <= C.PIN_BYTES;
    text('A pinned from current geometry' + (ui.store.dirty.has('A') ? ' (current reflector is marked out of date)' : '') + '. ' + (small ? 'Included in scene JSON (≤256 KiB).' : 'Browser only: exceeds 256 KiB; omitted from scene JSON.'));
    refresh(ui); await persist();
  }
  async function unpin() { cancel(); A = null; result = null; inputKey = null; id('ab-dialog').close(); text('A cleared.'); refresh(ui); await persist(); }
  function imported(scene) {
    const p = scene.compareA; if (!p) return null;
    if (p.version !== 1 || !p.scene || C.pinSize(p.scene) > C.PIN_BYTES) throw new Error('invalid or oversized pinned A (limit 256 KiB)');
    return C.snapshot(RF.State.deserialize(C.snapshot(p.scene)));
  }
  function loaded() {
    if (!ui || !restored) return;
    cancel(); result = null; inputKey = null;
    try { A = imported(ui.store.scene); text(A ? 'Loaded pinned A from scene JSON.' : 'This scene has no pinned A.'); }
    catch (e) { A = null; text('Pinned A could not load: ' + e.message); }
    persist(); refresh(ui);
  }
  const LABELS = { lmWindow: 'lm in common window', peakCd: 'Peak cd (spec kernel)', reachRightM: '5 lx reach right (m)', reachLeftM: '5 lx reach left (m)', coreWidthDeg: '¼-peak core width (°)', coreHeightDeg: '¼-peak core height (°)', fidelity: 'Paint fidelity (own painting)' };
  function label(metric) {
    if (LABELS[metric]) return LABELS[metric];
    const dot = metric.lastIndexOf('.'), name = metric.slice(0, dot).replace(/^scene:/, ''), p = RF.Spec.PRESETS[name];
    return (p ? p.label : name) + ' · ' + metric.slice(dot + 1);
  }
  const fmt = (v) => v === null || v === undefined ? '—' : typeof v === 'number' ? Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—' : String(v);
  function table(r) {
    const t = id('ab-table'); t.replaceChildren(el('thead', {}, el('tr', {}, ...['Metric', 'A', 'B', 'B − A'].map((s) => el('th', {}, s)))));
    const body = el('tbody');
    for (const row of r.diff) {
      const changed = row.a !== row.b, delta = row.delta, symbol = delta === null ? changed ? '≠' : '=' : delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : '= ';
      body.append(el('tr', { class: changed ? delta < 0 ? 'ab-down' : 'ab-up' : '' }, el('th', {}, label(row.metric)), el('td', {}, fmt(row.a)), el('td', {}, fmt(row.b)), el('td', {}, symbol + (delta === null ? '' : fmt(delta)))));
    }
    t.append(body);
  }
  const CIV = [[0, 32, 77], [49, 68, 107], [102, 105, 112], [149, 143, 120], [203, 186, 105], [255, 234, 70]];
  function drawMap(canvas, m, top) {
    canvas.width = m.nh; canvas.height = m.nv;
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(m.nh, m.nv);
    for (let j = 0; j < m.nv; j++) for (let i = 0; i < m.nh; i++) {
      const v = m.cd[j * m.nh + i], x = Math.sqrt(Math.max(0, Math.min(1, v / (top || 1)))) * (CIV.length - 1), k = Math.min(CIV.length - 2, Math.floor(x)), f = x - k, q = ((m.nv - 1 - j) * m.nh + i) * 4;
      for (let n = 0; n < 3; n++) img.data[q + n] = Number.isFinite(v) ? Math.round(CIV[k][n] + (CIV[k + 1][n] - CIV[k][n]) * f) : 96;
      img.data[q + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function view() {
    const v = id('ab-view').value;
    for (const k of ['a', 'b']) id('ab-figure-' + k).hidden = v !== 'both' && v !== k;
    id('ab-maps').classList.toggle('single', v !== 'both');
  }
  function compare() {
    if (!A) return;
    const dialog = id('ab-dialog'); if (!dialog.open) dialog.showModal();
    cancel(); result = null; id('ab-table').replaceChildren(); id('ab-maps').hidden = true;
    const sc = C.snapshot(ui.store.scene), key = currentKey(), preset = id('ab-spec').value, N = +id('ab-rays').value, seq = serial;
    const options = { rays: N, specs: preset ? [preset] : undefined };
    try { C.setup(A, sc, options); } catch (e) { text(e.message); return; }
    text('Comparing saved geometry…'); id('ab-stop').hidden = false;
    try { worker = new Worker('js/compare-worker.js'); } catch (e) { text('Comparison worker unavailable: ' + e.message); id('ab-stop').hidden = true; return; }
    worker.onerror = (e) => { if (seq !== serial) return; text('Comparison failed: ' + (e.message || 'worker error')); cancel(); };
    worker.onmessage = (e) => {
      if (seq !== serial) return;
      const d = e.data; cancel();
      if (d.error) { text('Comparison failed: ' + d.error); return; }
      result = d.result; inputKey = key;
      table(result); id('ab-maps').hidden = false;
      drawMap(id('ab-map-a'), result.maps.a, result.maps.top); drawMap(id('ab-map-b'), result.maps.b, result.maps.top); view();
      const m = result.maps.a;
      id('ab-scale').textContent = 'Shared cividis scale: 0–' + fmt(result.maps.top) + ' cd, √(cd/top). H ' + fmt(m.h0) + '…' + fmt(m.h0 + m.nh * m.step) + '°, V ' + fmt(m.v0) + '…' + fmt(m.v0 + m.nv * m.step) + '° (up at top). Grey = outside traced window after aim.';
      text('Compared ' + result.rays.toLocaleString() + ' rays each; seed ' + result.seed + ', ' + result.bounces + ' bounces. ' + (key !== currentKey() ? 'B changed while comparing — refresh.' : ''));
      id('ab-rules').textContent = result.measuring + '. ' + result.specs.map((n) => n + ': A aim ' + result.a.specs[n].aim.note + '; B aim ' + result.b.specs[n].aim.note).join(' · ');
    };
    worker.postMessage({ a: A, b: sc, options });
  }
  function refresh(u) {
    if (!ui || !id('ab-open')) return;
    id('ab-open').disabled = id('ab-unpin').disabled = !A;
    id('ab-pin').textContent = A ? 'Replace A' : 'Pin as A';
    id('ab-pin-note').textContent = A ? C.pinSize(A) <= C.PIN_BYTES ? 'A pinned · included in JSON' : 'A pinned · browser only (>256 KiB)' : '';
    if (pinError) id('ab-pin-note').textContent += pinError;
    const rep = u.store.reports.A;
    id('ab-cache-status').textContent = rep && rep.fromCache ? 'From cache — saved surfaces; trace statistics are recomputed.' : cache.status();
    if (result && inputKey !== currentKey()) text('B changed — displayed comparison is out of date. Refresh comparison.');
  }
  async function init(u) {
    ui = u;
    const bar = el('div', { class: 'ab-tools' }), pinBtn = el('button', { id: 'ab-pin', type: 'button', disabled: true }, 'Pin as A'), openBtn = el('button', { id: 'ab-open', type: 'button', disabled: true }, 'Compare A/B'), unpinBtn = el('button', { id: 'ab-unpin', type: 'button', disabled: true }, 'Unpin A');
    const prefs = el('details', {}, el('summary', {}, 'Solve cache'));
    const enabled = el('input', { id: 'ab-cache', type: 'checkbox' }), timed = el('input', { id: 'ab-cache-timed', type: 'checkbox' }); enabled.checked = cache.enabled(); timed.checked = cache.timedEnabled();
    const force = el('button', { id: 'ab-resolve', type: 'button' }, 'Re-solve anyway'), clear = el('button', { id: 'ab-cache-clear', type: 'button' }, 'Clear solve cache');
    prefs.append(el('label', {}, enabled, ' Reuse identical solves in this browser'), el('label', {}, timed, ' Also cache time-dependent / uncertain solvers (all worker solvers)'), el('p', { class: 'note' }, 'All worker solvers require the second opt-in: source inspection cannot prove that a helper never uses a clock. Page solvers with clock, random, budget or delegation references also count as uncertain (including progress-only clocks). Cached surfaces: at most 40 entries / 32 MiB; least recently used removed first. Preferences apply in this browser immediately.'), force, clear);
    bar.append(pinBtn, openBtn, unpinBtn, el('span', { id: 'ab-pin-note', role: 'status' }), prefs, el('span', { id: 'ab-cache-status', role: 'status' })); document.querySelector('.result-pane > .pane-head').append(bar);
    const spec = el('select', { id: 'ab-spec', 'aria-label': 'Comparison preset' }, el('option', { value: '' }, 'B’s saved spec'), ...Object.entries(RF.Spec.PRESETS).map(([k, p]) => el('option', { value: k }, p.label)));
    const rays = el('input', { id: 'ab-rays', type: 'number', value: 300000, min: 100, max: 20000000, step: 10000, 'aria-label': 'Comparison rays' });
    const refreshBtn = el('button', { type: 'button', id: 'ab-refresh' }, 'Refresh comparison'), stop = el('button', { type: 'button', id: 'ab-stop', hidden: true }, 'Stop comparison'), close = el('button', { type: 'button', id: 'ab-close' }, 'Close');
    const mode = el('select', { id: 'ab-view', 'aria-label': 'Comparison view' }, el('option', { value: 'both' }, 'Side by side'), el('option', { value: 'a' }, 'A only'), el('option', { value: 'b' }, 'B only'));
    const maps = el('div', { id: 'ab-maps', hidden: true }, ...['a', 'b'].map((k) => el('figure', { id: 'ab-figure-' + k }, el('figcaption', {}, k.toUpperCase() + (k === 'a' ? ' · pinned' : ' · current at comparison')), el('canvas', { id: 'ab-map-' + k, 'aria-label': k.toUpperCase() + ' far field' }))));
    const dialog = el('dialog', { id: 'ab-dialog', 'aria-label': 'A/B comparison' }, el('h2', {}, 'A/B comparison'), el('div', { class: 'ab-controls' }, el('label', {}, 'Preset ', spec), el('label', {}, 'Rays each ', rays), refreshBtn, stop, mode, close), el('p', { id: 'ab-status', role: 'status' }), maps, el('p', { id: 'ab-scale', class: 'note' }), el('p', { id: 'ab-rules', class: 'note' }), el('table', { id: 'ab-table' }));
    document.body.append(dialog);
    pinBtn.onclick = pin; openBtn.onclick = compare; unpinBtn.onclick = unpin; refreshBtn.onclick = compare; close.onclick = () => dialog.close(); dialog.onclose = () => { if (worker) { cancel(); text('Comparison stopped.'); } }; stop.onclick = () => { cancel(); text('Comparison stopped; press Refresh to run again.'); };
    mode.onchange = view;
    for (const input of [rays, spec]) input.onchange = () => text('Comparison settings changed — refresh to apply.');
    enabled.onchange = () => { cache.setEnabled(enabled.checked); refresh(ui); }; timed.onchange = () => { cache.setTimed(timed.checked); refresh(ui); };
    force.onclick = () => { if (cache.enabled()) cache.bypass(); ui.generateA(); };
    clear.onclick = async () => { try { await cache.clear(); id('ab-cache-status').textContent = 'Solve cache cleared.'; } catch (e) { id('ab-cache-status').textContent = 'Could not clear cache: ' + e.message; } };
    const scene = ui.store.scene;
    let record;
    try { record = await cache.pinned(); } catch (e) { if (scene.compareA) pinError = ' Browser pin recovery unavailable: ' + e.message; }
    try { let saved = record ? record.version === 1 ? record.scene : record : imported(scene); if (saved) saved = C.snapshot(RF.State.deserialize(C.snapshot(saved))); if (scene !== ui.store.scene) { restored = true; pinBtn.disabled = false; loaded(); return; } A = saved || null; embed(); text(A ? 'Pinned A restored in this browser. ' + (C.pinSize(A) <= C.PIN_BYTES ? 'Included in scene JSON.' : 'Browser only: over 256 KiB.') : 'No pinned A.'); }
    catch (e) { pinError = ' Pinned A could not load: ' + e.message; text(pinError); }
    restored = true; pinBtn.disabled = false; refresh(ui);
  }
  RF.CompareUI = { init, refresh, loaded, pin, unpin, compare, current: () => A, result: () => result };
})(typeof globalThis !== 'undefined' ? globalThis : this);
