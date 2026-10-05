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
  const evalKey = (m) => JSON.stringify([m.items, m.kernel, m.aimTol, m.aimMode, m.aimLine, m.aimScan, m.itemReaim, m.aimBox, m.traffic, m.conv, m.step, m.distance]);
  // (re)judge the current run; cheap to call often: rebuilds only when the run grew or the spec changed
  function update(ui, force) {
    const run = ui.run, sc = ui.store.scene;
    if (!run || sc.mode !== 'D' || !(run.ctx.ex || run.ctx.ff) || !(run.ctx.next > 0)) return ui.spec || null;
    const key = evalKey(sc.modeD), now = performance.now(), c = run.ctx;
    const s = ui.spec;
    if (!force && s && s.ctx === c && s.key === key && (s.next === c.next || (!c.done && now - s.t < 700))) return s;
    try {
      const G = RF.FarField.build(c, RF.Spec.gridOpts(sc)), ev = RF.Spec.evaluate(G, sc.modeD);
      let Gw = null; try { const wo = RF.Spec.wideOpts(sc); if (c.ff && RF.FarField.streamOf(c, wo)) Gw = RF.FarField.build(c, wo); } catch (e) { /* the picture just stays narrow */ }
      ui.spec = { ctx: c, key, next: c.next, done: c.done, t: now, G, Gw, ev, map: null };
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
        row('Aim', sel([['design', 'As designed'], ['cutoff', 'By the cut-off (R112 Annex 9 §3.1)'], ['peak', 'Maximum on HV (§6.3.1)']], () => m().aimMode || 'design', (v) => { m().aimMode = v; }, true), 'How the lab aims the lamp before measuring. By the cut-off: the inflection of a vertical scan at 2.5° from V-V goes on 0.57° D.'),
        row('Aim line (° D)', num(() => -(m().aimLine === undefined ? -0.57 : m().aimLine), (v) => { m().aimLine = -Math.max(-2, Math.min(3, v)); }, { min: -2, max: 3, step: 0.01 }, true), 'Where the cut-off goes when aiming by it: R112 0.57° D (line B); FMVSS 108 VOL 0.4° D, VOR 0 (H-H).'),
        row('Aim scan ± (°)', num(() => m().aimScan || 3, (v) => { m().aimScan = Math.max(0.5, Math.min(6, v)); }, { min: 0.5, max: 6, step: 0.5 }, true), 'The cut-off is looked for this far around the aim line first (then anywhere): a stray streak far above the beam must not set the aim.'),
        row('Re-aim per point (°)', num(() => m().itemReaim || 0, (v) => { m().itemReaim = Math.max(0, Math.min(1, v)); }, { min: 0, max: 1, step: 0.05 }, true), 'Each test point / zone may be read this far off, whichever reads best. FMVSS 108 S14.2.5.5: ¼° in any direction at any test point. R112: 0 (it re-aims the whole lamp instead).'),
        row('Re-aim L / R (°)', el('span', { class: 'numpair' },
          num(() => (m().aimBox || {}).left || 0, (v) => { m().aimBox = Object.assign({ left: 0, right: 0, up: 0, down: 0 }, m().aimBox, { left: Math.max(0, Math.min(2, v)) }); }, { min: 0, max: 2, step: 0.05, 'aria-label': 'Re-aim left' }, true),
          num(() => (m().aimBox || {}).right || 0, (v) => { m().aimBox = Object.assign({ left: 0, right: 0, up: 0, down: 0 }, m().aimBox, { right: Math.max(0, Math.min(2, v)) }); }, { min: 0, max: 2, step: 0.05, 'aria-label': 'Re-aim right' }, true)),
          'After aiming, the lamp may be moved this far (beam axis, right-hand traffic; mirrored for left-hand) and the best result kept. R112 §6.2.2.3: 0.5° left, 0.75° right.'),
        row('Re-aim ± V (°)', num(() => (m().aimBox || {}).up || 0, (v) => { const x = Math.max(0, Math.min(2, v)); m().aimBox = Object.assign({ left: 0, right: 0, up: 0, down: 0 }, m().aimBox, { up: x, down: x }); }, { min: 0, max: 2, step: 0.05 }, true), 'R112 §6.2.2.3: 0.25° up or down.'),
        row('Angles', sel([['A', 'A: V = elevation, H = azimuth'], ['B', 'B: H out of the vertical plane'], ['S', 'Flat screen: atan(x/D), atan(y/D)']], () => m().conv, (v) => { m().conv = v; }), 'Which (H, V) a direction gets. R112 (Annex 3, Figure A) uses A: a vertical polar axis, h = azimuth, v = latitude. B and the flat screen differ by < 0.05° inside ±10° H.'),
        row('Bin (°)', num(() => m().step, (v) => { m().step = Math.max(0.02, Math.min(1, v)); }, { min: 0.02, max: 1, step: 0.02 }, true), 'Far-field grid resolution.')),
      sectionFn('Paint as a secondary goal', { open: true, key: 'D-paint' },
        row('Solve at (m)', num(() => (m().solveAt === undefined ? 25000 : m().solveAt) / 1000, (v) => { m().solveAt = Math.max(0, Math.min(1000, v)) * 1000; }, { min: 0, max: 1000, step: 5 }), 'The paint solvers aim at a flat plane; Spec mode hands them one this far away, sized to the spec window, so near-field parallax doesn’t shift the beam (0.2° at 10 m for a facet 40 mm off-axis). 0 = your target plane.'),
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
    if (seen < ext - 3) box.append(el('div', { class: 'reason' }, 'The target plane shows ±' + seen.toFixed(1) + '°, the spec spans ±' + ext + '° in H: the solver can’t aim outside the plane. “Fit target to spec” resizes it.'));
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
  const FF_DEF = { scale: 'log', contours: true, overlay: true, aim: true };
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
      const fine = ffImage(ui, s), wide = ffImageWide(ui, s);
      if (wide) ctx.drawImage(wide, A[0], A[1], B[0] - A[0], B[1] - A[1]);
      ctx.drawImage(fine, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    // degree grid: H / V axes and 5° ticks (10° when zoomed far out), labels pinned to the visible edge
    const stepDeg = view.s * 5 < 22 ? 10 : 5, L = Math.max(A[0], 0), Bo = Math.min(B[1], box.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px system-ui, sans-serif';
    for (let h = Math.ceil(ext[0] / stepDeg) * stepDeg; h <= ext[2]; h += stepDeg) { const p = view.toScreen(h, 0); ctx.beginPath(); ctx.moveTo(p[0], A[1]); ctx.lineTo(p[0], B[1]); ctx.stroke(); ctx.fillText((h > 0 ? h + 'R' : h < 0 ? -h + 'L' : '0'), p[0] + 2, Bo - 3); }
    for (let v = Math.ceil(ext[1] / stepDeg) * stepDeg; v <= ext[3]; v += stepDeg) { const p = view.toScreen(0, v); ctx.beginPath(); ctx.moveTo(A[0], p[1]); ctx.lineTo(B[0], p[1]); ctx.stroke(); ctx.fillText((v > 0 ? v + 'U' : v < 0 ? -v + 'D' : 'H'), L + 3, p[1] - 2); }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; const o = view.toScreen(0, 0); ctx.beginPath(); ctx.moveTo(o[0], A[1]); ctx.lineTo(o[0], B[1]); ctx.moveTo(A[0], o[1]); ctx.lineTo(B[0], o[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(143,184,255,0.35)'; ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0] - 1, b[1] - a[1] - 1);
    const fo = ffOpts(ui), ev = s && s.ev;
    if (fo.contours && s && s.G && s.M && !s.preview && s.done) drawContours(ctx, s, view, a, b);   // a finished trace only: partial runs and 200k previews draw noise loops
    if (fo.aim && ev) drawAim(ctx, ui, ev, view, a, b);
    if (fo.overlay) drawItems(ctx, ui, (h, v) => view.toScreen(h, v), undefined, s && s.preview ? null : undefined);
    ffTools(ui, cv);
    document.getElementById('right-caption').textContent = 'Far field · ' + (s && s.G ? fmtDist(s.G.distance) : '') + ' · ' + (fo.scale === 'lin' ? 'linear' : 'log') + ' scale';
    // colour bar with ticks at real cd values
    const cb = document.getElementById('colorbar'); cb.innerHTML = '';
    if (s && s.top) {
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
      bar.append(mk('scale', 'log', 'Colour scale: log (3 decades) or linear (like Hits / Grid)'), mk('contours', 'isocd', 'Isocandela lines at 1–3 steps per decade, labelled in cd'),
        mk('overlay', 'spec', 'The spec’s points and zones with their verdicts'), mk('aim', 'aim', 'Where the judge aimed: the spec’s H-V on the beam (dashed cross) and the line the cut-off was put on (dotted)'));
      wrap.append(bar);
    }
    const o = ffOpts(ui);
    for (const b of bar.querySelectorAll('[data-ff]')) {
      const k = b.dataset.ff;
      if (k === 'scale') { b.textContent = o.scale === 'lin' ? 'lin' : 'log'; b.setAttribute('aria-pressed', 'true'); }
      else b.setAttribute('aria-pressed', String(!!o[k]));
    }
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

  RF.SpecUI = { streams, refineButton, section, render, update, evalAt, drawFarField, drawFarFieldPreview, itemAt, showCard, hideCard, editorOverlay, readout, leftTools, COL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
