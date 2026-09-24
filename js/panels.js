/* panels.js — the side panel (generated from Controller.CONTROLS), stats + definitions, the
 * persistent feasibility report, notices, scene presets, file I/O, and the in-page checks runner.
 * No simulation logic here: everything goes through the controller's setters.                  */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const C = RF.Controller;
  const fmt = RF.U.fmt;
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };

  // ---------------------------------------------------------------- two-step confirm (destructive)
  function confirmButton(label, message, onConfirm, cls) {
    const b = el('button', { class: (cls || '') + ' danger', type: 'button' }, label);
    let armed = null;
    b.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); armed = null; b.classList.remove('confirming'); b.textContent = label; onConfirm(); return; }
      b.classList.add('confirming'); b.textContent = message || 'Tap again to confirm';
      armed = setTimeout(() => { armed = null; b.classList.remove('confirming'); b.textContent = label; }, 3500);
    });
    return b;
  }

  // ---------------------------------------------------------------- control rows
  function controlInput(ui, c) {
    let input;
    if (c.type === 'select') {
      input = el('select', { 'data-control': c.id, 'aria-label': c.label });
      for (const [v, t] of c.options) input.append(el('option', { value: v }, t));
    } else if (c.type === 'check') {
      input = el('input', { type: 'checkbox', 'data-control': c.id, 'aria-label': c.label });
    } else {
      input = el('input', { type: 'number', 'data-control': c.id, 'aria-label': c.label, step: c.step, min: isFinite(c.min) ? c.min : null, max: isFinite(c.max) ? c.max : null });
    }
    const commit = () => {
      const v = c.type === 'check' ? input.checked : c.type === 'select' ? input.value : parseFloat(input.value);
      if (c.type === 'number' && !isFinite(v)) return;
      ui.setControl(c.id, v);
    };
    input.addEventListener('change', commit);
    if (c.type === 'number') input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    return input;
  }
  function controlRow(ui, c) {
    const input = controlInput(ui, c);
    const row = el('div', { class: 'row', 'data-row': c.id }, el('label', {}, c.label), input);
    const wrap = el('div', { 'data-wrap': c.id }, row);
    if (c.help) wrap.append(el('div', { class: 'row help' }, c.help));
    return wrap;
  }
  function section(title, opts, ...kids) {
    const d = el('details', { class: (opts.cls || '') + (opts.adv ? ' adv' : ''), open: opts.open ? true : null, 'data-section': opts.key || null });
    d.append(el('summary', {}, title, opts.tag ? el('span', { class: 'tag' }, opts.tag) : null), ...kids);
    return d;
  }
  const rowsFor = (ui, ids) => ids.map((id) => controlRow(ui, C.BY_ID[id]));

  // ---------------------------------------------------------------- side panel
  function buildSide(ui) {
    const side = document.getElementById('side');
    side.innerHTML = '';
    // Mode A
    const genBtn = el('button', { type: 'button', class: 'on', id: 'btn-generate' }, 'Generate reflector');
    genBtn.addEventListener('click', () => ui.generateA());
    const auto = el('input', { type: 'checkbox', id: 'auto-a', checked: true });
    auto.addEventListener('change', () => { ui.store.autoA = auto.checked; });
    const paintPresets = el('div', { class: 'btnrow' }, ...['beam', 'spot', 'band', 'ring', 'wall', 'checker'].map((k) => el('button', { type: 'button', onclick: () => ui.paintPreset(k) }, k)),
      confirmButton('Clear paint', 'Clear the painting?', () => ui.clearPaint()));
    side.append(section('Mode A — paint & generate', { open: true, cls: 'only-A', key: 'A', tag: 'tile the painted pattern' },
      el('div', { class: 'note' }, 'Paint on the left target map (brush settings are under it). Generate places facets so their source images tile the painting, with flux per zone from solid-angle accounting.'),
      el('div', { class: 'btnrow' }, genBtn, el('label', { class: 'tog' }, auto, ' auto after edits')),
      ...rowsFor(ui, ['A.budget', 'A.type', 'A.refl']),
      el('div', { class: 'note' }, 'Quick patterns:'), paintPresets,
      section('Advanced', { adv: true }, ...rowsFor(ui, ['A.req'])),
      el('div', { id: 'modeA-report', class: 'note' })));
    // Mode B
    side.append(section('Mode B — inverse stamping', { open: true, cls: 'only-B', key: 'B', tag: 'solve facet per tile' },
      el('div', { class: 'note' }, 'Tap the simulated target (right) to stamp a tile; drag stamps to move them. The left panel is the second picker: direction from the source (drag a marker to choose it by hand).'),
      el('div', { id: 'stamp-list', class: 'stamp-list' }),
      el('div', { id: 'stamp-edit' }),
      el('div', { class: 'btnrow' }, confirmButton('Clear all stamps', 'Delete every stamp?', () => ui.clearStamps()))));
    // Mode C
    const applyBtn = el('button', { type: 'button', onclick: () => ui.applyPreset() }, 'Apply preset to profile');
    side.append(section('Mode C — profile revolve / extrude', { open: true, cls: 'only-C', key: 'C', tag: 'draw, then sweep' },
      el('div', { class: 'note' }, 'Left panel: tap to append a point, drag points to move, tap a point to select it. The profile is drawn around the source (the dot); ticks show the front (reflecting / air) side.'),
      ...rowsFor(ui, ['C.preset', 'C.f', 'C.rim', 'C.depth', 'C.theta', 'C.a1', 'C.n']),
      el('div', { class: 'btnrow' }, applyBtn),
      ...rowsFor(ui, ['C.sweep', 'C.len', 'C.az', 'C.axis', 'C.mirror', 'C.flip', 'C.rev', 'C.inter', 'C.refl', 'C.ior', 'C.T']),
      el('div', { class: 'btnrow' },
        el('button', { type: 'button', id: 'btn-del-point', onclick: () => ui.deleteProfilePoint() }, 'Delete selected point'),
        confirmButton('Clear profile', 'Clear the profile?', () => ui.clearProfile())),
      el('div', { id: 'modeC-report', class: 'note' })));
    // Source / target / envelope
    side.append(section('Light source', { open: true, key: 'source' },
      ...rowsFor(ui, ['src.kind', 'src.shape', 'src.w', 'src.h', 'src.radius', 'src.length', 'src.dist', 'src.sigma', 'src.half', 'src.az', 'src.el']),
      section('Advanced', { adv: true }, ...rowsFor(ui, ['src.roll', 'src.x', 'src.y', 'src.z', 'src.power']))));
    side.append(section('Target plane & aim point', { open: false, key: 'target' },
      ...rowsFor(ui, ['tgt.dist', 'tgt.size', 'tgt.tiltX', 'tgt.tiltY', 'tgt.linked', 'aim.x', 'aim.y', 'aim.z'])));
    side.append(section('Constraint envelope', { open: false, key: 'envelope' },
      el('div', { class: 'note' }, 'Drag the grey face handles in the scene to resize.'),
      ...rowsFor(ui, ['env.shape', 'env.axis', 'env.keep']),
      section('Advanced', { adv: true }, ...rowsFor(ui, ['env.hx', 'env.hy', 'env.hz', 'env.cx', 'env.cy', 'env.cz']))));
    // Lenses
    const lensKind = el('select', { id: 'lens-kind', 'aria-label': 'Lens preset' },
      el('option', { value: 'planoconvex' }, 'Plano-convex'), el('option', { value: 'biconvex' }, 'Biconvex'),
      el('option', { value: 'tir' }, 'TIR collimator'), el('option', { value: 'fresnel' }, 'Fresnel lens (N rings)'));
    side.append(section('Lenses', { open: false, key: 'lenses', tag: 'refractive presets' },
      el('div', { class: 'btnrow' }, lensKind, el('button', { type: 'button', onclick: () => ui.addLens(lensKind.value) }, 'Add lens')),
      el('div', { id: 'lens-list', class: 'lens-list' })));
    // Simulation (advanced)
    side.append(section('Simulation', { open: false, key: 'sim', adv: true, tag: 'Advanced' }, ...rowsFor(ui, ['bounces', 'floor', 'seed'])));
    // Scene contents
    side.append(section('Scene contents', { open: false, key: 'groups' }, el('div', { id: 'group-list', class: 'group-list' })));
    // Definitions
    side.append(section('What the numbers mean', { open: false, key: 'defs' }, definitions()));
    // Checks
    const runBtn = el('button', { type: 'button', id: 'btn-checks' }, 'Run all checks');
    runBtn.addEventListener('click', () => ui.runChecks());
    side.append(section('Verification', { open: false, key: 'checks', tag: 'in-page, pass/fail' },
      el('div', { class: 'note' }, 'Same checks as `node tests/headless.js`. They build their own scenes; your scene is not touched. #14 additionally drives the real DOM inputs here.'),
      el('div', { class: 'btnrow' }, runBtn), el('div', { id: 'checks-out', class: 'checks' })));
    // Diagnostics
    side.append(section('Diagnostics (solver internals)', { open: false, key: 'diag', adv: true, tag: 'read-only' }, el('div', { id: 'diag', class: 'note' })));
  }

  function definitions() {
    const d = el('dl', { class: 'defs' });
    const add = (t, s) => d.append(el('dt', {}, t), el('dd', {}, s));
    add('Coverage', 'Fraction of target cells that received any light in this run.');
    add('Uniformity', '1 − σ/μ of cell energy over LIT cells only (clamped at 0). Reads 1.000 when very few cells are lit — always read it together with coverage.');
    add('Intercepted', 'Share of emitted flux whose first hit is an optical surface.');
    add('Via surfaces', 'Share of emitted flux reaching the lit side of the target after ≥ 1 surface interaction.');
    add('Direct', 'Share of emitted flux reaching the target without touching any surface.');
    add('Shape match', 'Mode A: Pearson correlation between the painted intent and the simulated grid (raw, unsmoothed), plus the fraction of target energy landing on painted cells.');
    add('Energy bar', 'Every ray’s energy ends in exactly one bin: on target, absorbed (mirror loss, absorbers, back faces), Fresnel loss (untraced interface reflection), escaped, or cut (bounce cap / energy floor). The bins sum to the emitted power.');
    add('Time', 'Measured wall time spent tracing this run (progressive runs sum their slices).');
    return d;
  }

  // ---------------------------------------------------------------- sync controls from state
  function syncControls(ui) {
    const store = ui.store;
    for (const c of C.CONTROLS) {
      const nodes = document.querySelectorAll('[data-control="' + CSS.escape(c.id) + '"]');
      const vis = C.controlVisible(store, c);
      for (const input of nodes) {
        const wrap = input.closest('[data-wrap]');
        if (wrap) wrap.style.display = vis ? '' : 'none';
        if (document.activeElement === input) continue;
        const v = c.get(store);
        if (c.type === 'check') input.checked = !!v;
        else if (c.type === 'select') {
          input.value = String(v);
          if (c.optionFilter) for (const o of input.options) o.hidden = !c.optionFilter(store, o.value);
        } else input.value = isFinite(v) ? +(+v).toFixed(6) : '';
      }
    }
    // mode-specific sections follow body class (CSS hides them)
  }

  // ---------------------------------------------------------------- lists: stamps, lenses, groups
  function renderStampList(ui) {
    const store = ui.store, sc = store.scene, list = document.getElementById('stamp-list'), edit = document.getElementById('stamp-edit');
    if (!list) return;
    list.innerHTML = '';
    const reps = store.reports.B || [];
    const T = RF.Engine.targetFrame(sc.target), cell = 2 * T.half / T.res;
    sc.modeB.stamps.forEach((st, i) => {
      const rep = reps.find((r) => r.id === st.id);
      const item = el('div', { class: 'item' + (sc.modeB.selected === st.id ? ' sel' : '') },
        el('span', { class: 'grow' }, (i + 1) + '. ' + (st.scale / cell).toFixed(1) + ' cells, ' + st.facetType + (rep && !rep.ok ? ' — unsolved' : rep && rep.clamped ? ' — clamped' : '')),
        el('button', { type: 'button', onclick: () => ui.selectStamp(st.id) }, 'select'),
        el('button', { type: 'button', onclick: () => ui.duplicateStamp(st.id) }, 'dup'),
        confirmButton('del', 'delete?', () => ui.deleteStamp(st.id)));
      list.append(item);
    });
    if (!sc.modeB.stamps.length) list.append(el('div', { class: 'note' }, 'No stamps yet — tap the simulated target map.'));
    // selected stamp editor
    edit.innerHTML = '';
    const st = C.selStamp(store);
    edit.append(...rowsFor(ui, ['B.type', 'B.ap', 'B.dir']));
    const rep = st && reps.find((r) => r.id === st.id);
    // scale: slider whose range is clamped to what this facet can physically paint
    const scRow = el('div', { class: 'row full' });
    const lo = rep && rep.ok ? rep.scaleMin : null, hi = rep && rep.ok ? rep.scaleMax : null;
    const cur = st ? st.scale : sc.modeB.defaultScale;
    const rng = el('input', { type: 'range', 'data-control': 'B.scale', min: lo !== null ? lo : 1, max: hi !== null ? hi : 2 * T.half, step: 'any', value: cur, 'aria-label': 'Tile scale (mm)' });
    rng.addEventListener('change', () => ui.setControl('B.scale', parseFloat(rng.value)));
    rng.addEventListener('input', () => ui.previewControl('B.scale', parseFloat(rng.value)));
    scRow.append(el('label', {}, 'Tile scale: ' + (cur / cell).toFixed(2) + ' cells (' + cur.toFixed(0) + ' mm)'), rng);
    edit.append(scRow);
    if (st && rep) {
      if (rep.ok) edit.append(el('div', { class: 'note' }, 'Achievable here: ' + (rep.scaleMin / cell).toFixed(2) + ' – ' + (rep.scaleMax / cell).toFixed(1) + ' cells. Facet ' + (2 * rep.h).toFixed(1) + ' mm at ' + rep.r.toFixed(1) + ' mm from the source, direction θ ' + rep.th.toFixed(1) + '° φ ' + rep.ph.toFixed(1) + '°; solved tile ' + (rep.tileWidth / cell).toFixed(2) + ' cells; intercepts ' + (rep.fluxFraction * 100).toFixed(2) + '% of the lamp (from the source’s actual angular distribution).'));
      for (const r of rep.reasons) edit.append(el('div', { class: 'reason' }, r));
    } else if (!st) edit.append(el('div', { class: 'note' }, 'No stamp selected: these settings apply to the next stamp.'));
  }
  function renderLensList(ui) {
    const store = ui.store, list = document.getElementById('lens-list');
    if (!list) return;
    list.innerHTML = '';
    const names = { planoconvex: 'Plano-convex', biconvex: 'Biconvex', tir: 'TIR collimator', fresnel: 'Fresnel' };
    const PARAMS = {
      planoconvex: [['f', 'Focal length'], ['a', 'Aperture radius'], ['edge', 'Edge thickness']],
      biconvex: [['f', 'Focal length'], ['a', 'Aperture radius'], ['edge', 'Edge thickness']],
      tir: [['A', 'Exit radius'], ['rc', 'Cavity radius'], ['hc', 'Dome height'], ['thMax', 'Max side angle (°)']],
      fresnel: [['f', 'Focal length'], ['a', 'Aperture radius'], ['rings', 'Rings N'], ['tb', 'Base thickness']],
    };
    for (const L of store.scene.lenses) {
      const info = (store.reports.L || {})[L.id] || {};
      const box = el('div', { class: 'item', style: 'flex-direction:column;align-items:stretch' });
      box.append(el('div', { style: 'display:flex;gap:6px;align-items:center' }, el('b', { class: 'grow' }, names[L.kind] + ' ' + L.id), confirmButton('remove', 'remove?', () => ui.removeLens(L.id))));
      const rows = PARAMS[L.kind].concat([['ior', 'Index n'], ['fresnelT', 'Fresnel transmission']]);
      for (const [k, label] of rows) {
        const inp = el('input', { type: 'number', step: 'any', value: L.params[k], 'data-lens': L.id + '.' + k, 'aria-label': label });
        inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) ui.updateLens(L.id, k, k === 'rings' ? Math.max(1, Math.round(v)) : v); });
        box.append(el('div', { class: 'row' }, el('label', {}, label), inp));
      }
      const auto = el('input', { type: 'checkbox', checked: L.params.auto !== false ? true : null });
      auto.addEventListener('change', () => ui.updateLens(L.id, 'auto', auto.checked));
      box.append(el('div', { class: 'row' }, el('label', {}, 'Place at focus (auto)'), auto));
      if (L.params.auto === false) {
        const d = el('input', { type: 'number', step: 'any', value: L.params.d || 20 });
        d.addEventListener('change', () => ui.updateLens(L.id, 'd', parseFloat(d.value)));
        box.append(el('div', { class: 'row' }, el('label', {}, 'Distance from source'), d));
      }
      const ax = el('select', {}, ...[['aim', 'Source → aim point'], ['source', 'Source emission axis'], ['x', 'World x'], ['y', 'World y'], ['z', 'World z']].map(([v, t]) => el('option', { value: v, selected: (L.params.axisMode || 'aim') === v ? true : null }, t)));
      ax.addEventListener('change', () => ui.updateLens(L.id, 'axisMode', ax.value));
      box.append(el('div', { class: 'row' }, el('label', {}, 'Axis'), ax));
      const txt = Object.entries(info).map(([k, v]) => k + ' ' + (typeof v === 'number' ? v.toFixed(3) : v)).join(' · ');
      if (txt) box.append(el('div', { class: 'note' }, txt));
      list.append(box);
    }
    if (!store.scene.lenses.length) list.append(el('div', { class: 'note' }, 'No lenses. Lenses sit on an axis through the source.'));
  }
  function renderGroups(ui) {
    const store = ui.store, list = document.getElementById('group-list');
    if (!list) return;
    list.innerHTML = '';
    for (const [k, g] of Object.entries(store.scene.groups)) {
      const cb = el('input', { type: 'checkbox', checked: g.enabled ? true : null, 'aria-label': 'include ' + g.label });
      cb.addEventListener('change', () => ui.setGroupEnabled(k, cb.checked));
      list.append(el('div', { class: 'item' }, cb, el('span', { class: 'grow' }, g.label + ' — ' + g.surfaces.length + ' surfaces'),
        g.surfaces.length ? confirmButton('clear', 'clear?', () => ui.clearGroup(k)) : null));
    }
  }

  // ---------------------------------------------------------------- stats + feasibility
  const EN_COLS = [['direct', '#8fb8ff', 'direct on target'], ['reflected', '#f2b441', 'via surfaces on target'], ['absorbed', '#6c7380', 'absorbed'], ['backface', '#4b515c', 'back faces'], ['interfaceLoss', '#b48cf0', 'Fresnel loss'], ['escaped', '#2b3038', 'escaped'], ['targetBack', '#3a3f48', 'hit target back'], ['truncated', '#ff9a3d', 'cut (cap/floor)']];
  function renderStats(ui, st, extra) {
    const box = document.getElementById('stats');
    if (!st) { box.innerHTML = '<div class="stat"><b>—</b><span>no run yet</span></div>'; return; }
    const pct = (x) => (x * 100).toFixed(1) + '%';
    const E = st.energy, em = E.emitted || 1;
    box.innerHTML = '';
    const s = (val, lab, cls) => box.append(el('div', { class: 'stat ' + (cls || '') }, el('b', {}, val), el('span', {}, lab)));
    s(st.rays.toLocaleString() + (extra.running ? ' …' : ''), 'rays traced' + (extra.preview ? ' (coarse preview while dragging)' : ''));
    s(String(st.surfaces), 'surfaces placed');
    s(pct(st.coverage) + ' · ' + Math.max(0, st.uniformity).toFixed(3), 'coverage · uniformity — lit cells ' + st.litCells + '/' + st.cells + '; uniformity = 1−σ/μ over lit cells only', 'pair');
    s(pct(st.effIntercepted), 'intercepted by any surface');
    s(pct(st.effViaSurface), 'reach target via a surface');
    s(pct(st.effDirect), 'reach target directly');
    s(st.timeMs.toFixed(0) + ' ms', 'measured trace time');
    if (extra.match) s('r = ' + extra.match.r.toFixed(3) + ' · ' + pct(extra.match.onPaint), 'shape match: correlation intended↔simulated · energy on painted cells', 'pair');
    const bar = el('div', { class: 'energy', title: 'energy accounting' });
    const leg = el('div', { class: 'legend' });
    for (const [k, col, lab] of EN_COLS) {
      const f = (E[k] || 0) / em;
      if (f > 0) bar.append(el('i', { style: 'width:' + (f * 100) + '%;background:' + col, title: lab + ' ' + pct(f) }));
      if (f > 0.0005) leg.append(el('span', {}, el('i', { style: 'background:' + col }), lab + ' ' + pct(f)));
    }
    leg.append(el('span', {}, 'Σ − emitted = ' + st.conservationError.toExponential(1)));
    box.append(bar, leg);
  }
  function renderFeasibility(ui, f, extra) {
    const box = document.getElementById('feasibility');
    box.innerHTML = '';
    box.append(el('h3', {}, 'Physical limits — first-order check'));
    if (!f) { box.append(el('div', { class: 'note' }, '—')); return; }
    box.append(el('div', { class: 'bind ' + (f.binding ? 'bad' : 'ok') }, (f.binding ? '✗ ' : '✓ ') + f.summary));
    const ul = el('ul');
    for (const it of f.items) ul.append(el('li', { class: it.violated ? 'bad' : 'ok' }, el('b', {}, it.title + (it.ratio > 0 ? ' (×' + it.ratio.toFixed(2) + ')' : '') + ': '), it.text));
    box.append(ul);
    if (extra && extra.warnings && extra.warnings.length) for (const w of extra.warnings) box.append(el('div', { class: 'reason' }, w));
  }
  function renderNotices(ui) {
    const box = document.getElementById('notices');
    box.innerHTML = '';
    for (const n of ui.store.notices.slice(0, 4)) box.append(el('div', {}, '• ' + n.msg));
  }

  // ---------------------------------------------------------------- presets
  function presetScene(name) {
    const sc = RF.State.defaultScene();
    const noteList = [];
    const ledForward = () => { sc.source.axis = [1, 0, 0]; noteList.push('source emission axis set to +x (toward the target)'); };
    for (const k of Object.keys(sc.groups)) sc.groups[k].surfaces = [];
    switch (name) {
      case 'headlamp': noteList.push('default headlamp: 2 mm LED facing up, half-parabola envelope above it'); break;
      case 'deepbox': { const a = RF.Checks.helpers.asymScene(); Object.assign(sc, a); noteList.push('tall deep box 160×80×50 mm, LED on its side wall; spot pattern'); break; }
      case 'stamps':
        sc.mode = 'B'; sc.groups.A.enabled = true;
        sc.modeB.stamps = [
          Object.assign(RF.ModeB.newStamp(sc, -220, 60, 140), { facetType: 'curved' }),
          Object.assign(RF.ModeB.newStamp(sc, 0, 0, 220), { facetType: 'curved' }),
          Object.assign(RF.ModeB.newStamp(sc, 240, -40, 120), { facetType: 'flat' })];
        sc.modeB.selected = sc.modeB.stamps[0].id; sc.modeA.paint.fill(0);
        noteList.push('three stamps; Mode A painting cleared');
        break;
      case 'parabola':
        sc.mode = 'C'; ledForward(); sc.modeC.preset = { kind: 'parabola', f: 8, rim: 32, n: 48, theta: 20, depth: 30, a1: 2 };
        sc.modeC.profile = RF.Profile.presetProfile(sc.modeC.preset, sc); sc.modeA.paint.fill(0);
        noteList.push('revolved parabola f = 8 mm, rim 32 mm, with the source at its focus');
        break;
      case 'cpc':
        sc.mode = 'C'; ledForward(); sc.sim.bounces = 4; sc.modeC.preset = { kind: 'cpc', f: 10, rim: 30, n: 48, theta: 12, depth: 30, a1: 2.5 };
        sc.modeC.profile = RF.Profile.presetProfile(sc.modeC.preset, sc); sc.modeA.paint.fill(0); sc.envelope.keepOut = 1;
        noteList.push('CPC collimator (acceptance 12°); bounces raised to 4 because a CPC needs several wall bounces');
        break;
      case 'lenscup':
        sc.mode = 'C'; ledForward(); sc.sim.bounces = 2; sc.modeC.interaction = 'refract'; sc.modeC.sweep = 'revolve';
        sc.modeC.profile = [[0, 12], [9, 12], [9, 14], [7, 17], [4, 19.5], [0, 20.5]]; sc.modeA.paint.fill(0);
        noteList.push('closed profile tagged refract = a freeform lens (glass inside the closed outline); bounces 2 (entry + exit)');
        break;
      case 'tir':
        ledForward(); sc.sim.bounces = 3; sc.mode = 'C'; sc.modeA.paint.fill(0);
        sc.lenses = [{ id: 'l1', kind: 'tir', params: RF.Lenses.defaults('tir') }];
        noteList.push('TIR collimator; bounces 3 (entry, TIR, exit)');
        break;
      case 'fresnel':
        ledForward(); sc.sim.bounces = 2; sc.mode = 'C'; sc.modeA.paint.fill(0);
        sc.lenses = [{ id: 'l1', kind: 'fresnel', params: RF.Lenses.defaults('fresnel') }];
        noteList.push('Fresnel lens, 12 rings, source at its focus; bounces 2');
        break;
      default: return null;
    }
    return { scene: sc, notes: noteList };
  }

  // ---------------------------------------------------------------- file I/O
  function download(ui) {
    const blob = new Blob([RF.State.serialize(ui.store.scene)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'reflector-scene.json' });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function upload(ui, file) {
    const r = new FileReader();
    r.onload = () => {
      try { ui.loadScene(RF.State.deserialize(String(r.result)), 'Loaded ' + file.name); }
      catch (e) { ui.store.notice('Could not load ' + file.name + ': ' + e.message); ui.refreshPanels(); }
    };
    r.readAsText(file);
  }

  // ---------------------------------------------------------------- in-page checks
  function runChecks(ui) {
    const out = document.getElementById('checks-out'), btn = document.getElementById('btn-checks');
    out.innerHTML = ''; btn.disabled = true;
    const list = RF.Checks.list.slice().sort((a, b) => a.id - b.id);
    let i = 0, pass = 0, fail = 0, skip = 0;
    const t00 = performance.now();
    const next = () => {
      if (i >= list.length) {
        const dom = domWiring(ui);
        const ok = dom.every((d) => d.pass);
        out.prepend(el('div', { class: 'ck ' + (fail || !ok ? 'fail' : 'pass') }, el('b', { class: 'st' }, fail || !ok ? 'FAIL' : 'PASS'), ' ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped in ' + ((performance.now() - t00) / 1000).toFixed(1) + ' s'));
        out.append(el('div', { class: 'ck ' + (ok ? 'pass' : 'fail') }, el('b', { class: 'st' }, ok ? 'PASS' : 'FAIL'), ' #14b DOM path: primary controls set through their <input> elements + change events',
          el('div', {}, dom.map((d) => d.id + ' ' + JSON.stringify(d.values) + (d.pass ? ' ✓' : ' ✗ ' + d.why)).join(' · '))));
        btn.disabled = false;
        return;
      }
      const c = list[i++];
      const row = el('div', { class: 'ck' }, el('b', { class: 'st' }, '…'), ' #' + c.id + ' ' + c.name);
      out.append(row);
      setTimeout(() => {
        let r; const t0 = performance.now();
        try { r = c.fn(); } catch (e) { r = { pass: false, detail: 'threw: ' + e.message }; }
        const tag = r.pass === null ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
        if (r.pass === null) skip++; else if (r.pass) pass++; else fail++;
        row.className = 'ck ' + tag.toLowerCase();
        row.firstChild.textContent = tag;
        row.append(el('div', {}, r.detail + ' (' + (performance.now() - t0).toFixed(0) + ' ms)'));
        next();
      }, 16);
    };
    next();
  }
  // #14b: the real DOM inputs.  Snapshot the user's scene, drive the elements, restore.
  function domWiring(ui) {
    const snapshot = RF.State.serialize(ui.store.scene), results = [];
    const cases = [['A', 'A.budget', [48, 20]], ['A', 'A.type', ['curved', 'flat']], ['B', 'B.type', ['curved', 'flat']], ['C', 'C.f', [12, 20]], ['C', 'C.sweep', ['revolve', 'extrude']], ['A', 'src.w', [2, 4]], ['A', 'tgt.dist', [1000, 1400]]];
    for (const [mode, id, vals] of cases) {
      const hashes = [];
      let why = '';
      for (const v of vals) {
        ui.loadScene(RF.State.deserialize(snapshot), null, true);
        ui.setMode(mode, true);
        if (mode === 'B' && !ui.store.scene.modeB.stamps.length) { ui.addStampAt(100, 50, true); }
        if (mode === 'C' && ui.store.scene.modeC.profile.length < 2) { ui.applyPreset(true); }
        if (mode !== 'A') ui.store.scene.groups.A.enabled = false;
        const input = document.querySelector('[data-control="' + id + '"]');
        if (!input) { why = 'no DOM input'; break; }
        if (input.type === 'checkbox') input.checked = !!v; else input.value = String(v);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        ui.store.commit({ forceA: true });
        hashes.push(C.simulate(ui.store, 2000).hash);
      }
      results.push({ id, values: vals, pass: hashes.length === 2 && hashes[0] !== hashes[1], why: why || 'same hash' });
    }
    ui.loadScene(RF.State.deserialize(snapshot), null, true);
    return results;
  }

  RF.Panels = { el, buildSide, syncControls, renderStampList, renderLensList, renderGroups, renderStats, renderFeasibility, renderNotices, presetScene, download, upload, runChecks, confirmButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
