/* spec-ui.js — Spec mode (D) on the page: the sidebar section (preset, settings, the constraint table, the compliance
 * report), the far-field map in the Result pane, the spec overlay on the Editor, and the Editor's extra tools.
 * Judging and the working target live in js/spec.js; intensity by direction in js/farfield.js.  ui.js calls in here;
 * nothing here runs a trace (the run loop records exit rays in Spec mode and hands its context over).            */
(function (root) {
  'use strict';
  const RF = root.RF;
  const P = RF.Panels, el = P.el;
  const COL = { pass: '#5aa7ff', fail: '#ff9a3d', unsure: '#f2b441', min: '#88d7d4', max: '#f4c17c', sel: '#ffffff' };
  const md = (ui) => ui.store.scene.modeD;
  const fmtCd = (x) => !isFinite(x) ? '—' : x >= 1e5 ? (x / 1000).toFixed(0) + 'k' : x >= 1e3 ? (x / 1000).toFixed(x >= 1e4 ? 1 : 2).replace(/\.?0+$/, '') + 'k' : Math.round(x).toString();
  const fmtDist = (d) => !(d > 0) || !isFinite(d) ? '∞ (goniometer)' : d >= 1000 ? (d / 1000).toPrecision(3).replace(/\.0+$/, '') + ' m screen' : d + ' mm screen';

  // ---------------------------------------------------------------- evaluation (cached per run, spec and distance)
  const evalKey = (m) => JSON.stringify([m.items, m.kernel, m.aimTol, m.traffic, m.conv, m.step, m.distance]);
  // (re)judge the current run; cheap to call often: rebuilds only when the run grew or the spec changed
  function update(ui, force) {
    const run = ui.run, sc = ui.store.scene;
    if (!run || sc.mode !== 'D' || !run.ctx.ex || !(run.ctx.next > 0)) return ui.spec || null;
    const key = evalKey(sc.modeD), now = performance.now(), c = run.ctx;
    const s = ui.spec;
    if (!force && s && s.ctx === c && s.key === key && (s.next === c.next || (!c.done && now - s.t < 700))) return s;
    try {
      const G = RF.FarField.build(c, RF.Spec.gridOpts(sc)), ev = RF.Spec.evaluate(G, sc.modeD);
      ui.spec = { ctx: c, key, next: c.next, done: c.done, t: now, G, ev, map: null };
    } catch (e) { ui.spec = { ctx: c, key, next: c.next, t: now, error: e.message }; }
    return ui.spec;
  }
  // a different measuring distance on the same run (no re-trace) — for the comparison table
  function evalAt(ui, distance) {
    const sc = ui.store.scene, G = RF.FarField.build(ui.run.ctx, RF.Spec.gridOpts(sc, distance));
    return RF.Spec.evaluate(G, sc.modeD);
  }

  // ---------------------------------------------------------------- sidebar
  function section(ui, sectionFn) {
    const m = () => md(ui);
    const presetSel = el('select', { 'aria-label': 'Spec preset' }, ...Object.entries(RF.Spec.PRESETS).map(([id, p]) => el('option', { value: id }, p.label)));
    const apply = P.confirmButton('Load preset', 'Replace every constraint?', () => { RF.Spec.applyPreset(m(), presetSel.value); changed(ui, true); });
    const fit = el('button', { type: 'button', title: 'Resize the target plane so the Editor and Result show the whole spec window at the current distance' }, 'Fit target to spec');
    fit.addEventListener('click', () => { const sc = ui.store.scene; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc)); ui._histHint = 'Fit target to spec'; ui.vLeft.fitted = ui.vHeat.fitted = false; ui.store.invalidate(['A', 'B']); ui.afterChange(); });
    const seed = P.confirmButton('Seed low-beam paint', 'Replace the painting?', () => { const sc = ui.store.scene; sc.modeA.paint = RF.Spec.seedPaint(sc); ui._histHint = 'Seed low-beam paint'; changed(ui, true); });
    const row = (label, input, help) => el('div', {}, el('div', { class: 'row', title: help || '' }, el('label', {}, label), input));
    const sel = (opts, get, set, evalOnly) => { const s = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v }, t))); s.dataset.spec = '1'; s._get = get; s.addEventListener('change', () => { set(s.value); changed(ui, !evalOnly); }); return s; };
    const num = (get, set, o, evalOnly) => { const i = el('input', Object.assign({ type: 'number', step: 'any' }, o || {})); i.dataset.spec = '1'; i._get = get; i.addEventListener('change', () => { const v = parseFloat(i.value); if (isFinite(v)) { set(v); changed(ui, !evalOnly); } }); return i; };
    const chk = (get, set) => { const i = el('input', { type: 'checkbox' }); i.dataset.spec = '1'; i._get = get; i._chk = true; i.addEventListener('change', () => { set(i.checked); changed(ui, true); }); return i; };
    const distSel = el('div', { class: 'seg spec-dist', role: 'radiogroup', 'aria-label': 'Measure at' });
    for (const [d, t] of [[0, '∞'], [25000, '25 m'], [10000, '10 m'], [-1, 'target']]) {
      const b = el('button', { type: 'button', 'data-dist': d, title: d === 0 ? 'Far field: intensity by direction, what a goniometer measures' : d < 0 ? 'A screen at the target plane’s distance' : 'A screen at ' + t + ' from the source, read as apparent intensity (illuminance × r² / cos θ)' }, t);
      b.addEventListener('click', () => { m().distance = d < 0 ? ui.store.scene.target.distance : d; changed(ui, false); });
      distSel.append(b);
    }
    const body = el('div', { id: 'spec-box' },
      el('div', { class: 'note' }, 'A beam spec in the regulations’ terms: test points and zones in degrees (H right, V up, from the source) with min / max intensity in cd, and a cut-off sharpness scan. Rebuild solves for the spec plus your painting; the report judges the traced far field.'),
      el('div', { class: 'btnrow' }, presetSel, apply),
      el('div', { id: 'spec-source', class: 'note' }),
      row('Traffic', sel([['RHT', 'Right-hand (mirror: none)'], ['LHT', 'Left-hand (mirror H)']], () => m().traffic, (v) => { m().traffic = v; })),
      row('Measure at', distSel, 'Where the report reads intensity. ∞ = far field (goniometer). A finite screen shows the near-field error: how a test at that distance would read this lamp.'),
      sectionFn('Measurement', { open: false, key: 'D-meas' },
        row('Kernel ± (°)', num(() => m().kernel, (v) => { m().kernel = Math.max(0.05, Math.min(5, v)); }, { min: 0.05, max: 5, step: 0.05 }, true), 'Half-width of the square each point is read over. Smaller = sharper but noisier.'),
        row('Aim tolerance ± (°)', num(() => m().aimTol, (v) => { m().aimTol = Math.max(0, Math.min(2, v)); }, { min: 0, max: 2, step: 0.1 }, true), 'Re-aim the lamp within this box (0.1° steps) and keep the best result, as type approval allows a re-aim. 0 = as designed.'),
        row('Angles', sel([['A', 'A: V = elevation, H = azimuth'], ['B', 'B: H out of the vertical plane'], ['S', 'Flat screen: atan(x/D), atan(y/D)']], () => m().conv, (v) => { m().conv = v; }), 'Which (H, V) a direction gets. Automotive uses a "Type A" goniometer; which of these matches it is unverified (see SPEC-MODE.md). They differ by < 0.05° inside ±10° H.'),
        row('Bin (°)', num(() => m().step, (v) => { m().step = Math.max(0.02, Math.min(1, v)); }, { min: 0.02, max: 1, step: 0.02 }, true), 'Far-field grid resolution.')),
      sectionFn('Paint as a secondary goal', { open: true, key: 'D-paint' },
        row('Use the painting', chk(() => m().usePaint !== false, (v) => { m().usePaint = v; }), 'Off: the solver sees only the spec (floors at minimums, holes at maximums).'),
        row('Paint level 1 = (cd)', num(() => m().paintCd, (v) => { m().paintCd = Math.max(0, v); }, { min: 0, step: 100 }), '0 = auto: the largest minimum in the spec.'),
        row('Paint weight', num(() => m().paintWeight, (v) => { m().paintWeight = Math.max(0, v); }, { min: 0, max: 10, step: 0.1 }), 'Scales the painting against the spec floor and ceiling in the solver’s target.'),
        el('div', { class: 'btnrow' }, seed, fit)),
      sectionFn('Constraints', { open: true, key: 'D-items' },
        el('div', { id: 'spec-table', class: 'spec-table' }),
        el('div', { class: 'btnrow' },
          el('button', { type: 'button', onclick: () => addItem(ui, { kind: 'point', name: 'P', h: 0, v: 0, min: 1000 }) }, '+ point'),
          el('button', { type: 'button', onclick: () => addItem(ui, { kind: 'zone', name: 'Zone', max: 1000, poly: [[-2, 1], [2, 1], [2, 2], [-2, 2]] }) }, '+ zone'),
          el('button', { type: 'button', onclick: () => addItem(ui, { kind: 'gradient', name: 'Cut-off', h: -2.5, v0: -1.5, v1: 0.5, dv: 0.1, min: 0.13 }) }, '+ cut-off scan'),
          el('button', { type: 'button', onclick: () => addItem(ui, { kind: 'imax', name: 'Max intensity', max: 100000 }) }, '+ intensity cap'))),
      el('div', { id: 'spec-report', class: 'spec-report' }));
    presetSel.value = m().preset in RF.Spec.PRESETS ? m().preset : 'blank';
    return body;
  }
  function addItem(ui, it) { const m = md(ui); m.items.push(Object.assign({ id: RF.Spec.newId(m.items), on: true, w: 1 }, it)); ui._histHint = 'Add ' + it.kind; changed(ui, true); }
  // solve: the working target changed (re-solve per the auto switches); otherwise only the judging did
  function changed(ui, solve) {
    if (solve) { ui.store.invalidate(['A']); ui.afterChange(); }
    else { ui.autosave(); update(ui, true); ui.redrawSpec(); }
    render(ui);
  }

  // the constraint table: one row per item, editable in place
  function renderTable(ui) {
    const box = document.getElementById('spec-table'); if (!box) return;
    const m = md(ui), ev = ui.spec && ui.spec.ev, rowsOf = (id) => ev ? ev.rows.filter((r) => r.id === id) : [];
    box.innerHTML = '';
    const head = el('div', { class: 'st-row st-head' }, el('span', {}, ''), el('span', {}, 'name'), el('span', {}, 'H°'), el('span', {}, 'V°'), el('span', {}, 'min'), el('span', {}, 'max'), el('span', {}, ''));
    box.append(head);
    for (const it of m.items) {
      const rs = rowsOf(it.id), verdict = !rs.length ? '' : rs.some((r) => r.verdict === 'fail') ? 'fail' : rs.some((r) => r.verdict === 'unsure') ? 'unsure' : 'pass';
      const inp = (key, o) => {
        const i = el('input', Object.assign({ type: key === 'name' ? 'text' : 'number', step: 'any', value: it[key] === undefined || it[key] === null ? '' : it[key], 'aria-label': key + ' of ' + it.name }, o || {}));
        i.addEventListener('change', () => {
          if (key === 'name') it.name = i.value || it.name;
          else { const v = i.value === '' ? undefined : parseFloat(i.value); if (v === undefined || !isFinite(v)) delete it[key]; else it[key] = v; }
          ui._histHint = 'Edit ' + it.name; changed(ui, true);
        });
        return i;
      };
      const on = el('input', { type: 'checkbox', title: 'Include this constraint' }); on.checked = it.on !== false;
      on.addEventListener('change', () => { it.on = on.checked; changed(ui, true); });
      const del = el('button', { type: 'button', class: 'icon', title: 'Delete ' + it.name, 'aria-label': 'Delete ' + it.name }, '✕');
      del.addEventListener('click', () => { m.items = m.items.filter((x) => x !== it); ui._histHint = 'Delete ' + it.name; changed(ui, true); });
      let hCell, vCell;
      if (it.kind === 'point') { hCell = inp('h'); vCell = inp('v'); }
      else if (it.kind === 'gradient') { hCell = inp('h'); vCell = el('span', { class: 'st-note', title: 'Scanned from V = ' + it.v0 + '° to ' + it.v1 + '° in ' + (it.dv || 0.1) + '° steps' }, it.v0 + '…' + it.v1); }
      else if (it.kind === 'zone') { hCell = el('span', { class: 'st-note', title: it.poly.map((p) => '(' + p.join(', ') + ')').join(' ') }, 'polygon'); vCell = el('span', { class: 'st-note' }, it.poly.length + ' pts'); }
      else { hCell = el('span', { class: 'st-note' }, 'whole'); vCell = el('span', { class: 'st-note' }, 'map'); }
      const r = el('div', { class: 'st-row' + (ui.specSel === it.id ? ' sel' : '') + (verdict ? ' v-' + verdict : ''), title: (it.note || '') + (it.kind === 'gradient' ? ' (min = log₁₀ step)' : '') },
        on, inp('name'), hCell, vCell, inp('min', { min: 0, placeholder: '—' }), it.kind === 'gradient' ? el('span', {}) : inp('max', { min: 0, placeholder: '—' }), del);
      r.addEventListener('click', (e) => { if (e.target.closest('input,button')) return; ui.specSel = ui.specSel === it.id ? null : it.id; render(ui); ui.redrawSpec(); });
      box.append(r);
    }
    if (!m.items.length) box.append(el('div', { class: 'note' }, 'No constraints. Add some, or load a preset.'));
  }

  // the report under the table
  function renderReport(ui) {
    const box = document.getElementById('spec-report'); if (!box) return;
    box.innerHTML = '';
    const sc = ui.store.scene, m = sc.modeD, s = ui.spec;
    if (!(sc.source.power > 0)) { box.append(el('div', { class: 'reason' }, 'Set the source power (lm) to read intensities in cd.')); return; }
    const win = RF.Spec.windowOf(m), T = RF.Engine.targetFrame(sc.target), seen = Math.atan(T.half / sc.target.distance) * 180 / Math.PI;
    const ext = Math.max(Math.abs(win[0]), Math.abs(win[1]));
    if (seen < ext - 3) box.append(el('div', { class: 'reason' }, 'The target plane shows ±' + seen.toFixed(1) + '°, the spec spans ±' + ext + '° in H: the solver can’t aim outside the plane. “Fit target to spec” resizes it.'));
    if (!s || !s.ev) { box.append(el('div', { class: 'note' }, s && s.error ? 'Report failed: ' + s.error : 'The report appears when the trace runs.')); return; }
    const ev = s.ev, pc = (x) => Math.round(100 * x) + '%';
    const head = { pass: '✓ PASS', fail: '✗ FAIL', unsure: '? UNSURE', empty: '— no constraints' }[ev.verdict];
    box.append(el('div', { class: 'spec-verdict v-' + ev.verdict },
      el('b', {}, head), ' ', el('span', {}, ev.n.pass + ' pass · ' + ev.n.fail + ' fail · ' + ev.n.unsure + ' unsure'), ' ',
      el('span', { class: 'note', title: 'Soft score: each constraint scores 1 when met, falling linearly (in log) to 0 at a factor of 2 off; weighted mean.' }, 'score ' + pc(ev.score))));
    box.append(el('div', { class: 'note' }, 'Measured at ' + fmtDist(s.G.distance) + ' · kernel ±' + ev.kernel + '° · ' + (s.done ? '' : 'partial: ') + s.G.coverage.toLocaleString() + ' rays' +
      (Math.hypot(ev.shift[0], ev.shift[1]) > 1e-9 ? ' · re-aimed ΔH ' + ev.shift[0].toFixed(1) + '°, ΔV ' + ev.shift[1].toFixed(1) + '° (as designed: ' + ev.atZero.n.fail + ' fail)' : m.aimTol > 0 ? ' · no re-aim helps' : '') +
      (m.verified === false ? ' · ⚠ preset values unverified' : '')));
    const tbl = el('div', { class: 'spec-rows' });
    for (const r of ev.rows) {
      const isLog = r.unit === 'log', need = (r.isMin ? '≥ ' : '≤ ') + (isLog ? r.bound : fmtCd(r.bound));
      const got = isFinite(r.value) ? (isLog ? r.value.toFixed(2) : fmtCd(r.value)) + ' ± ' + (isLog ? r.sd.toFixed(2) : fmtCd(r.sd)) : '—';
      const fac = isFinite(r.margin) ? Math.pow(10, Math.abs(r.margin)) : NaN, off = r.margin < 0 ? '×' + fac.toFixed(2) + (r.isMin ? ' short' : ' over') : '';
      const mk = { pass: '✓', fail: '✗', unsure: '?' }[r.verdict];
      const line = el('div', { class: 'sr v-' + r.verdict + (ui.specSel === r.id ? ' sel' : ''), title: r.at ? 'read at H ' + r.at[0].toFixed(2) + '°, V ' + r.at[1].toFixed(2) + '°' : '' },
        el('span', { class: 'mk' }, mk), el('span', { class: 'nm' }, r.name), el('span', { class: 'need' }, need), el('span', { class: 'got' }, got), el('span', { class: 'off' }, off));
      line.addEventListener('click', () => { ui.specSel = ui.specSel === r.id ? null : r.id; render(ui); ui.redrawSpec(); });
      tbl.append(line);
    }
    box.append(tbl);
    if (ev.n.unsure) box.append(el('div', { class: 'note' }, 'Unsure = the shot noise (±2σ) straddles the limit. ≈ ×' + (ev.moreRays >= 100 ? '100+' : ev.moreRays.toFixed(1)) + ' the rays would settle ' + (ev.n.unsure > 1 ? 'them' : 'it') + ' (or widen the kernel).'));
    // brightness-theorem feasibility: no design can beat these, whatever the solver
    const fz = RF.Spec.feasibility(sc), bad = fz.filter((f) => !f.ok);
    if (fz.length) box.append(el('div', { class: bad.length ? 'reason' : 'note' }, bad.length ? 'Out of reach for ANY design in this envelope: ' + bad.map((f) => f.kind === 'flux' ? 'the min-zones need ≥ ' + Math.round(f.need) + ' lm (LED: ' + Math.round(f.ceiling) + ')' : f.name + ' needs ' + fmtCd(f.need) + ' cd, ceiling ' + fmtCd(f.ceiling)).join('; ') + '.'
      : 'Feasibility (brightness theorem): every minimum is under its ceiling — tightest ' + (() => { const pts = fz.filter((f) => f.kind !== 'flux').sort((a, b) => b.need / b.ceiling - a.need / a.ceiling)[0]; return pts ? pts.name + ' at ' + pc(pts.need / pts.ceiling) + ' of what the envelope could give' : 'n/a'; })() + '.'));
    // near field vs far field on this same run
    const cmp = el('button', { type: 'button', title: 'Judge this same trace at several measuring distances (no re-trace)' }, 'Compare distances');
    const out = el('div', { class: 'spec-cmp' });
    cmp.addEventListener('click', () => {
      out.innerHTML = '';
      const ds = [0, 25000, 10000, sc.target.distance].filter((d, i, a) => a.indexOf(d) === i);
      for (const d of ds) {
        const e = evalAt(ui, d), worst = e.rows.slice().sort((a, b) => a.margin - b.margin)[0];
        out.append(el('div', { class: 'sr v-' + e.verdict }, el('span', { class: 'mk' }, { pass: '✓', fail: '✗', unsure: '?', empty: '—' }[e.verdict]), el('span', { class: 'nm' }, fmtDist(d)),
          el('span', {}, e.n.pass + '/' + e.rows.length + ' · ' + pc(e.score)), el('span', { class: 'off' }, worst && worst.margin < 0 ? 'worst ' + worst.name : '')));
      }
    });
    if (ui.run && ui.run.ctx.done) box.append(el('div', { class: 'btnrow' }, cmp), out);
  }
  function render(ui) {
    if (ui.store.scene.mode !== 'D') return;
    const m = md(ui);
    for (const i of document.querySelectorAll('#spec-box [data-spec]')) { if (document.activeElement === i) continue; const v = i._get(); if (i._chk) i.checked = !!v; else i.value = v === undefined ? '' : v; }
    const d = m.distance > 0 ? m.distance : 0;
    for (const b of document.querySelectorAll('#spec-box [data-dist]')) { const bd = +b.dataset.dist; b.classList.toggle('on', bd < 0 ? d > 0 && d === ui.store.scene.target.distance && d !== 25000 && d !== 10000 : bd === d); }
    const src = document.getElementById('spec-source');
    if (src) src.textContent = (m.verified === false ? '⚠ ' : '') + (m.source || '');
    renderTable(ui); renderReport(ui);
  }

  // ---------------------------------------------------------------- drawing
  // items with their verdicts, at the positions the judge read them (shifted by any re-aim)
  function drawItems(ctx, ui, toScreen, scale) {
    const m = md(ui), ev = ui.spec && ui.spec.ev, sh = ev ? ev.shift : [0, 0];
    const items = RF.Spec.itemsOf(m);
    const verdictOf = (id) => { if (!ev) return null; const rs = ev.rows.filter((r) => r.id === id); return !rs.length ? null : rs.some((r) => r.verdict === 'fail') ? 'fail' : rs.some((r) => r.verdict === 'unsure') ? 'unsure' : 'pass'; };
    ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 1.5;
    // labels skip any spot an earlier label already took (points first, so test-point names win over zone names)
    const taken = [], label = (txt, x, y) => {
      const w = ctx.measureText(txt).width, r = [x - 1, y - 10, x + w + 1, y + 2];
      if (taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) return;
      taken.push(r); ctx.fillText(txt, x, y);
    };
    items.sort((a, b) => (a.kind === 'point' ? 0 : 1) - (b.kind === 'point' ? 0 : 1) || (ui.specSel === b.id) - (ui.specSel === a.id));
    for (const it of items) {
      const v = verdictOf(it.id), sel = ui.specSel === it.id;
      const col = sel ? COL.sel : v ? COL[v] : it.min > 0 ? COL.min : COL.max;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 2.5 : 1.5;
      const S = (h, vv) => toScreen(h + sh[0], vv + sh[1]);
      if (it.kind === 'point') {
        const p = S(it.h, it.v); if (!p) continue;
        ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI); it.min > 0 ? ctx.fill() : ctx.stroke();
        label(it.name, p[0] + 6, p[1] - 5);
      } else if (it.kind === 'zone') {
        const pts = it.poly.map(([h, vv]) => S(h, vv)); if (pts.some((p) => !p)) continue;
        ctx.setLineDash(it.max > 0 && !(it.min > 0) ? [5, 3] : []);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        const top = pts.reduce((a, p) => (p[1] < a[1] || (p[1] === a[1] && p[0] < a[0]) ? p : a), pts[0]);
        label(it.name, top[0] + 3, top[1] + 12);
      } else if (it.kind === 'gradient') {
        const a = S(it.h, it.v0), b = S(it.h, it.v1); if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        for (const p of [a, b]) { ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1]); ctx.lineTo(p[0] + 4, p[1]); ctx.stroke(); }
        label(it.name, b[0] + 5, b[1] + 4);
      }
    }
    ctx.restore();
  }
  // Editor overlay: the spec projected onto the design plane, as seen from the source
  function editorOverlay(ui) {
    const sc = ui.store.scene, T = RF.Engine.targetFrame(sc.target);
    return (ctx, view) => {
      drawItems(ctx, ui, (h, v) => { const uv = RF.Spec.planeUV(sc, h, v); if (!uv) return null; const c = RF.Render2D.uvToCell(T, uv[0], uv[1]); return view.toScreen(c[0], c[1]); });
    };
  }
  // log-scale intensity image of a far-field grid (3 decades under the robust peak)
  function ffImage(ui, s) {
    if (s.img && s.imgK === md(ui).kernel) return s.img;
    const G = s.G, M = RF.FarField.map(G, md(ui).kernel), cd = M.cd, n = cd.length;
    const lit = []; for (let q = 0; q < n; q++) if (cd[q] > 0) lit.push(cd[q]); lit.sort((a, b) => a - b);
    const top = lit.length ? lit[Math.min(lit.length - 1, Math.floor(0.999 * lit.length))] : 1, lo = top / 1000;
    const cv = s.img || document.createElement('canvas'); cv.width = G.nh; cv.height = G.nv;
    const g = cv.getContext('2d'), im = g.createImageData(G.nh, G.nv), LUT = RF.Render.LUT;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const x = cd[j * G.nh + i], t = x > lo ? Math.min(255, Math.round(255 * Math.log10(x / lo) / 3)) : 0, o = 4 * ((G.nv - 1 - j) * G.nh + i);
      im.data[o] = LUT[3 * t]; im.data[o + 1] = LUT[3 * t + 1]; im.data[o + 2] = LUT[3 * t + 2]; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    s.img = cv; s.imgK = md(ui).kernel; s.top = top; s.lo = lo; s.M = M;
    return cv;
  }
  // the Result pane in Spec mode, "Far field" view: content = degrees (H right, V up)
  function drawFarField(ui, cv, view) {
    const s = ui.spec, box = RF.Render.fitCanvas(cv), ctx = cv.getContext('2d');
    const win = s && s.G ? [s.G.h0, s.G.v0, s.G.h1, s.G.v1] : (() => { const w = RF.Spec.windowOf(md(ui)); return [w[0], w[2], w[1], w[3]]; })();
    if (!view.fitted || view.bounds.join() !== win.join()) view.fit(win, box.w, box.h);
    else if (view.w !== box.w || view.h !== box.h) { if (view.zoomed) view.refitKeep(win, box.w, box.h); else view.fit(win, box.w, box.h); }
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0); ctx.clearRect(0, 0, box.w, box.h);
    const a = view.toScreen(win[0], win[3]), b = view.toScreen(win[2], win[1]);
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    if (s && s.G) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ffImage(ui, s), a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    // degree grid: H / V axes and 5° ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px system-ui, sans-serif';
    for (let h = Math.ceil(win[0] / 5) * 5; h <= win[2]; h += 5) { const p = view.toScreen(h, 0); ctx.beginPath(); ctx.moveTo(p[0], a[1]); ctx.lineTo(p[0], b[1]); ctx.stroke(); ctx.fillText((h > 0 ? h + 'R' : h < 0 ? -h + 'L' : '0'), p[0] + 2, b[1] - 3); }
    for (let v = Math.ceil(win[1] / 5) * 5; v <= win[3]; v += 5) { const p = view.toScreen(0, v); ctx.beginPath(); ctx.moveTo(a[0], p[1]); ctx.lineTo(b[0], p[1]); ctx.stroke(); ctx.fillText((v > 0 ? v + 'U' : v < 0 ? -v + 'D' : 'H'), a[0] + 3, p[1] - 2); }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; const o = view.toScreen(0, 0); ctx.beginPath(); ctx.moveTo(o[0], a[1]); ctx.lineTo(o[0], b[1]); ctx.moveTo(a[0], o[1]); ctx.lineTo(b[0], o[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(143,184,255,0.35)'; ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0] - 1, b[1] - a[1] - 1);
    drawItems(ctx, ui, (h, v) => view.toScreen(h, v));
    // colour bar: log cd
    const cb = document.getElementById('colorbar'); cb.innerHTML = '';
    if (s && s.top) {
      cb.append(el('i', { style: 'background:' + RF.Render2D.colorbarCSS() }), el('div', { class: 'cb-labels' }, el('span', {}, fmtCd(s.lo) + ' cd'),
        el('span', { title: 'Log scale, 3 decades. ' + (isFinite(s.G.distance) ? 'Apparent intensity on a screen at ' + fmtDist(s.G.distance) : 'Far field: intensity by direction') + '. Kernel ±' + md(ui).kernel + '°.' }, (isFinite(s.G.distance) ? fmtDist(s.G.distance) : 'far field') + ' · log'),
        el('span', {}, fmtCd(s.top) + ' cd')));
    }
  }
  // H/V under a screen point of the far-field view (spot readout)
  function readout(ui, view, x, y) {
    const s = ui.spec; if (!s || !s.G) return null;
    const c = view.toContent(x, y), r = RF.FarField.intensityAt(s.G, c[0], c[1], md(ui).kernel);
    return { h: c[0], v: c[1], cd: r.cd, sd: r.sd };
  }
  // the Editor's extra tools in Spec mode
  function leftTools(ui, box) {
    const wt = el('button', { type: 'button', class: 'toggle', 'aria-pressed': String(!!ui.specWorking), title: 'Show what the solver is asked for: the spec’s floors and ceilings merged with your painting, as illuminance on this plane' }, 'Solver target');
    wt.addEventListener('click', () => { ui.specWorking = !ui.specWorking; wt.setAttribute('aria-pressed', String(ui.specWorking)); ui.sceneDirty = true; ui.redrawSpec(); });
    box.append(el('span', { class: 'btn-pair' }, wt));
  }

  RF.SpecUI = { section, render, update, evalAt, drawFarField, editorOverlay, readout, leftTools, COL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
