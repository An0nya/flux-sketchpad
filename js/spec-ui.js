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
  // a sampling offset → the beam move it stands for, in words (beam right = offset −x)
  const fmtMove = (o, traffic) => { const h = -o[0], v = -o[1], p = []; if (Math.abs(h) > 1e-9) p.push(Math.abs(h).toFixed(2) + '° ' + (h > 0 ? 'right' : 'left')); if (Math.abs(v) > 1e-9) p.push(Math.abs(v).toFixed(2) + '° ' + (v > 0 ? 'up' : 'down')); return p.join(', ') || 'none'; };
  const fmtDist = (d) => !(d > 0) || !isFinite(d) ? '∞ (goniometer)' : d >= 1000 ? (d / 1000).toPrecision(3).replace(/\.0+$/, '') + ' m screen' : d + ' mm screen';

  // ---------------------------------------------------------------- evaluation (cached per run, spec and distance)
  const evalKey = (m) => JSON.stringify([m.items, m.kernel, m.aimTol, m.aimMode, m.aimLine, m.aimScan, m.itemReaim, m.aimBox, m.aimMoveCost, m.traffic, m.conv, m.step, m.distance]);
  // (re)judge the current run; cheap to call often: rebuilds only when the run grew or the spec changed
  function update(ui, force) {
    const run = ui.run, sc = ui.store.scene;
    if (!run || sc.mode !== 'D' || !(run.ctx.ex || run.ctx.ff) || !(run.ctx.next > 0)) return ui.spec || null;
    const key = evalKey(sc.modeD), now = performance.now(), c = run.ctx;
    const s = ui.spec, live = !c.done;
    // a judgement made while the run was still tracing (aim held) is not final: when the run ends it is judged again, fully
    if (!force && s && s.ctx === c && s.key === key && ((s.next === c.next && (s.full || live)) || (live && now - s.t < 700))) return s;
    try {
      const G = RF.FarField.build(c, RF.Spec.gridOpts(sc));
      // while rays are still being traced, do NOT re-aim (the re-aim box + per-point re-aim cost seconds per judgement, FMVSS worst): hold the aim of the
      // last judgement of this spec, or find the instrumental aim once without the box; the finished run gets the full judgement
      const prev = live && s && s.key === key && s.ev && s.ev.aim ? s.ev : null;
      const ev = RF.Spec.evaluate(G, sc.modeD, live ? (prev ? { frozen: { base: prev.aim.base, reaim: prev.reaim || [0, 0], note: prev.aim.note, cutV: prev.aim.cutV } } : { noBox: true }) : undefined);
      let Gw = null; try { const wo = RF.Spec.wideOpts(sc); if (c.ff && RF.FarField.streamOf(c, wo)) Gw = RF.FarField.build(c, wo); } catch (e) { /* the picture just stays narrow */ }
      ui.spec = { ctx: c, key, next: c.next, done: c.done, full: !live, t: now, G, Gw, ev, map: null };
    } catch (e) {
      ui.spec = { ctx: c, key, next: c.next, t: now, error: e.message };
      // the grid settings (window, bin, angles) changed since this run started: its streams don't cover them — re-trace once
      if (c.ff && !RF.FarField.streamOf(c, RF.Spec.gridOpts(sc)) && ui._specRetrace !== c) { ui._specRetrace = c; ui.requestRun(false); }
    }
    return ui.spec;
  }
  // the far-field grids a Spec run streams: the report's distance plus the comparison set (∞, 25 m, 10 m, the target)
  function streams(sc) {
    const md0 = sc.modeD || {}, ds = [md0.distance > 0 ? md0.distance : 0, 0, 25000, 10000, sc.target.distance];
    return ds.filter((d, i) => ds.indexOf(d) === i).map((d) => RF.Spec.gridOpts(sc, d)).concat([RF.Spec.wideOpts(sc)]);
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
    fit.addEventListener('click', () => {
      const sc = ui.store.scene, before = sc.target.size, after = Math.round(RF.Spec.fitTargetSize(sc)), w = RF.Spec.windowOf(sc.modeD), ext = Math.max(...w.map(Math.abs));
      sc.target.size = after; ui._histHint = 'Fit target to spec'; ui.vLeft.fitted = ui.vHeat.fitted = false; ui.store.invalidate(['A', 'B']); ui.afterChange();
      // say what changed: the plane is what you paint on and see; the solver already works on its own plane (Solve at)
      ui.store.notice('Fit target to spec: the target plane went from ' + (before / 1000).toFixed(1) + ' m to ' + (after / 1000).toFixed(1) + ' m wide at ' + (sc.target.distance / 1000).toFixed(1) + ' m, so it shows ±' + ext + '° (the spec window). It sets what you can paint and see; the solver ' + ((sc.modeD.solveAt === undefined ? 25000 : sc.modeD.solveAt) > 0 ? 'already uses its own plane at Solve at, sized to the spec.' : 'aims at this plane (Solve at = 0).'));
    });
    const seed = P.confirmButton('Seed low-beam paint', 'Replace the painting?', () => { const sc = ui.store.scene; sc.modeA.paint = RF.Spec.seedPaint(sc); ui._histHint = 'Seed low-beam paint'; changed(ui, true); });
    // the painting from the road: each direction gets what it needs for 5 lx on the road out to 100 m right / 60 m left
    const roadSeed = P.confirmButton('Seed from road reach', 'Replace the painting with the road-reach goal?', () => {
      const sc = ui.store.scene, g = RF.Spec.roadGoalPaint(sc); if (!(g.cd > 0)) return;
      sc.modeA.paint = g.paint; sc.modeD.paintCd = g.cd; sc.modeD.usePaint = true; ui._histHint = 'Seed from road reach'; changed(ui, true);
    });
    roadSeed.title = 'Secondary goal = light the road: each direction asks for the intensity that puts 5 lx (IIHS, 25 cm up) where it lands, out to 100 m along the right edge and 60 m along the left road edge. Sets Paint level 1 to that intensity; the spec\u2019s floors and ceilings still win. Uses Spec → Road (height, lamps).';
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
        row('Aim', sel([['design', 'As designed'], ['cutoff', 'By the cut-off (R112 Annex 9 §3.1)'], ['peak', 'Maximum on HV (§6.3.1)']], () => m().aimMode || 'design', (v) => { m().aimMode = v; }, true), 'How the lab aims the lamp before measuring. By the cut-off: the inflection of a vertical scan at 2.5° from V-V goes on 0.57° D.'),
        row('Aim line (° D)', num(() => -(m().aimLine === undefined ? -0.57 : m().aimLine), (v) => { m().aimLine = -Math.max(-2, Math.min(3, v)); }, { min: -2, max: 3, step: 0.01 }, true), 'Where the cut-off goes when aiming by it: R112 0.57° D (line B); FMVSS 108 VOL 0.4° D, VOR 0 (H-H).'),
        row('Aim scan ± (°)', num(() => m().aimScan || 3, (v) => { m().aimScan = Math.max(0.5, Math.min(6, v)); }, { min: 0.5, max: 6, step: 0.5 }, true), 'The cut-off is looked for this far around the aim line first (then anywhere): a stray streak far above the beam must not set the aim.'),
        row('Re-aim per point (°)', num(() => m().itemReaim || 0, (v) => { m().itemReaim = Math.max(0, Math.min(1, v)); }, { min: 0, max: 1, step: 0.05 }, true), 'Each test point / zone may be read this far off, whichever reads best. FMVSS 108 S14.2.5.5: ¼° in any direction at any test point. R112: 0 (it re-aims the whole lamp instead).'),
        row('Re-aim L / R (°)', el('span', { class: 'numpair' },
          num(() => (m().aimBox || {}).left || 0, (v) => { m().aimBox = Object.assign({ left: 0, right: 0, up: 0, down: 0 }, m().aimBox, { left: Math.max(0, Math.min(2, v)) }); }, { min: 0, max: 2, step: 0.05, 'aria-label': 'Re-aim left' }, true),
          num(() => (m().aimBox || {}).right || 0, (v) => { m().aimBox = Object.assign({ left: 0, right: 0, up: 0, down: 0 }, m().aimBox, { right: Math.max(0, Math.min(2, v)) }); }, { min: 0, max: 2, step: 0.05, 'aria-label': 'Re-aim right' }, true)),
          'After aiming, the lamp may be moved this far (beam axis, right-hand traffic; mirrored for left-hand) and the best result kept. R112 §6.2.2.3: 0.5° left, 0.75° right.'),
        row('Re-aim ± V (°)', num(() => (m().aimBox || {}).up || 0, (v) => { const x = Math.max(0, Math.min(2, v)); m().aimBox = Object.assign({ left: 0, right: 0, up: 0, down: 0 }, m().aimBox, { up: x, down: x }); }, { min: 0, max: 2, step: 0.05 }, true), 'R112 §6.2.2.3: 0.25° up or down.'),
        row('Re-aim cost (per °)', num(() => (m().aimMoveCost >= 0 ? m().aimMoveCost : 0.5), (v) => { m().aimMoveCost = Math.max(0, Math.min(20, v)); }, { min: 0, max: 20, step: 0.25 }, true), 'How much a re-aim must gain to be taken, in expected failing rows per degree moved (re-aim box and per-point re-aim). 0 = take whatever aim gives the slimmest margins; 0.5 = default (one sure fail can still be re-aimed away anywhere in the R112 box); higher = keep the design aim unless a move clearly fixes rows. ⚠ Above ~0.6 the verdict can be stricter than the regulation: it may report a fail the lab would have re-aimed away.'),
        row('Angles', sel([['A', 'A: V = elevation, H = azimuth'], ['B', 'B: H out of the vertical plane'], ['S', 'Flat screen: atan(x/D), atan(y/D)']], () => m().conv, (v) => { m().conv = v; }), 'Which (H, V) a direction gets. R112 (Annex 3, Figure A) uses A: a vertical polar axis, h = azimuth, v = latitude. B and the flat screen differ by < 0.05° inside ±10° H.'),
        row('Bin (°)', num(() => m().step, (v) => { m().step = Math.max(0.02, Math.min(1, v)); }, { min: 0.02, max: 1, step: 0.02 }, true), 'Far-field grid resolution.')),
      sectionFn('Road', { open: false, key: 'D-road', tag: 'IIHS-style view' }, ...roadRows(ui, row)),
      sectionFn('Paint as a secondary goal', { open: true, key: 'D-paint' },
        row('Solve at (m)', num(() => (m().solveAt === undefined ? 25000 : m().solveAt) / 1000, (v) => { m().solveAt = Math.max(0, Math.min(1000, v)) * 1000; }, { min: 0, max: 1000, step: 5 }), 'The paint solvers aim at a flat plane; Spec mode hands them one this far away, sized to the spec window, so near-field parallax doesn’t shift the beam (0.2° at 10 m for a facet 40 mm off-axis). 0 = your target plane.'),
        row('Use the painting', chk(() => m().usePaint !== false, (v) => { m().usePaint = v; }), 'Off: the solver sees only the spec (floors at minimums, holes at maximums).'),
        row('Paint level 1 = (cd)', num(() => m().paintCd, (v) => { m().paintCd = Math.max(0, v); }, { min: 0, step: 100 }), '0 = auto: the largest minimum in the spec.'),
        row('Paint weight', num(() => m().paintWeight, (v) => { m().paintWeight = Math.max(0, v); }, { min: 0, max: 10, step: 0.1 }), 'Scales the painting against the spec floor and ceiling in the solver’s target.'),
        el('div', { class: 'btnrow' }, seed, roadSeed, fit)),
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
      else if (it.kind === 'sum') { hCell = el('span', { class: 'st-note', title: it.pts.map((p) => '(' + p.join(', ') + ')').join(' ') }, 'sum'); vCell = el('span', { class: 'st-note' }, it.pts.length + ' pts'); }
      else if (it.kind === 'linearity') { hCell = el('span', { class: 'st-note', title: 'Inflection points at H = ' + it.hs.join('°, ') + '°' }, it.hs.map(Math.abs).join('/')); vCell = el('span', { class: 'st-note' }, 'spread°'); }
      else if (it.kind === 'gradient') { hCell = inp('h'); vCell = el('span', { class: 'st-note', title: 'Scanned from V = ' + it.v0 + '° to ' + it.v1 + '° in ' + (it.dv || 0.1) + '° steps' }, it.v0 + '…' + it.v1); }
      else if (it.kind === 'zone') { hCell = el('span', { class: 'st-note', title: it.poly.map((p) => '(' + p.join(', ') + ')').join(' ') }, 'polygon'); vCell = el('span', { class: 'st-note' }, it.poly.length + ' pts'); }
      else { hCell = el('span', { class: 'st-note' }, 'whole'); vCell = el('span', { class: 'st-note' }, 'map'); }
      const r = el('div', { class: 'st-row' + (ui.specSel === it.id ? ' sel' : '') + (verdict ? ' v-' + verdict : ''), title: (it.note || '') + (it.kind === 'gradient' ? ' (min = log₁₀ step)' : '') },
        on, inp('name'), hCell, vCell,
        it.minRel ? el('span', { class: 'st-note', title: 'Relative: ' + it.minRel.factor + ' × ' + it.minRel.ref }, '≥' + it.minRel.factor + '×' + it.minRel.ref) : it.kind === 'linearity' ? el('span', {}) : inp('min', { min: 0, placeholder: '—' }),
        it.maxRel ? el('span', { class: 'st-note', title: 'Relative: ' + it.maxRel.factor + ' × the value measured at ' + it.maxRel.ref }, '≤' + it.maxRel.factor + '×' + it.maxRel.ref) : inp('max', { min: 0, placeholder: '—' }), del);
      if (it.ref) r.title = (r.title ? r.title + ' · ' : '') + it.ref;
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
    if (seen < ext - 3) box.append(el('div', { class: 'reason' }, 'The target plane shows ±' + seen.toFixed(1) + '°, the spec spans ±' + ext + '° in H: ' + ((m.solveAt === undefined ? 25000 : m.solveAt) > 0 ? 'you can’t paint or see outside it (the solver uses its own plane at Solve at, sized to the spec, so it isn’t limited). “Fit target to spec” resizes yours.' : 'with Solve at = 0 the solver aims at this plane and can’t reach outside it. “Fit target to spec” resizes it.')));
    // the spec is absolute: the emitter's luminance and lumens matter here, unlike in Paint mode
    const src = sc.source, Lsrc = RF.SourcePresets ? RF.SourcePresets.luminanceOf(src) : null;
    if (!src.preset || src.preset === 'sketch') box.append(el('div', { class: 'note' }, 'Emitter: ' + (src.preset === 'sketch' ? 'the sketch LED' : 'custom') + (Lsrc ? ' (' + Math.round(Lsrc) + ' cd/mm²)' : '') + '. Spec mode reads absolute cd, so the emitter decides the numbers; the sketch LED is brighter per mm² than any real LED in the presets (Light source → Emitter).'));
    if (!s || !s.ev) { box.append(el('div', { class: 'note' }, s && s.error ? 'Report failed: ' + s.error : 'The report appears when the trace runs.')); return; }
    const ev = s.ev, pc = (x) => Math.round(100 * x) + '%';
    const head = { pass: '✓ PASS', fail: '✗ FAIL', unsure: '? UNSURE', empty: '— no constraints' }[ev.verdict];
    box.append(el('div', { class: 'spec-verdict v-' + ev.verdict },
      el('b', {}, head), ' ', el('span', {}, ev.n.pass + ' pass · ' + ev.n.fail + ' fail · ' + ev.n.unsure + ' unsure'), ' ',
      el('span', { class: 'note', title: 'Soft score: each constraint scores 1 when met, falling linearly (in log) to 0 at a factor of 2 off; weighted mean.' }, 'score ' + pc(ev.score))));
    box.append(el('div', { class: 'note' }, 'Measured at ' + fmtDist(s.G.distance) + ' · kernel ±' + ev.kernel + '° · ' + (s.done ? '' : 'partial: ') + s.G.coverage.toLocaleString() + ' rays' +
      ' · aimed: ' + ev.aim.note +
      (Math.hypot(ev.reaim[0], ev.reaim[1]) > 1e-9 ? ' · then re-aimed (beam) ' + fmtMove(ev.reaim, m.traffic) + ' (before: ' + ev.atAim.n.fail + ' fail)' : m.aimBox ? ' · no re-aim helps' : '') +
      (m.verified === false ? ' · ⚠ preset values unverified' : '')));
    const tbl = el('div', { class: 'spec-rows' });
    for (const r of ev.rows) {
      const t = rowText(r), need = t.need, got = t.got, mk = t.mk, off = r.margin < 0 ? t.off : '';
      const line = el('div', { class: 'sr v-' + r.verdict + (ui.specSel === r.id ? ' sel' : ''), title: r.at ? 'read at H ' + r.at[0].toFixed(2) + '°, V ' + r.at[1].toFixed(2) + '°' : '' },
        el('span', { class: 'mk' }, mk), el('span', { class: 'nm' }, r.name), el('span', { class: 'need' }, need), el('span', { class: 'got' }, got), el('span', { class: 'off' }, off));
      line.addEventListener('click', () => { ui.specSel = ui.specSel === r.id ? null : r.id; render(ui); ui.redrawSpec(); });
      tbl.append(line);
    }
    box.append(tbl);
    if (ev.rows.some((r) => r.extreme > 0)) box.append(el('div', { class: 'note' }, 'Zones: the brightest (or dimmest) of many noisy spot readings strays by chance, so a zone fails only if it clears the limit by 2σ plus that expected stray (√(2 ln n) σ over n independent spots).'));
    if (ev.n.unsure) {
      const note = el('div', { class: 'note' }, 'Unsure = the shot noise (±2σ) straddles the limit. ≈ ×' + (ev.moreRays >= 100 ? '100+' : ev.moreRays.toFixed(1)) + ' the rays would settle ' + (ev.n.unsure > 1 ? 'them' : 'it') + ' (or widen the kernel). ');
      if (ui.canRefine && ui.canRefine()) note.append(refineButton(ui));
      box.append(note);
    }
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
  // one judged row in words — the report table and the hover card say the same thing
  function rowText(r) {
    const raw = r.unit === 'log' || r.unit === 'deg', f = (x) => (raw ? (+x).toFixed(2) + (r.unit === 'deg' ? '°' : '') : fmtCd(x));
    const need = (r.isMin ? '≥ ' : '≤ ') + (r.rel ? r.rel.factor + '×' + r.rel.ref + (isFinite(r.bound) ? ' (' + fmtCd(r.bound) + ')' : '') : f(r.bound));
    const got = isFinite(r.value) ? f(r.value) + ' ± ' + f(r.sd) : '—';
    const fac = isFinite(r.margin) ? Math.pow(10, Math.abs(r.margin)) : NaN;
    const off = !(r.margin < 0) ? (isFinite(fac) && r.unit !== 'deg' && r.unit !== 'log' ? '×' + fac.toFixed(2) + ' headroom' : '') : r.unit === 'deg' ? (r.value - r.bound).toFixed(2) + '° over' : r.isMin && !(r.value > 0) ? 'no light read here' : '×' + fac.toFixed(2) + (r.isMin ? ' short' : ' over');
    const mk = { pass: '✓', fail: '✗', unsure: '?' }[r.verdict];
    return { need, got, off, mk };
  }
  // keep tracing the finished run to ×2 the rays (no restart)
  function refineButton(ui) {
    const N = ui.run ? ui.run.ctx.N : 0, b = el('button', { type: 'button', class: 'text', title: 'Keep tracing this run up to twice the rays. The new rays are GUIDED: emission directions whose light lands in the dim parts of the spec window (sign points, zone III, B50L) get more of them, each weighted so every intensity stays unbiased — ~3–50× the effective rays at the dim points for ~30 % fewer in the hot spot.' }, 'Refine → ' + RF.U.fmtInt(2 * N) + ' rays (guided)');
    b.addEventListener('click', () => ui.refine(2));
    return b;
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
  function drawItems(ctx, ui, toScreen, scale, evArg) {
    const m = md(ui), ev = evArg !== undefined ? evArg : ui.spec && ui.spec.ev, sh = ev ? ev.shift : [0, 0];
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
      } else if (it.kind === 'sum') {
        it.pts.forEach(([h, vv], i) => { const p = S(h, vv); if (!p) return; ctx.strokeRect(p[0] - 3.5, p[1] - 3.5, 7, 7); if (i === 0) label(it.name, p[0] + 6, p[1] - 5); });
      } else if (it.kind === 'linearity') {
        for (const h of it.hs) { const a = S(h, it.v0), b = S(h, it.v1); if (!a || !b) continue; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]); }
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
  // the picture is smoothed over at least ±0.15° (a regulation photocell, ±0.075°, leaves single rays as speckle); the
  // judge and the tap readout use the real kernel
  const dispK = (ui) => Math.max(md(ui).kernel || 0.15, 0.15);
  // far-field view options (per viewer, remembered): colour scale, isocandela contours, spec overlay, aim marker
  const FF_DEF = { scale: 'log', contours: true, overlay: true, aim: true, road: false, heat: 'beam' };
  function ffOpts(ui) {
    if (!ui.ffOpts) { let o = {}; try { o = JSON.parse(localStorage.getItem('flux/ffView') || '{}'); } catch (e) { /* ignore */ } ui.ffOpts = Object.assign({}, FF_DEF, o); }
    return ui.ffOpts;
  }
  function setFF(ui, k, v) {
    ffOpts(ui)[k] = v;
    try { localStorage.setItem('flux/ffView', JSON.stringify(ui.ffOpts)); } catch (e) { /* ignore */ }
    ui.redrawSpec();
  }
  // intensity image of a far-field grid: log = 3 decades under the robust peak, lin = 0 … robust peak
  function ffImage(ui, s) {
    const k = dispK(ui), scale = ffOpts(ui).scale;
    if (s.img && s.imgK === k && s.imgScale === scale) return s.img;
    const G = s.G;
    if (!s.preview && (!s.M || s.imgK !== k)) {
      s.M = RF.FarField.map(G, k); s.cont = null;
      const cd = s.M.cd, lit = []; for (let q = 0; q < cd.length; q++) if (cd[q] > 0) lit.push(cd[q]); lit.sort((a, b) => a - b);
      s.top = lit.length ? lit[Math.min(lit.length - 1, Math.floor(0.999 * lit.length))] : 1; s.lo = s.top / 1000;
    }
    const cd = s.M.cd, top = s.top, lo = s.lo, log = scale !== 'lin';
    const cv = s.img || document.createElement('canvas'); cv.width = G.nh; cv.height = G.nv;
    const g = cv.getContext('2d'), im = g.createImageData(G.nh, G.nv), LUT = RF.Render.LUT;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const x = cd[j * G.nh + i], o = 4 * ((G.nv - 1 - j) * G.nh + i);
      const t = log ? (x > lo ? Math.min(255, Math.round(255 * Math.log10(x / lo) / 3)) : 0) : Math.max(0, Math.min(255, Math.round(255 * x / top)));
      im.data[o] = LUT[3 * t]; im.data[o + 1] = LUT[3 * t + 1]; im.data[o + 2] = LUT[3 * t + 2]; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    s.img = cv; s.imgK = k; s.imgScale = scale;
    return cv;
  }
  // the wide context grid, coloured on the fine grid's scale (call after ffImage)
  function ffImageWide(ui, s) {
    if (!s.Gw) return null;
    const k = dispK(ui), scale = ffOpts(ui).scale;
    if (s.imgW && s.imgWK === k && s.imgWScale === scale && s.imgWTop === s.top) return s.imgW;
    const G = s.Gw, cd = s.MW ? s.MW.cd : RF.FarField.map(G, k).cd, top = s.top, lo = s.lo, log = scale !== 'lin';
    const cv = s.imgW || document.createElement('canvas'); cv.width = G.nh; cv.height = G.nv;
    const g = cv.getContext('2d'), im = g.createImageData(G.nh, G.nv), LUT = RF.Render.LUT;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const x = cd[j * G.nh + i], o = 4 * ((G.nv - 1 - j) * G.nh + i);
      const t = log ? (x > lo ? Math.min(255, Math.round(255 * Math.log10(x / lo) / 3)) : 0) : Math.max(0, Math.min(255, Math.round(255 * x / top)));
      im.data[o] = LUT[3 * t]; im.data[o + 1] = LUT[3 * t + 1]; im.data[o + 2] = LUT[3 * t + 2]; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    s.imgW = cv; s.imgWK = k; s.imgWScale = scale; s.imgWTop = top;
    return cv;
  }
  // isocandela levels: the 1–3 half-decade series from top/30 to the peak (≤ 6 lines). Dimmer levels sit in shot noise
  // even at ~2M rays and draw speckle loops, so they're left to the colour scale.
  function contourLevels(lo, top) {
    const out = [], floor = Math.max(lo * 2, top / 30);
    for (let e = Math.floor(Math.log10(floor)); e <= Math.ceil(Math.log10(top)); e++) for (const m of [1, 3]) { const L = m * 10 ** e; if (L >= floor && L < top * 0.95) out.push(L); }
    return out.slice(-6);
  }
  // marching squares on the smoothed map (corners = bin centres) → per level, segments as [h0, v0, h1, v1, …] in degrees
  function contours(s) {
    if (s.cont) return s.cont;
    const G = s.G, cd = s.M.cd, nh = G.nh, nv = G.nv, st = G.step, H = (i) => G.h0 + (i + 0.5) * st, V = (j) => G.v0 + (j + 0.5) * st;
    s.cont = contourLevels(s.lo, s.top).map((L) => {
      const seg = [], f = (a, b) => (L - a) / (b - a);
      for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nh; i++) {
        const a = cd[j * nh + i], b = cd[j * nh + i + 1], c = cd[(j + 1) * nh + i + 1], d = cd[(j + 1) * nh + i];
        const idx = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        // edge crossings: bottom (a–b), right (b–c), top (d–c), left (a–d)
        const E = [
          (a > L) !== (b > L) ? [H(i) + f(a, b) * st, V(j)] : null,
          (b > L) !== (c > L) ? [H(i + 1), V(j) + f(b, c) * st] : null,
          (d > L) !== (c > L) ? [H(i) + f(d, c) * st, V(j + 1)] : null,
          (a > L) !== (d > L) ? [H(i), V(j) + f(a, d) * st] : null,
        ].filter(Boolean);
        // 2 crossings: one segment; 4 (saddle): pair them by the cell's mean
        if (E.length === 2) seg.push(E[0][0], E[0][1], E[1][0], E[1][1]);
        else if (E.length === 4) { const hi = (a + b + c + d) / 4 > L; const [p0, p1, p2, p3] = E; if (hi === (a > L)) seg.push(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]); else seg.push(p0[0], p0[1], p3[0], p3[1], p1[0], p1[1], p2[0], p2[1]); }
      }
      return { L, seg };
    });
    return s.cont;
  }
  // the Result pane in Spec mode, "Far field" view: content = degrees (H right, V up)
  function drawFarField(ui, cv, view, sArg) {
    const s = sArg || ui.spec; ui.ffShown = s; const box = RF.Render.fitCanvas(cv), ctx = cv.getContext('2d');
    const win = s && s.G ? [s.G.h0, s.G.v0, s.G.h1, s.G.v1] : (() => { const w = RF.Spec.windowOf(md(ui)); return [w[0], w[2], w[1], w[3]]; })();
    // the far field is in degrees, not the paint grid: no size pairing with the Editor (that cap shrank it to the
    // smaller pane). Default fit = the spec window; zoom out to see the wide context grid around it.
    const cap = view.cap; view.cap = 0;
    if (!view.fitted || view.bounds.join() !== win.join()) view.fit(win, box.w, box.h);
    else if (view.w !== box.w || view.h !== box.h) { if (view.zoomed) view.refitKeep(win, box.w, box.h); else view.fit(win, box.w, box.h); }
    view.cap = cap; view.capAt = cap;
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0); ctx.clearRect(0, 0, box.w, box.h);
    const a = view.toScreen(win[0], win[3]), b = view.toScreen(win[2], win[1]);
    const Gw = s && s.G && s.Gw, ext = Gw ? [Gw.h0, Gw.v0, Gw.h1, Gw.v1] : win;            // what is drawn (wide when there is a context grid)
    const A = view.toScreen(ext[0], ext[3]), B = view.toScreen(ext[2], ext[1]);
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(A[0], A[1], B[0] - A[0], B[1] - A[1]);
    if (s && s.G) {
      ctx.imageSmoothingEnabled = false;
      const fine = ffImage(ui, s), heat = ffOpts(ui).heat;
      if (heat === 'limits' || heat === 'margin') ctx.drawImage(heatImage(ui, s, heat), a[0], a[1], b[0] - a[0], b[1] - a[1]);   // the regulation over the spec window
      else { const wide = ffImageWide(ui, s); if (wide) ctx.drawImage(wide, A[0], A[1], B[0] - A[0], B[1] - A[1]); ctx.drawImage(fine, a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    }
    // degree grid: H / V axes and 5° ticks (10° when zoomed far out), labels pinned to the visible edge
    const stepDeg = view.s * 5 < 22 ? 10 : 5, L = Math.max(A[0], 0), Bo = Math.min(B[1], box.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px system-ui, sans-serif';
    for (let h = Math.ceil(ext[0] / stepDeg) * stepDeg; h <= ext[2]; h += stepDeg) { const p = view.toScreen(h, 0); ctx.beginPath(); ctx.moveTo(p[0], A[1]); ctx.lineTo(p[0], B[1]); ctx.stroke(); ctx.fillText((h > 0 ? h + 'R' : h < 0 ? -h + 'L' : '0'), p[0] + 2, Bo - 3); }
    for (let v = Math.ceil(ext[1] / stepDeg) * stepDeg; v <= ext[3]; v += stepDeg) { const p = view.toScreen(0, v); ctx.beginPath(); ctx.moveTo(A[0], p[1]); ctx.lineTo(B[0], p[1]); ctx.stroke(); ctx.fillText((v > 0 ? v + 'U' : v < 0 ? -v + 'D' : 'H'), L + 3, p[1] - 2); }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; const o = view.toScreen(0, 0); ctx.beginPath(); ctx.moveTo(o[0], A[1]); ctx.lineTo(o[0], B[1]); ctx.moveTo(A[0], o[1]); ctx.lineTo(B[0], o[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(143,184,255,0.35)'; ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0] - 1, b[1] - a[1] - 1);
    const fo = ffOpts(ui), ev = s && s.ev;
    if (fo.contours && fo.heat === 'beam' && s && s.G && s.M && !s.preview && s.done) drawContours(ctx, s, view, a, b);   // a finished trace only: partial runs and 200k previews draw noise loops
    if (fo.road && s && !s.preview) drawRoadOverlay(ctx, ui, view, a, b);
    if (fo.aim && ev) drawAim(ctx, ui, ev, view, a, b);
    if (fo.overlay) drawItems(ctx, ui, (h, v) => view.toScreen(h, v), undefined, s && s.preview ? null : undefined);
    ffTools(ui, cv);
    document.getElementById('right-caption').textContent = 'Far field · ' + (s && s.G ? fmtDist(s.G.distance) : '') + ' · ' + (fo.scale === 'lin' ? 'linear' : 'log') + ' scale';
    // colour bar with ticks at real cd values (heat modes: their own legend)
    const cb = document.getElementById('colorbar'); cb.innerHTML = '';
    if (s && s.top && (fo.heat === 'limits' || fo.heat === 'margin')) {
      const grad = fo.heat === 'margin' ? 'linear-gradient(90deg, rgb(255,154,61), rgb(70,70,70) 50%, rgb(90,167,255))' : 'linear-gradient(90deg, rgb(27,50,77), rgb(90,167,255) 45%, rgb(77,46,18) 55%, rgb(255,154,61))';
      cb.append(el('i', { style: 'background:' + grad }), fo.heat === 'margin'
        ? el('div', { class: 'cb-labels', title: 'Each bin’s light against the limit that covers it (log ratio). Grey picture: no limit there. Per bin, not the verdict: zones are judged on their extreme spot with noise allowances (hover a zone for its verdict).' }, el('span', {}, '×2 short / over'), el('span', {}, 'at the limit'), el('span', {}, '×2 headroom'))
        : el('div', { class: 'cb-labels', title: 'Blue: a floor (minimum) applies, brighter = higher. Orange: a ceiling (maximum), brighter = looser. Stripes: both. Points are drawn ±' + Math.max(0.25, 2 * (md(ui).kernel || 0.15)).toFixed(2) + '° wide so they show.' }, el('span', {}, 'floors (min)'), el('span', {}, 'stripes = both'), el('span', {}, 'ceilings (max)')));
    } else if (s && s.top) {
      const log = fo.scale !== 'lin', lo = log ? s.lo : 0, top = s.top;
      const pos = (x) => 100 * (log ? Math.log10(x / lo) / 3 : x / top);
      const ticks = [];
      if (log) { for (let e = Math.ceil(Math.log10(lo)); 10 ** e < top; e++) ticks.push(10 ** e); }
      else { const raw = top / 4, p = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw); for (let x = step; x < top; x += step) ticks.push(x); }
      const inner = ticks.filter((x) => pos(x) > 14 && pos(x) < 80);   // clear of the end labels (the right one is wider)
      const bar = el('i', { style: 'background:' + RF.Render2D.colorbarCSS() });
      for (const x of ticks) bar.append(el('b', { style: 'left:' + pos(x).toFixed(1) + '%' }));
      const labels = el('div', { class: 'cb-labels ticks', title: (log ? 'Log scale, 3 decades under the robust peak. ' : 'Linear scale, 0 to the robust peak (99.9th percentile). ') + (s.G && isFinite(s.G.distance) ? 'Apparent intensity on a screen at ' + fmtDist(s.G.distance) : 'Far field: intensity by direction') + '. Picture smoothed over ±' + dispK(ui) + '°; the report reads ±' + md(ui).kernel + '°.' },
        el('span', { class: 'end-l' }, fmtCd(lo) + ' cd'));
      for (const x of inner) labels.append(el('span', { style: 'left:' + pos(x).toFixed(1) + '%' }, fmtCd(x)));
      labels.append(el('span', { class: 'end-r' }, fmtCd(top) + ' cd'));
      cb.append(bar, labels);
    }
  }
  function drawFarFieldPreview(ui, cv, view, t) {
    if (!t._s) {
      const f = t.ff[0], wd = t.ff[1], cd = f.cd, lit = [];
      for (let q = 0; q < cd.length; q++) if (cd[q] > 0) lit.push(cd[q]); lit.sort((a, b) => a - b);
      const top = lit.length ? lit[Math.min(lit.length - 1, Math.floor(0.999 * lit.length))] : 1;
      const G = (g) => ({ nh: g.nh, nv: g.nv, h0: g.h0, v0: g.v0, h1: g.h1, v1: g.v1, step: g.step, distance: g.distance });
      t._s = { preview: true, G: G(f), Gw: wd ? G(wd) : null, M: { cd }, MW: wd ? { cd: wd.cd } : null, top, lo: top / 1000, imgK: dispK(ui), ev: null };
    }
    drawFarField(ui, cv, view, t._s);
  }
  // isocandela lines (unshifted: they belong to the beam, like the picture)
  function drawContours(ctx, s, view, a, b) {
    ctx.save(); ctx.beginPath(); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.clip();
    ctx.lineWidth = 1; ctx.font = '10px system-ui, sans-serif';
    for (const { L, seg } of contours(s)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath();
      let lab = null;
      for (let q = 0; q < seg.length; q += 4) {
        const p = view.toScreen(seg[q], seg[q + 1]), r = view.toScreen(seg[q + 2], seg[q + 3]);
        ctx.moveTo(p[0], p[1]); ctx.lineTo(r[0], r[1]);
        if (!lab || p[1] < lab[1]) lab = p;                              // label at the line's top
      }
      ctx.stroke();
      if (lab) { const t = fmtCd(L); ctx.fillStyle = 'rgba(12,13,16,0.75)'; ctx.fillRect(lab[0] - 1, lab[1] - 10, ctx.measureText(t).width + 2, 11); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(t, lab[0], lab[1] - 1); }
    }
    ctx.restore();
  }
  // where the judge aimed: the spec's H-V on the beam (the overlay sits on it) and the line the cut-off was put on
  function drawAim(ctx, ui, ev, view, a, b) {
    const m = md(ui), sh = ev.shift || [0, 0], c = view.toScreen(sh[0], sh[1]);
    ctx.save(); ctx.beginPath(); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a[0], c[1]); ctx.lineTo(b[0], c[1]); ctx.moveTo(c[0], a[1]); ctx.lineTo(c[0], b[1]); ctx.stroke();
    if ((m.aimMode || 'design') === 'cutoff') {
      const line = m.aimLine === undefined ? -0.57 : m.aimLine, y = view.toScreen(0, line + sh[1])[1];
      ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a[0], y); ctx.lineTo(b[0], y); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(c[0], c[1], 5, 0, 2 * Math.PI); ctx.stroke();
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    // summary in the plot's top-right corner (away from the beam): how far the judge moved the beam
    const mv = fmtMove(sh, m.traffic).replace(/ right/g, ' R').replace(/ left/g, ' L').replace(/ up/g, ' U').replace(/ down/g, ' D');
    const t = 'aim: beam ' + (mv === 'none' ? 'as designed' : mv) + ((m.aimMode || 'design') === 'cutoff' ? ' · cut-off on ' + Math.abs(m.aimLine === undefined ? -0.57 : m.aimLine) + '° D' : '');
    const w = ctx.measureText(t).width, x = Math.max(a[0] + 3, b[0] - w - 5), y = a[1] + 13;
    ctx.fillStyle = 'rgba(12,13,16,0.75)'; ctx.fillRect(x - 2, y - 10, w + 4, 13); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(t, x, y);
    ctx.restore();
  }
  // the far-field view's toggles, floating in the canvas corner (no layout change)
  function ffTools(ui, cv) {
    const wrap = cv.parentElement; let bar = wrap.querySelector('.ff-tools');
    if (!bar) {
      bar = el('div', { class: 'ff-tools' });
      const mk = (k, label, title, val) => {
        const b = el('button', { type: 'button', class: 'toggle', 'data-ff': k, title }, label);
        b.addEventListener('click', () => { const o = ffOpts(ui); setFF(ui, k, k === 'scale' ? (o.scale === 'lin' ? 'log' : 'lin') : !o[k]); });
        return b;
      };
      const hb = el('button', { type: 'button', class: 'toggle', 'data-ff': 'heat', title: 'What the picture shows: the beam, the regulation’s limits (floors blue, ceilings orange), or the margin (the beam against its local limit: blue headroom, orange short / over)' }, 'beam');
      hb.addEventListener('click', () => { const o = ffOpts(ui), nx = { beam: 'limits', limits: 'margin', margin: 'beam' }; setFF(ui, 'heat', nx[o.heat] || 'beam'); });
      bar.append(hb);
      bar.append(mk('scale', 'log', 'Colour scale: log (3 decades) or linear (like Hits / Grid)'), mk('contours', 'isocd', 'Isocandela lines at 1–3 steps per decade, labelled in cd'),
        mk('overlay', 'spec', 'The spec’s points and zones with their verdicts'), mk('aim', 'aim', 'Where the judge aimed: the spec’s H-V on the beam (dashed cross) and the line the cut-off was put on (dotted)'),
        mk('road', 'road', 'The road’s lane lines and the horizon as the right-hand lamp sees them on the car (Spec → Road sets lanes, height, aim)'));
      wrap.append(bar);
    }
    const o = ffOpts(ui);
    for (const b of bar.querySelectorAll('[data-ff]')) {
      const k = b.dataset.ff;
      if (k === 'scale') { b.textContent = o.scale === 'lin' ? 'lin' : 'log'; b.setAttribute('aria-pressed', 'true'); }
      else if (k === 'heat') { b.textContent = o.heat || 'beam'; b.setAttribute('aria-pressed', String((o.heat || 'beam') !== 'beam')); }
      else b.setAttribute('aria-pressed', String(!!o[k]));
    }
  }
  // ---------------------------------------------------------------- regulation heat map (Far field → beam / limits / margin)
  // floor / ceiling per fine-grid bin, in the beam's frame (the judge's aim shift applied, like the overlay); cached
  function limitsGrid(ui, s) {
    const m0 = md(ui), sh = s.ev ? s.ev.shift : [0, 0], key = JSON.stringify([m0.items, m0.preset, sh, m0.kernel, s.G.nh, s.G.nv, s.G.h0, s.G.v0]);
    if (s.lim && s.limKey === key) return s.lim;
    const G = s.G, items = RF.Spec.itemsOf(m0), rad = Math.max(0.25, 2 * (m0.kernel || 0.15)), n = G.nh * G.nv, lo = new Float32Array(n), hi = new Float32Array(n);
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const L = RF.Spec.limitsAt(items, G.h0 + (i + 0.5) * G.step - sh[0], G.v0 + (j + 0.5) * G.step - sh[1], rad);
      lo[j * G.nh + i] = L.lo; hi[j * G.nh + i] = isFinite(L.hi) ? L.hi : 0;
    }
    s.lim = { lo, hi }; s.limKey = key; s.heatImg = null;
    return s.lim;
  }
  const BLUE = [90, 167, 255], ORANGE = [255, 154, 61];
  // limits: blue = a floor (darker = lower), orange = a ceiling (darker = stricter), stripes = both.
  // margin: the beam against its local limit (log ratio; ×2 = full colour): blue = headroom, orange = short / over; the
  // unconstrained beam stays as a grey picture for context. Per bin, not the judge (zones judge their extreme spot).
  function heatImage(ui, s, mode) {
    const lim = limitsGrid(ui, s), key = mode + '|' + s.limKey + '|' + (s.imgK || '') + '|' + (s.next || 0);
    if (s.heatImg && s.heatKey === key) return s.heatImg;
    const G = s.G, cd = s.M.cd, top = s.top || 1, cv = document.createElement('canvas'); cv.width = G.nh; cv.height = G.nv;
    const g = cv.getContext('2d'), im = g.createImageData(G.nh, G.nv);
    const shade = (x) => Math.max(0.3, Math.min(1, 0.3 + 0.7 * Math.log10(Math.max(10, x) / 10) / 4));   // 10 cd … 100k cd
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const k = j * G.nh + i, lo = lim.lo[k], hi = lim.hi[k], o = 4 * ((G.nv - 1 - j) * G.nh + i);
      let r = 12, gg = 13, b = 16;
      if (mode === 'limits') {
        const pick = lo > 0 && hi > 0 ? (((i + j) >> 1) & 1 ? 'lo' : 'hi') : lo > 0 ? 'lo' : hi > 0 ? 'hi' : null;
        if (pick) { const c = pick === 'lo' ? BLUE : ORANGE, t = shade(pick === 'lo' ? lo : hi); r = c[0] * t; gg = c[1] * t; b = c[2] * t; }
      } else {
        const x = cd[k], mF = lo > 0 ? Math.log10(Math.max(x, 1e-9) / lo) : Infinity, mC = hi > 0 ? Math.log10(hi / Math.max(x, 1e-9)) : Infinity, m = Math.min(mF, mC);
        if (isFinite(m)) { const a = Math.min(1, Math.abs(m) / Math.log10(2)), c = m >= 0 ? BLUE : ORANGE, base = 70; r = base + (c[0] - base) * a; gg = base + (c[1] - base) * a; b = base + (c[2] - base) * a; }
        else { const t = x > 0 ? Math.min(1, Math.log10(Math.max(1, x * 1000 / top)) / 3) : 0; r = gg = b = 16 + 90 * t; }
      }
      im.data[o] = r; im.data[o + 1] = gg; im.data[o + 2] = b; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0); s.heatImg = cv; s.heatKey = key;
    return cv;
  }
  // ---------------------------------------------------------------- road (Road view, far-field road overlay, IIHS reach)
  const roadOf = (ui) => {
    const m0 = md(ui); if (!m0.road) m0.road = RF.Road.defaults();
    // scenes saved before regulation defaults hold the old generic 0.65 m: that was a default, not a choice
    if (!m0.road.v) { m0.road.v = 2; if (m0.road.mountH === 0.65) m0.road.mountH = null; }
    return m0.road;
  };
  // road settings only redraw: no new trace, no re-judging
  function roadChanged(ui) { ui.autosave(); if (ui.spec) ui.spec.road = null; ui.redrawSpec(); if (ui.rerenderStats) ui.rerenderStats(); render(ui); }
  function roadRows(ui, row) {
    const r = () => roadOf(ui);
    const rsel = (opts, get, set) => { const x = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v }, t))); x.dataset.spec = '1'; x._get = get; x.addEventListener('change', () => { set(x.value); roadChanged(ui); }); return x; };
    const rnum = (get, set, o) => { const x = el('input', Object.assign({ type: 'number', step: 'any' }, o)); x.dataset.spec = '1'; x._get = get; x.addEventListener('change', () => { const v = +x.value; if (isFinite(v)) set(v); roadChanged(ui); }); return x; };
    const rchk = (get, set) => { const x = el('input', { type: 'checkbox' }); x.dataset.spec = '1'; x._get = get; x._chk = true; x.addEventListener('change', () => { set(x.checked); roadChanged(ui); }); return x; };
    return [
      el('div', { class: 'note' }, 'A straight two-lane road lit by this beam: Result → Road (bird’s-eye), Far field → road, and the 5 lx reach in the footer. The reach follows IIHS (5 lx, 25 cm up, edges of a 6.6 m road); the lanes drawn follow the width below. Right-hand traffic (mirrored for left-hand).'),
      row('Lane width', rsel([['auto', 'By preset (ECE → R112 reference, FMVSS → US)'], ['r112', 'R112 reference: right edge 1.5 m from the lamp'], ['us', 'US 3.6 m (12 ft)'], ['eu', 'EU 3.5 m'], ['iihs', 'IIHS 3.3 m']], () => r().lane, (v) => { r().lane = v; }),
        'R112’s 75R and 50R test points sit 1.5 m right of the lamp axis, so on the reference road its right edge passes through them (Road view and the far-field overlay). The Drive view keeps a real lane (ECE 3.5 m, FMVSS 3.6 m) unless you pick the reference lane here. FMVSS points are plain angles, so it keeps the US 3.6 m.'),
      row('Mounting height (m)', rnum(() => r().mountH > 0 ? r().mountH : RF.Road.mountDefault(md(ui).preset), (v) => { r().mountH = v > 0 ? Math.max(0.2, Math.min(2, v)) : null; }, { min: 0.2, max: 2, step: 0.05 }), 'Height of the lamp above the road. A regulation spec sets its own until you type one: ECE R112 0.75 m (its V angles are 1 % / 1.5 % / 3 % of 75 / 50 / 25 m at that height), otherwise 0.65 m. R48 §6.2.6.1.2 sets the dipped-beam aim by it: under 0.8 m, −1.0 to −1.5 %; over 1.0 m, −1.5 to −2.0 %.'),
      row('Lamp spacing (m)', rnum(() => r().spacing, (v) => { r().spacing = Math.max(0, Math.min(2.5, v)); }, { min: 0, max: 2.5, step: 0.05 }), 'Between the two lamps’ centres. Both lamps are this same design (a real pair has the same beam, not mirror images), so two lamps cost no extra rays.'),
      row('Two lamps', rchk(() => r().two !== false, (v) => { r().two = v; }), 'Off: only the right-hand lamp.'),
      row('Road view: scale top (lx)', rnum(() => rvOpts(ui).max || '', (v) => { setRV(ui, 'max', v > 0 ? v : 0); }, { min: 0, step: 'any', placeholder: 'auto' }), 'Top of the Road view’s colour scale. Empty = automatic: 30 lx on the log scale, the 99.5th percentile of the picture on the linear one.'),
      row('Road view: extra outline (lx)', rnum(() => rvOpts(ui).extra || '', (v) => { setRV(ui, 'extra', v > 0 ? v : 0); }, { min: 0, step: 'any', placeholder: 'none' }), 'One more outline at this level, besides the 1 / 3 / 5 / 10 / 30 lx toggles on the Road view.'),
      row('Road view: sideways stretch', rsel([['fit', 'Fit the pane (straight road)'], ['1', '×1 (true shape)'], ['2', '×2'], ['4', '×4']], () => String(rvOpts(ui).stretch), (v) => { setRV(ui, 'stretch', v === 'fit' ? 'fit' : +v); }), 'A straight road is a long thin strip; this stretches it sideways to fill the pane (the caption says by how much). A bend is always drawn true.'),
      row('Drive view: marking reflectivity (mcd/m²/lx)', rnum(() => dvOpts(ui).RL, (v) => { setDV(ui, 'RL', Math.max(0, Math.min(1000, v))); }, { min: 0, max: 1000, step: 10 }), 'Retroreflected luminance coefficient R_L of white road paint, at the standard headlamp-and-driver geometry (EN 1436: classes R2–R5 are 100–300 minimum; worn paint is lower, glass-bead paint when new is higher). Yellow paint uses 0.6 ×.'),
      row('Drive view: ambient light', rsel([['0', 'None (headlamp only)'], ['0.2', 'Full moon (0.2 lx)'], ['5', 'Dusk (5 lx)']], () => String(dvOpts(ui).ambient), (v) => { setDV(ui, 'ambient', +v); }), 'Light on diffuse surfaces from the sky, besides the lamps. None judges the beam alone.'),
      row('Drive view: oncoming car distance (m)', rnum(() => dvOpts(ui).onDist, (v) => { setDV(ui, 'onDist', Math.max(10, Math.min(400, v))); }, { min: 10, max: 400, step: 5 }), 'Where the oncoming car is (the “oncoming” toggle on the Drive view). Its headlamps are emitters, seen at the intensity below.'),
      row('Drive view: oncoming headlamp intensity (kcd)', rnum(() => dvOpts(ui).onKcd, (v) => { setDV(ui, 'onKcd', Math.max(1, Math.min(500, v))); }, { min: 1, max: 500, step: 5 }), 'Both lamps together, toward you. A passing beam seen head-on is roughly 30–60 kcd; a driving beam 100+.'),
      row('Drive view: preceding car distance (m)', rnum(() => dvOpts(ui).preDist, (v) => { setDV(ui, 'preDist', Math.max(5, Math.min(300, v))); }, { min: 5, max: 300, step: 5 }), 'Where the car ahead of you is (the “preceding” toggle): tail lamps lit, retroreflective plate and reflectors lit by your beam.'),
      row('Drive view: beam smoothing', rsel([['sharp', 'Sharp (0.2° × 0.2°)'], ['smooth', 'Smooth along H (0.5° × 0.15°)'], ['soft', 'Soft (1° × 0.3°)']], () => dvOpts(ui).smooth, (v) => { setDV(ui, 'smooth', v); }), 'The trace is a few million rays, so the beam has shot noise that the picture shows as mottled asphalt. Smoothing along H leaves the cut-off (a vertical edge) sharp. Raise the ray count (Simulation) for a cleaner picture.'),
      row('Drive view: picture size', rsel([['480', '480 × 270'], ['640', '640 × 360'], ['960', '960 × 540'], ['1280', '1280 × 720']], () => String(dvOpts(ui).res), (v) => { setDV(ui, 'res', +v); }), 'Render size. 640 takes ~0.3 s in the browser; 1280 about a second in a forest or city.'),
      row('Drive view: field of view (°)', rsel([['45', '45 (telephoto)'], ['60', '60'], ['75', '75'], ['90', '90 (wide)']], () => String(dvOpts(ui).fov), (v) => { setDV(ui, 'fov', +v); }), 'Horizontal field of view. The eye is 1.2 m up, 2 m behind the lamps, 0.37 m left of the car centre (mirrored for left-hand traffic).'),
      row('Aim on the car', rsel([['spec', 'As the spec’s lab aims it'], ['manual', 'Manual inclination (%)']], () => r().aim, (v) => { r().aim = v; }), 'As the lab aims it: the same aim the report uses. Manual: the cut-off (where the judge found it) is set at this downward slope; 1 % = 1 cm per metre ≈ 0.57°.'),
      row('Inclination (%)', rnum(() => r().aimPct, (v) => { r().aimPct = Math.max(-5, Math.min(1, v)); }, { min: -5, max: 1, step: 0.1 }), 'Used with "Manual". R48 initial aim: −1.0 to −1.5 % below 0.8 m mounting height; FMVSS VOL ≈ −0.7 % (0.4° D).'),
    ];
  }
  // the road model on the judged far field (the fine grid where it covers the direction, else the wide one); cached
  function roadModel(ui) {
    const s = ui.spec; if (!s || !s.G || !s.ev || !RF.Road) return null;
    const road = roadOf(ui), key = JSON.stringify([road, md(ui).preset]);
    if (s.road && s.roadKey === key) return s.road;
    const sh = RF.Road.aimShift(road, s.ev), G = s.G, W = s.Gw, k = 0.2, mir = md(ui).traffic === 'LHT' ? -1 : 1;
    // the beam as the road sees it: the judged fine grid where it covers the direction, else the wide one; kh × kv = the kernel
    // half-widths (degrees) on the fine grid, kw × the wide grid's bin on the wide one
    const mkI = (kh, kv, kw) => RF.Road.beamOf(G, W, sh, mir, kh, kv, kw), I = mkI(k, k, 1);
    const mdl = RF.Road.model({ road, preset: md(ui).preset, conv: G.conv || md(ui).conv || 'A', I });
    s.road = { mdl, sh, mir, mkI, iihs: mdl.iihs(), curves: mdl.curves(), quality: RF.BeamQuality ? RF.BeamQuality.measure(I) : null, lane: RF.Road.laneWidth(mdl.road, md(ui).preset), laneDrive: RF.Road.laneWidth(mdl.road, md(ui).preset, true), map: null }; s.roadKey = key;
    return s.road;
  }
  // a tiny marching squares for one level on a grid E[j·ny + i] (j along x, i along y) → segment end points in (x, y)
  function iso(Mp, L) {
    const { E, nx, ny, x0, x1, y0, y1 } = Mp, dx = (x1 - x0) / nx, dy = (y1 - y0) / ny, X = (j) => x0 + (j + 0.5) * dx, Y = (i) => y0 + (i + 0.5) * dy, seg = [];
    for (let j = 0; j + 1 < nx; j++) for (let i = 0; i + 1 < ny; i++) {
      const a = E[j * ny + i], b = E[(j + 1) * ny + i], c = E[(j + 1) * ny + i + 1], d = E[j * ny + i + 1], pts = [];
      if ((a >= L) !== (b >= L)) pts.push([X(j) + (L - a) / (b - a) * dx, Y(i)]);
      if ((b >= L) !== (c >= L)) pts.push([X(j + 1), Y(i) + (L - b) / (c - b) * dy]);
      if ((d >= L) !== (c >= L)) pts.push([X(j) + (L - d) / (c - d) * dx, Y(i + 1)]);
      if ((a >= L) !== (d >= L)) pts.push([X(j), Y(i) + (L - a) / (d - a) * dy]);
      if (pts.length >= 2) seg.push(pts[0], pts[1]);
      if (pts.length === 4) seg.push(pts[2], pts[3]);
    }
    return seg;
  }
  // ---- Road view options (per viewer, remembered, like the far field's): the bend, how far, the colour scale and its top,
  // which lux outlines, which sensor. Only the picture changes; the road settings (Spec → Road) are the scene's.
  const RV_DEF = { shape: 'straight', range: 100, scale: 'log', max: 0, lev: [5], extra: 0, sensor: 'car', stretch: 'fit' };
  const RV_SHAPES = ['straight', '250R', '250L', '150R', '150L'], RV_RANGES = [50, 100, 200, 300], RV_LEVELS = [1, 3, 5, 10, 30];
  function rvOpts(ui) {
    if (!ui.rvOpts) { let o = {}; try { o = JSON.parse(localStorage.getItem('flux/roadView') || '{}'); } catch (e) { /* ignore */ } ui.rvOpts = Object.assign({}, RV_DEF, o); }
    return ui.rvOpts;
  }
  function setRV(ui, k, v) {
    rvOpts(ui)[k] = v;
    try { localStorage.setItem('flux/roadView', JSON.stringify(ui.rvOpts)); } catch (e) { /* ignore */ }
    ui.redrawSpec();
  }
  const parseShape = (sh) => { const m = /^(\d+)([RL])$/.exec(sh || ''); return m ? { R: +m[1], dir: m[2] === 'R' ? 'right' : 'left' } : null; };
  // the view's content box in metres (x ahead, y left): ±10 m of a straight road; a bend's lane centre ± 9 m
  function roadBox(o) {
    const sp = parseShape(o.shape), range = o.range;
    if (!sp) return { sp: null, A: null, B: [0, -10, range, 10] };
    const A = RF.Road.arc(sp.R, sp.dir); let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    for (let q = 0; q <= 60; q++) { const p = A.at(range * q / 60, 0).p; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return { sp, A, B: [x0 - 3, y0 - 9, x1 + 9, y1 + 9] };
  }
  // the lux map for the current view (cached on the road model; recolouring does not recompute it)
  function roadMap(ui, rd, o, bx) {
    const key = JSON.stringify([o.shape, o.range, o.sensor, bx.B]);
    if (rd.map && rd.map.key === key) return rd.map;
    const B = bx.B, w = B[2] - B[0], h = B[3] - B[1], dx = Math.max(0.25, Math.sqrt(w * h / 110000)), nx = Math.max(20, Math.ceil(w / dx)), ny = Math.max(10, Math.ceil(h / dx));
    const up = o.sensor === 'up';
    const Mp = rd.mdl.map({ nx, ny, x0: B[0], x1: B[2], y0: B[1], y1: B[3], z: up ? 0 : RF.Road.IIHS.sensorZ, facing: up ? 'up' : 'car', arc: up ? null : bx.sp });
    rd.map = { key, Mp, isos: {}, img: null, imgKey: '' };
    return rd.map;
  }
  // colour scale: log = two decades under the top (30 lx unless overridden), linear = 0 … top (auto: the 99.5th percentile of the map)
  function roadScale(o, Mp) {
    if (o.scale === 'lin') {
      let top = o.max > 0 ? o.max : 0;
      if (!(top > 0)) { const v = []; for (let q = 0; q < Mp.E.length; q++) if (Mp.E[q] > 0) v.push(Mp.E[q]); v.sort((a, b) => a - b); top = v.length ? v[Math.min(v.length - 1, Math.floor(0.995 * v.length))] : 1; }
      return { log: false, lo: 0, top };
    }
    const top = o.max > 0 ? o.max : 30; return { log: true, lo: top / 100, top };
  }
  const niceTicks = (lo, hi) => { const t = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v > lo * 1.0001 && v < hi * 0.9999) t.push(+v.toPrecision(2)); } return t; };
  const fmtLx = (x) => x >= 100 ? Math.round(x) + '' : x >= 10 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, '');
  // the floating toggles in the canvas corner (Road view only)
  function roadTools(ui, cv) {
    const wrap = cv.parentElement; let bar = wrap.querySelector('.road-tools');
    if (!bar) {
      bar = el('div', { class: 'road-tools' });
      const mk = (k, title, fn) => { const b = el('button', { type: 'button', class: 'toggle', 'data-rv': k, title }); b.addEventListener('click', fn); bar.append(b); return b; };
      mk('shape', 'The road: straight, or an IIHS bend (250 / 150 m radius, right or left). The beam keeps pointing straight ahead; the lanes bend away.', () => { const o = rvOpts(ui); setRV(ui, 'shape', RV_SHAPES[(RV_SHAPES.indexOf(o.shape) + 1) % RV_SHAPES.length]); });
      mk('range', 'How far ahead the view starts at (100 m by default; high beams reach 200 m). Along the lane centre on a bend.', () => { const o = rvOpts(ui); setRV(ui, 'range', RV_RANGES[(RV_RANGES.indexOf(o.range) + 1) % RV_RANGES.length]); });
      mk('scale', 'Colour scale: log (two decades, bright zones clip) or linear (0 to the top; the top is automatic unless Spec → Road sets one)', () => { const o = rvOpts(ui); setRV(ui, 'scale', o.scale === 'lin' ? 'log' : 'lin'); });
      mk('sensor', 'What measures the light: a vertical sensor 25 cm up facing the car (IIHS), or the road surface itself (a ground-plane sensor: about r / h times dimmer far out)', () => { const o = rvOpts(ui); setRV(ui, 'sensor', o.sensor === 'up' ? 'car' : 'up'); });
      for (const L of RV_LEVELS) mk('lev' + L, 'Outline where the light reaches ' + L + ' lx' + (L === 5 ? ' (the IIHS visibility level)' : ''), () => { const o = rvOpts(ui), has = o.lev.indexOf(L) >= 0; setRV(ui, 'lev', has ? o.lev.filter((x) => x !== L) : o.lev.concat([L]).sort((a, b) => a - b)); });
      wrap.append(bar);
    }
    const o = rvOpts(ui);
    for (const b of bar.querySelectorAll('[data-rv]')) {
      const k = b.dataset.rv;
      if (k === 'shape') { b.textContent = o.shape === 'straight' ? 'straight' : o.shape.replace(/([RL])$/, ' $1'); b.setAttribute('aria-pressed', String(o.shape !== 'straight')); }
      else if (k === 'range') { b.textContent = o.range + ' m'; b.setAttribute('aria-pressed', 'false'); }
      else if (k === 'scale') { b.textContent = o.scale === 'lin' ? 'lin' : 'log'; b.setAttribute('aria-pressed', 'true'); }
      else if (k === 'sensor') { b.textContent = o.sensor === 'up' ? 'ground' : 'vertical'; b.setAttribute('aria-pressed', String(o.sensor === 'up')); }
      else { const L = +k.slice(3); b.textContent = L + ' lx'; b.setAttribute('aria-pressed', String(o.lev.indexOf(L) >= 0)); }
    }
  }
  // Result → Road: bird's-eye, x ahead to the right, y (left) up; lux on a vertical sensor 25 cm up facing the car, or on the road
  function drawRoad(ui, cv, view) {
    const box = RF.Render.fitCanvas(cv), ctx = cv.getContext('2d'), rd = roadModel(ui), o = rvOpts(ui);
    roadTools(ui, cv);
    const bx = roadBox(o), B0 = bx.B;
    // a straight road is a long thin strip: stretch it sideways to fill the pane (the caption says by how much); a bend is drawn true
    const k = bx.sp ? 1 : o.stretch === 'fit' ? Math.max(1, Math.min(6, Math.round(10 * box.h * (B0[2] - B0[0]) / (box.w * (B0[3] - B0[1]))) / 10)) : +o.stretch || 1;
    const B = [B0[0], B0[1] * k, B0[2], B0[3] * k]; view.roadK = k;
    const cap = view.cap; view.cap = 0;
    if (!view.fitted || view.bounds.join() !== B.join()) view.fit(B, box.w, box.h);
    else if (view.w !== box.w || view.h !== box.h) { if (view.zoomed) view.refitKeep(B, box.w, box.h); else view.fit(B, box.w, box.h); }
    view.cap = cap; view.capAt = cap;
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0); ctx.clearRect(0, 0, box.w, box.h);
    const S = (x, y) => view.toScreen(x, y * k), a = S(B0[0], B0[3]), b = S(B0[2], B0[1]);
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    const up = o.sensor === 'up';
    document.getElementById('right-caption').textContent = 'Road · bird’s-eye · lux on ' + (up ? 'the road surface' : 'a vertical sensor 25 cm up, facing the car (IIHS)') + ' · ' + (bx.sp ? o.shape.replace(/([RL])$/, ' m $1') + ' bend' : 'straight' + (k > 1.05 ? ', sideways ×' + k.toFixed(1) : ''));
    const cb = document.getElementById('colorbar'); cb.innerHTML = '';
    if (!rd) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px system-ui'; ctx.fillText('The road appears when the trace has been judged.', a[0] + 10, a[1] + 20); return; }
    const M = roadMap(ui, rd, o, bx), Mp = M.Mp, sc = roadScale(o, Mp), imgKey = JSON.stringify([sc.log, sc.lo, sc.top]);
    if (M.imgKey !== imgKey) {
      const cvs = M.img || document.createElement('canvas'); cvs.width = Mp.nx; cvs.height = Mp.ny;
      const g = cvs.getContext('2d'), im = g.createImageData(Mp.nx, Mp.ny), LUT = RF.Render.LUT, dec = Math.log10(sc.top / (sc.lo || 1));
      for (let j = 0; j < Mp.nx; j++) for (let i = 0; i < Mp.ny; i++) {
        const e = Mp.E[j * Mp.ny + i], t = sc.log ? (e > sc.lo ? Math.min(255, Math.round(255 * Math.log10(e / sc.lo) / dec)) : 0) : Math.max(0, Math.min(255, Math.round(255 * e / sc.top))), q = 4 * ((Mp.ny - 1 - i) * Mp.nx + j);
        im.data[q] = LUT[3 * t]; im.data[q + 1] = LUT[3 * t + 1]; im.data[q + 2] = LUT[3 * t + 2]; im.data[q + 3] = 255;
      }
      g.putImageData(im, 0, 0); M.img = cvs; M.imgKey = imgKey;
    }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(M.img, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.save(); ctx.beginPath(); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.clip();
    // lanes (the chosen width): own lane's right edge, the centre line (dashed), the left road edge; car centred in its lane
    const Lw = rd.lane, offLine = (off, dash, col) => {
      ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
      if (bx.A) { const sMax = Math.min(o.range * 1.6, Math.PI * bx.sp.R * 1.2); for (let s = 0; s <= sMax; s += 1) { const p = S(...bx.A.at(s, off).p); if (s === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } }
      else { const p = S(B0[0], off), q = S(B0[2], off); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    offLine(-Lw / 2, [], 'rgba(255,255,255,0.75)'); offLine(Lw / 2, [10, 8], 'rgba(242,180,65,0.8)'); offLine(1.5 * Lw, [], 'rgba(255,255,255,0.75)');
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '10px system-ui, sans-serif'; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    const step = o.range > 150 ? 50 : 10, lab = view.s * step < 34 ? step * 2 : step;   // a label every step, every other one when too narrow
    for (let x = step; x < B0[2]; x += step) { const p = S(x, B0[1]), q = S(x, B0[3]); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); if (x % lab === 0) ctx.fillText(x + ' m', p[0] + 2, p[1] - 3); }
    // lux outlines: each chosen level, the 5 lx one strongest, each labelled where it reaches farthest
    const lev = o.lev.concat(o.extra > 0 ? [o.extra] : []), levs = Array.from(new Set(lev)).sort((p, q) => p - q);
    ctx.font = '10px system-ui, sans-serif';
    for (const L of levs) {
      const sg = M.isos[L] || (M.isos[L] = iso(Mp, L)), five = L === RF.Road.IIHS.lux; let far = null;
      ctx.strokeStyle = five ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = five ? 1.4 : 1; ctx.setLineDash(five ? [] : [5, 3]); ctx.beginPath();
      for (let q = 0; q + 1 < sg.length; q += 2) { const p0 = S(sg[q][0], sg[q][1]), p1 = S(sg[q + 1][0], sg[q + 1][1]); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); if (!far || sg[q][0] > far[0]) far = sg[q]; }
      ctx.stroke(); ctx.setLineDash([]);
      if (far) { const p = S(far[0], far[1]), t = fmtLx(L) + ' lx', w = ctx.measureText(t).width; ctx.fillStyle = 'rgba(12,13,16,0.8)'; ctx.fillRect(p[0] + 3, p[1] - 14, w + 4, 12); ctx.fillStyle = '#ffffff'; ctx.fillText(t, p[0] + 5, p[1] - 4); }
    }
    for (const L of rd.mdl.lamps) { const p = S(0.4, L[1]); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 2 * Math.PI); ctx.fill(); }
    // IIHS 5 lx reach on each edge (the vertical sensor's metric: not drawn for the ground sensor)
    const I3 = RF.Road.IIHS, R = rd.iihs, mark = (x, y, txt) => { const p = S(Math.max(x, 0.5), y); ctx.fillStyle = '#5aa7ff'; ctx.beginPath(); ctx.moveTo(p[0], p[1] - 6); ctx.lineTo(p[0] + 5, p[1]); ctx.lineTo(p[0], p[1] + 6); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(12,13,16,0.8)'; const w = ctx.measureText(txt).width; ctx.fillRect(p[0] + 7, p[1] - 7, w + 4, 13); ctx.fillStyle = '#ffffff'; ctx.fillText(txt, p[0] + 9, p[1] + 3); };
    if (!up) {
      if (!bx.sp) { mark(R.right, -I3.lane / 2, 'R edge 5 lx: ' + R.right + ' m'); mark(R.left, 1.5 * I3.lane, 'L edge 5 lx: ' + R.left + ' m'); }
      else {
        const c = rd.curves.find((q) => q.R === bx.sp.R && q.dir === bx.sp.dir);
        if (c) { const pr = bx.A.at(c.right, -I3.lane / 2).p, pl = bx.A.at(c.left, I3.lane / 2).p; mark(pr[0], pr[1], 'R edge 5 lx: ' + c.right + ' m'); mark(pl[0], pl[1], 'L edge 5 lx: ' + c.left + ' m'); }
      }
    }
    ctx.restore();
    // IIHS curves: 5 lx reach on the shorter travel-lane edge, top-right of the map (the toggles own the top-left)
    if (!up) {
      let cl = rd.curves.map((c) => c.R + (c.dir === 'right' ? 'R' : 'L') + ' ' + c.d + ' m').join(' · ');
      ctx.font = '10px system-ui, sans-serif'; let tw = ctx.measureText('curves: ' + cl).width;
      if (tw > (b[0] - a[0]) * 0.6) { cl = rd.curves.map((c) => c.R + (c.dir === 'right' ? 'R' : 'L') + ' ' + c.d).join(' · ') + ' m'; tw = ctx.measureText('curves: ' + cl).width; }
      const tb = cv.parentElement.querySelector('.road-tools'), tbBottom = tb ? tb.getBoundingClientRect().bottom - cv.getBoundingClientRect().top : 0;
      const x = Math.max(6, Math.min(b[0], box.w) - tw - 12), y = Math.max(a[1] + 2, tbBottom + 2);
      ctx.fillStyle = 'rgba(12,13,16,0.8)'; ctx.fillRect(x - 4, y, tw + 8, 14); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText('curves: ' + cl, x, y + 10);
    }
    // colour bar
    const pos = (v) => (sc.log ? 100 * Math.log10(v / sc.lo) / Math.log10(sc.top / sc.lo) : 100 * v / sc.top).toFixed(1) + '%';
    const ticks = sc.log ? niceTicks(sc.lo, sc.top) : niceTicks(sc.top / 12, sc.top).filter((v) => v >= sc.top / 8);
    const bar = el('i', { style: 'background:' + RF.Render2D.colorbarCSS() }); for (const v of ticks) bar.append(el('b', { style: 'left:' + pos(v) }));
    const labels = el('div', { class: 'cb-labels ticks', title: (sc.log ? 'Log scale, two decades under the top. ' : 'Linear scale, 0 to the top (' + (o.max > 0 ? 'set in Spec → Road' : 'automatic: the 99.5th percentile of this view') + '). ') + 'White outline: 5 lx (the IIHS visibility level).' }, el('span', { class: 'end-l' }, sc.log ? fmtLx(sc.lo) + ' lx' : '0'));
    for (const v of ticks) labels.append(el('span', { style: 'left:' + pos(v) }, fmtLx(v)));
    labels.append(el('span', { class: 'end-r' }, fmtLx(sc.top) + ' lx')); cb.append(bar, labels);
  }
  // the lux under a tap on the Road view (the same sensor and bend as the picture)
  function roadReadout(ui, x, y) {
    const rd = roadModel(ui), o = rvOpts(ui), view = ui.vHeat; if (!rd) return '';
    const c = view.toContent(x, y), px = c[0], py = c[1] / (view.roadK || 1), bx = roadBox(o), up = o.sensor === 'up', z = up ? 0 : RF.Road.IIHS.sensorZ;
    if (bx.sp) {
      const f = bx.A.frame(px, py), E = rd.mdl.lux([px, py, z], up ? 'up' : [f.t[0], f.t[1], 0]);
      return f.s.toFixed(0) + ' m along the lane centre, ' + Math.abs(f.off).toFixed(1) + ' m ' + (f.off >= 0 ? 'left' : 'right') + ' of it: ' + E.toFixed(1) + ' lx';
    }
    if (!(px > 0)) return '';
    return px.toFixed(1) + ' m ahead, ' + Math.abs(py).toFixed(1) + ' m ' + (py >= 0 ? 'left' : 'right') + ' of lane centre: ' + rd.mdl.lux([px, py, z], up ? 'up' : 'car').toFixed(1) + ' lx';
  }
  // ---------------------------------------------------------------- Drive: the driver's-eye view (js/drive.js, js/drive-scenes.js)
  const DV_DEF = { scene: 'road', wet: false, expMode: 'fixed', ev: 1, glare: 0.3, people: true, animals: true, signs: true, oncoming: false, preceding: false, onDist: 80, preDist: 50, onKcd: 30, RL: 200, ambient: 0, smooth: 'smooth', res: 640, fov: 60 };
  const DV_GLARE = [[0, 'off'], [0.3, 'low'], [1, 'high']];
  const DV_SMOOTH = { sharp: [0.2, 0.2, 1], smooth: [0.5, 0.15, 2], soft: [1.0, 0.3, 3] };    // kernel half-widths: horizontal, vertical (°), wide-grid bins
  function dvOpts(ui) {
    if (!ui.dvOpts) { let o = {}; try { o = JSON.parse(localStorage.getItem('flux/driveView') || '{}'); } catch (e) { /* ignore */ } ui.dvOpts = Object.assign({}, DV_DEF, o); if (typeof ui.dvOpts.glare === 'boolean') ui.dvOpts.glare = ui.dvOpts.glare ? DV_DEF.glare : 0; }   // glare used to be on/off
    return ui.dvOpts;
  }
  function setDV(ui, k, v) {
    dvOpts(ui)[k] = v;
    try { localStorage.setItem('flux/driveView', JSON.stringify(ui.dvOpts)); } catch (e) { /* ignore */ }
    ui.redrawSpec();
  }
  const fmtL = (x) => x >= 100 ? Math.round(x) + '' : x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x >= 0.1 ? x.toFixed(2) : x.toPrecision(2);
  function driveTools(ui, cv) {
    const wrap = cv.parentElement; let bar = wrap.querySelector('.drive-tools');
    if (!bar) {
      bar = el('div', { class: 'drive-tools' });
      const btn = (k, title, fn) => { const b = el('button', { type: 'button', class: 'toggle', 'data-dv': k, title }); b.addEventListener('click', fn); bar.append(b); return b; };
      const sel = el('select', { 'data-dv': 'scene', title: 'Where the beam is: an open road, a forest road, a city street' }, ...Object.keys(RF.Drive.scenes).filter((k) => !RF.Drive.scenes[k].hidden).map((k) => el('option', { value: k }, RF.Drive.scenes[k].label)));
      sel.addEventListener('change', () => setDV(ui, 'scene', sel.value)); bar.append(sel);
      btn('shape', 'The road: straight, or an IIHS bend (shared with the Road view)', () => { const o = rvOpts(ui); setRV(ui, 'shape', RV_SHAPES[(RV_SHAPES.indexOf(o.shape) + 1) % RV_SHAPES.length]); });
      btn('wet', 'Dry or wet asphalt (wet is darker and mirror-like)', () => setDV(ui, 'wet', !dvOpts(ui).wet));
      btn('expMode', 'Exposure. Fixed: an absolute EV, so two designs at the same EV are comparable (EV 0 puts 10 cd/m² at white). Auto: the average lit pixel goes to mid grey, so every picture looks exposed and brightness differences hide.', () => setDV(ui, 'expMode', dvOpts(ui).expMode === 'auto' ? 'fixed' : 'auto'));
      btn('evm', 'One stop darker', () => setDV(ui, 'ev', Math.max(-8, dvOpts(ui).ev - 0.5)));
      btn('ev', 'Exposure value (click to reset)', () => setDV(ui, 'ev', DV_DEF.ev));
      btn('evp', 'One stop brighter', () => setDV(ui, 'ev', Math.min(10, dvOpts(ui).ev + 0.5)));
      btn('glare', 'Glare: the part of any pixel above display white is blurred wide and added back, a cheap stand-in for the eye\u2019s light scatter. Not calibrated. Off / low (default) / high (the first version\u2019s strength).', () => { const i = DV_GLARE.findIndex((g) => g[0] === dvOpts(ui).glare); setDV(ui, 'glare', DV_GLARE[(i + 1) % DV_GLARE.length][0]); });
      btn('people', 'Pedestrians (dark clothes, hi-vis vest with tape, light clothes)', () => setDV(ui, 'people', !dvOpts(ui).people));
      btn('animals', 'Deer, with retroreflecting eyes', () => setDV(ui, 'animals', !dvOpts(ui).animals));
      btn('signs', 'Road signs (retroreflective sheeting)', () => setDV(ui, 'signs', !dvOpts(ui).signs));
      btn('oncoming', 'An oncoming car in the left lane with its headlamps on (distance and intensity: Spec → Road)', () => setDV(ui, 'oncoming', !dvOpts(ui).oncoming));
      btn('preceding', 'A car ahead in our lane, tail lamps on, with plate and red reflectors (distance: Spec → Road)', () => setDV(ui, 'preceding', !dvOpts(ui).preceding));
      wrap.append(bar);
      const ro = el('div', { class: 'drive-readout' }); wrap.append(ro);
      cv.addEventListener('mousemove', (e) => {
        if (ui.display !== 'drive' || !ui.driveShown) return;
        const r = cv.getBoundingClientRect(), d = ui.driveShown, x = (e.clientX - r.left - d.ox) / d.sc, y = (e.clientY - r.top - d.oy) / d.sc;
        if (x < 0 || y < 0 || x >= d.res.w || y >= d.res.h) { ro.textContent = ''; return; }
        const p = RF.Drive.probe(d.res, d.flip ? d.res.w - 1 - x : x, y);
        ro.textContent = fmtL(p.L) + ' cd/m²' + (isFinite(p.depth) ? ' · ' + (p.depth < 100 ? p.depth.toFixed(1) : Math.round(p.depth)) + ' m · ' + p.mat : ' · sky');
      });
      cv.addEventListener('mouseleave', () => { ro.textContent = ''; });
    }
    const o = dvOpts(ui), rv = rvOpts(ui), tm = ui.driveShown && ui.driveShown.tm;
    for (const b of bar.querySelectorAll('[data-dv]')) {
      const k = b.dataset.dv;
      if (k === 'scene') b.value = o.scene;
      else if (k === 'shape') { b.textContent = rv.shape === 'straight' ? 'straight' : rv.shape.replace(/([RL])$/, ' $1'); b.setAttribute('aria-pressed', String(rv.shape !== 'straight')); }
      else if (k === 'wet') { b.textContent = o.wet ? 'wet' : 'dry'; b.setAttribute('aria-pressed', String(o.wet)); }
      else if (k === 'expMode') { b.textContent = o.expMode === 'auto' ? 'auto' : 'fixed'; b.setAttribute('aria-pressed', String(o.expMode === 'fixed')); }
      else if (k === 'evm') b.textContent = '−';
      else if (k === 'evp') b.textContent = '+';
      else if (k === 'ev') { b.textContent = 'EV ' + (o.ev >= 0 ? '+' : '−') + Math.abs(o.ev).toFixed(1) + (tm ? ' · white ' + fmtL(tm.white) + ' cd/m²' : ''); b.setAttribute('aria-pressed', 'false'); }
      else if (k === 'glare') { b.textContent = 'glare ' + (DV_GLARE.find((g) => g[0] === o.glare) || DV_GLARE[1])[1]; b.setAttribute('aria-pressed', String(o.glare > 0)); }
      else { b.textContent = { people: 'people', animals: 'deer', signs: 'signs', oncoming: 'oncoming', preceding: 'preceding' }[k] || k; b.setAttribute('aria-pressed', String(!!o[k])); }
    }
  }
  // Result → Drive: what the driver sees. The beam lookup, the scene and the render are cached; exposure only redoes the tone map.
  function drawDrive(ui, cv, view) {
    const box = RF.Render.fitCanvas(cv), ctx = cv.getContext('2d'), rd = roadModel(ui), o = dvOpts(ui), rv = rvOpts(ui);
    driveTools(ui, cv);
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0); ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, box.w, box.h);
    const cap = document.getElementById('right-caption'), cb = document.getElementById('colorbar'); cb.innerHTML = '';
    cap.textContent = 'Drive · what the driver sees · ' + RF.Drive.scenes[o.scene].label.toLowerCase() + ' · ' + (rv.shape === 'straight' ? 'straight' : rv.shape.replace(/([RL])$/, ' m $1') + ' bend') + (o.wet ? ' · wet' : ' · dry');
    if (!rd) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px system-ui'; ctx.fillText('The drive view appears when the trace has been judged.', 14, 80); return; }
    const road = rd.mdl.road, mirrored = md(ui).traffic === 'LHT', key = JSON.stringify([rd.laneDrive, o.scene, o.wet, o.people, o.animals, o.signs, o.oncoming && [o.onDist, o.onKcd], o.preceding && o.preDist, o.RL, o.ambient, o.smooth, o.res, o.fov, rv.shape]);
    if (!rd.drive || rd.drive.key !== key) {
      const t0 = performance.now(), sm = DV_SMOOTH[o.smooth] || DV_SMOOTH.smooth, lut = RF.Drive.lutFrom(rd.mkI(sm[0], sm[1], sm[2])), sp = parseShape(rv.shape), A = sp ? RF.Road.arc(sp.R, sp.dir) : null;
      const scene = RF.Drive.buildScene(o.scene, { Lw: rd.laneDrive, A, us: !/^ece/.test(md(ui).preset || ''), seed: 7 }, { people: o.people, animals: o.animals, signs: o.signs, oncoming: o.oncoming ? { dist: o.onDist, kcd: o.onKcd } : null, preceding: o.preceding ? { dist: o.preDist } : null });
      const W = o.res, H = Math.round(W * 9 / 16);
      const res = RF.Drive.render({ w: W, h: H, hfov: o.fov, eye: [-2.0, 0.37, 1.2], lamps: rd.mdl.lamps, lut, conv: (ui.spec.G && ui.spec.G.conv) || md(ui).conv || 'A', arc: A, lane: rd.laneDrive, scene, look: { wet: o.wet, RL: o.RL / 1000, ambient: o.ambient } });
      rd.drive = { key, res, ms: performance.now() - t0, tmKey: '' };
    }
    const D = rd.drive, tmKey = JSON.stringify([o.expMode, o.ev, o.glare]);
    if (D.tmKey !== tmKey) {
      D.tm = RF.Drive.tonemap(D.res, { mode: o.expMode, ev: o.ev, glare: o.glare }); D.tmKey = tmKey;
      const c2 = D.img || document.createElement('canvas'); c2.width = D.res.w; c2.height = D.res.h; c2.getContext('2d').putImageData(new ImageData(D.tm.px, D.res.w, D.res.h), 0, 0); D.img = c2;
    }
    const W = D.res.w, H = D.res.h, sc = Math.min(box.w / W, box.h / H), ox = (box.w - W * sc) / 2, oy = (box.h - H * sc) / 2;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (mirrored) { ctx.save(); ctx.translate(ox + W * sc, oy); ctx.scale(-sc, sc); ctx.drawImage(D.img, 0, 0); ctx.restore(); } else ctx.drawImage(D.img, ox, oy, W * sc, H * sc);
    ui.driveShown = { res: D.res, tm: D.tm, ox, oy, sc, flip: mirrored };
    driveTools(ui, cv);      // the EV button shows the white level of THIS picture
    cb.append(el('div', { class: 'cb-labels', title: 'Fixed: EV 0 puts 10 cd/m² at display white and each stop doubles it, so two designs at the same EV are comparable. Auto: the geometric mean of the lit pixels goes to mid grey (plus the EV offset). Hover the picture for the luminance under the pointer. Rendered in ' + Math.round(D.ms) + ' ms: ' + road.mountH.toFixed(2) + ' m lamps, ' + (road.two ? 'two' : 'one') + '.' }, el('span', {}, (o.expMode === 'auto' ? 'auto' : 'fixed') + ' exposure · display white = ' + fmtL(D.tm.white) + ' cd/m²')));
  }
  const driveReadout = (ui) => ui.driveShown ? 'Hover the picture for the luminance (cd/m²), distance and material under the pointer.' : '';
  // Far field → road: the lane lines and the horizon in degrees, as the right-hand lamp sees them on the car
  function drawRoadOverlay(ctx, ui, view, a, b) {
    const rd = roadModel(ui); if (!rd) return;
    const L = rd.mdl.lamps[rd.mdl.lamps.length - 1], conv = (ui.spec.G && ui.spec.G.conv) || 'A', sh = rd.sh, mir = rd.mir;
    const P = (x, y) => { const hv = RF.FarField.hvOf([x, y - L[1], -L[2]], conv); return view.toScreen(mir * hv[0] + sh[0], hv[1] + sh[1]); };
    ctx.save(); ctx.beginPath(); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.clip();
    const Lw = rd.lane, poly = (y, dash, col) => { ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath(); let first = true; for (let x = 4; x <= 400; x *= 1.08) { const p = P(x, y); if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); } ctx.stroke(); ctx.setLineDash([]); };
    poly(-Lw / 2, [], 'rgba(255,255,255,0.7)'); poly(Lw / 2, [8, 6], 'rgba(200,205,215,0.6)'); poly(1.5 * Lw, [], 'rgba(255,255,255,0.7)');   // grey centre line: amber dashes are the spec's
    const hz = view.toScreen(0, sh[1])[1]; ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.moveTo(a[0], hz); ctx.lineTo(b[0], hz); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10px system-ui, sans-serif'; ctx.fillText('horizon (lamp ' + L[2].toFixed(2) + ' m up)', a[0] + 4, hz - 3);
    ctx.restore();
  }
  // ---------------------------------------------------------------- hover cards
  const KIND = { point: 'test point', zone: 'zone', sum: 'sum of points', gradient: 'cut-off sharpness scan', linearity: 'cut-off straightness' };
  // the spec item under a screen point of the far-field view, matched where the overlay draws it (shifted by the judge's
  // aim). Points and lines beat zones; of overlapping zones the smallest wins.
  function itemAt(ui, view, x, y) {
    if (!ffOpts(ui).overlay) return null;
    const s = ui.ffShown || ui.spec, ev = s && s.ev, sh = ev ? ev.shift : [0, 0];
    const S = (h, v) => view.toScreen(h + sh[0], v + sh[1]), c = view.toContent(x, y), H = c[0] - sh[0], Vv = c[1] - sh[1];
    const dist = (p) => Math.hypot(p[0] - x, p[1] - y);
    const seg = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0; return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y); };
    const area = (P) => { let A = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; A += p[0] * q[1] - q[0] * p[1]; } return Math.abs(A) / 2; };
    let best = null, bs = Infinity;
    for (const it of RF.Spec.itemsOf(md(ui))) {
      let sc = Infinity;
      if (it.kind === 'point') { const d = dist(S(it.h, it.v)); if (d <= 9) sc = d; }
      else if (it.kind === 'sum') { for (const q of it.pts) { const d = dist(S(q[0], q[1])); if (d <= 9) sc = Math.min(sc, d); } }
      else if (it.kind === 'gradient') { const d = seg(S(it.h, it.v0), S(it.h, it.v1)); if (d <= 6) sc = 10 + d; }
      else if (it.kind === 'linearity') { for (const hh of it.hs) { const d = seg(S(hh, it.v0), S(hh, it.v1)); if (d <= 6) sc = Math.min(sc, 10 + d); } }
      else if (it.kind === 'zone' && it.poly && RF.Spec.inPoly(it.poly, H, Vv)) sc = 100 + area(it.poly);
      if (sc < bs) { bs = sc; best = it; }
    }
    return best;
  }
  function hideCard(cv) { const c = cv && cv.parentElement && cv.parentElement.querySelector('.spec-card'); if (c) c.hidden = true; }
  // a card for one spec item at screen (x, y): what the rule asks, what was measured, the verdict in words
  function showCard(ui, cv, it, x, y) {
    const wrap = cv.parentElement; let card = wrap.querySelector('.spec-card');
    if (!card) { card = el('div', { class: 'spec-card' }); wrap.append(card); }
    const s = ui.ffShown || ui.spec, ev = s && !s.preview ? s.ev : null, rows = ev ? ev.rows.filter((r) => r.id === it.id) : [];
    const words = { pass: 'passes', fail: 'fails', unsure: 'unsure: the ±2σ noise band crosses the limit (more rays would settle it)' };
    card.innerHTML = '';
    card.append(el('div', { class: 'sc-h' }, el('b', {}, it.name), ' ', el('span', {}, KIND[it.kind] || it.kind)));
    if (it.kind === 'point') card.append(el('div', { class: 'sc-l' }, 'at H ' + (+it.h).toFixed(2) + '°, V ' + (+it.v).toFixed(2) + '°'));
    if (rows.length) for (const r of rows) {
      const t = rowText(r);
      card.append(el('div', { class: 'sc-r v-' + r.verdict }, el('span', { class: 'mk' }, t.mk || ''), ' needs ' + t.need + (r.unit === 'deg' || r.unit === 'log' ? '' : ' cd') + ', read ' + t.got + (r.unit === 'deg' || r.unit === 'log' ? '' : ' cd')));
      card.append(el('div', { class: 'sc-l v-' + r.verdict }, words[r.verdict] || r.verdict, t.off ? ' · ' + t.off : ''));
      if (r.at && it.kind === 'zone') card.append(el('div', { class: 'sc-l' }, (r.isMin ? 'dimmest' : 'brightest') + ' spot at H ' + r.at[0].toFixed(2) + '°, V ' + r.at[1].toFixed(2) + '°'));
      if (r.pointReaim) card.append(el('div', { class: 'sc-l' }, 'read ' + Math.hypot(r.pointReaim[0], r.pointReaim[1]).toFixed(2) + '° off the point (re-aim allowed per test point)'));
    } else {
      const lim = [it.min > 0 ? '≥ ' + fmtCd(it.min) + ' cd' : '', it.max > 0 ? '≤ ' + fmtCd(it.max) + ' cd' : ''].filter(Boolean).join(' and ');
      if (lim) card.append(el('div', { class: 'sc-r' }, 'needs ' + lim));
      card.append(el('div', { class: 'sc-l' }, s && s.preview ? 'preview candidate: not judged' : 'not judged yet'));
    }
    if (it.note || it.ref) card.append(el('div', { class: 'sc-n' }, [it.note, it.ref].filter(Boolean).join(' · ')));
    card.hidden = false;
    const W = wrap.clientWidth, Hh = wrap.clientHeight, cw = card.offsetWidth, ch = card.offsetHeight;
    card.style.left = Math.max(2, Math.min(W - cw - 2, x + 14)) + 'px'; card.style.top = Math.max(2, Math.min(Hh - ch - 2, y + 14)) + 'px';
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

  RF.SpecUI = { streams, refineButton, section, render, update, evalAt, drawFarField, drawFarFieldPreview, itemAt, showCard, hideCard, rowText, roadModel, drawRoad, roadReadout, drawDrive, driveReadout, editorOverlay, readout, leftTools, COL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
