/* panels.js — the side panel (generated from Controller.CONTROLS), stats + definitions, the
 * persistent feasibility report, notices, scene presets, file I/O, and the in-page checks runner.
 * No simulation logic here: everything goes through the controller's setters.                  */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const C = RF.Controller;
  const fmt = RF.U.fmt;
  const isPaint = (m) => m === 'A' || m === 'D';
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
      return numberControl(ui, c);
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
  // ---------------------------------------------------------------- number controls
  // Bounded (finite min & max, not log) → slider + scrub field; otherwise → scrub field only.
  // Scrub field: press-drag sideways > 3 px scrubs (one step per px; Shift ×10, Alt ×0.1) with a live
  // preview and ONE undo entry on release; press-release without moving = ordinary text entry.
  function scrubStep(c, v) {
    if (typeof c.step === 'number' && c.step > 0) return c.step;
    const m = Math.max(Math.abs(v), 1e-3);
    return Math.pow(10, Math.floor(Math.log10(m))) / 20;          // ~1/20 of the order of magnitude
  }
  function decimals(x) { const s = String(x); return s.includes('.') ? s.split('.')[1].length : 0; }
  function numberControl(ui, c) {
    const clamp = (v) => Math.min(isFinite(c.max) ? c.max : Infinity, Math.max(isFinite(c.min) ? c.min : -Infinity, v));
    const field = el('input', { type: 'text', inputmode: 'decimal', class: 'scrub', 'data-control': c.id, 'aria-label': c.label, autocomplete: 'off', spellcheck: 'false' });
    const commitTyped = () => { const v = parseFloat(field.value); if (isFinite(v)) ui.setControl(c.id, clamp(v)); };
    field.addEventListener('change', commitTyped);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commitTyped(); field.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {          // arrow keys still nudge, reliably
        e.preventDefault(); const v0 = parseFloat(field.value) || 0, s = scrubStep(c, v0) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
        const v = clamp(v0 + (e.key === 'ArrowUp' ? s : -s)); field.value = +v.toFixed(Math.max(decimals(s), 0) + 2); ui.setControl(c.id, v);
      }
    });
    let drag = null;
    field.addEventListener('pointerdown', (e) => {
      if (document.activeElement === field) return;                 // already typing: let the caret move
      e.preventDefault();
      drag = { x0: e.clientX, v0: parseFloat(field.value) || 0, moved: false, id: e.pointerId };
      try { field.setPointerCapture(e.pointerId); } catch (err) { /* synthetic / inactive pointer: scrub still works while over the field */ }
    });
    field.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 3) return;
      drag.moved = true; field.classList.add('scrubbing');
      const s = scrubStep(c, drag.v0) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      const v = clamp(drag.v0 + Math.round(dx) * s);
      field.value = String(+v.toFixed(decimals(s) + (e.altKey ? 1 : 0)));
      drag.v = v; ui.previewControl(c.id, v);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; field.classList.remove('scrubbing');
      try { field.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (d.moved) { if (d.v !== undefined) ui.setControl(c.id, d.v); }
      else { field.focus(); field.select(); }                        // a tap = type a value
    };
    field.addEventListener('pointerup', end); field.addEventListener('pointercancel', end);
    const bounded = isFinite(c.min) && isFinite(c.max) && !c.log;
    if (!bounded) return field;
    const slider = el('input', { type: 'range', 'data-control': c.id, 'aria-label': c.label, min: c.min, max: c.max, step: typeof c.step === 'number' ? c.step : 'any' });
    slider.addEventListener('input', () => { field.value = slider.value; ui.previewControl(c.id, parseFloat(slider.value)); });
    slider.addEventListener('change', () => ui.setControl(c.id, parseFloat(slider.value)));
    return el('span', { class: 'numctl' }, slider, field);
  }
  // Simulation → Solve time limit: how long a solver may run before the app stops it (per browser; the solver sees it as
  // tools.budget.ms, so time-governed solvers use the extra time). Default 2 min.
  function solveLimitRow() {
    const H = RF.SolverHost; if (!H || !H.setLimit) return el('span');
    const opts = [[60000, '1 min'], [120000, '2 min (default)'], [300000, '5 min'], [600000, '10 min'], [1800000, '30 min']];
    const cur = H.limitMs(), s = el('select', { 'aria-label': 'Solve time limit' }, ...opts.map(([v, t]) => el('option', { value: String(v), selected: v === cur ? true : null }, t)));
    s.addEventListener('change', () => H.setLimit(+s.value));
    return el('div', { class: 'row', title: 'How long a solver may run before the app stops it and keeps the previous design (its last preview stays on offer). Remembered in this browser. Solvers that pace themselves to the limit (e.g. Spec headlamp v2) use the extra time.' }, el('label', {}, 'Solve time limit'), s);
  }
  function controlRow(ui, c) {
    const input = controlInput(ui, c);
    const row = el('div', { class: 'row', 'data-row': c.id }, el('label', {}, c.label), input);
    const wrap = el('div', { 'data-wrap': c.id }, row);
    if (c.help) wrap.append(el('div', { class: 'row help' }, c.help));
    return wrap;
  }
  function section(title, opts, ...kids) {
    let open = !!opts.open;
    if (opts.key) { try { const v = localStorage.getItem('flux/sec/' + opts.key); if (v !== null) open = v === '1'; } catch (e) { /* ignore */ } }
    const d = el('details', { class: (opts.cls || '') + (opts.adv ? ' adv' : ''), open: open ? true : null, 'data-section': opts.key || null });
    if (opts.key) d.addEventListener('toggle', (e) => { if (e.target !== d) return; try { localStorage.setItem('flux/sec/' + opts.key, d.open ? '1' : '0'); } catch (err) { /* ignore */ } });
    d.append(el('summary', {}, title, opts.tag ? el('span', { class: 'tag' }, opts.tag) : null), ...kids);
    return d;
  }
  const rowsFor = (ui, ids) => ids.map((id) => controlRow(ui, C.BY_ID[id]));

  // ---------------------------------------------------------------- side panel
  function buildSide(ui) {
    const side = document.getElementById('side');
    side.innerHTML = '';
    // ---- 1. Design: the current mode's controls
    const genBtn = el('button', { type: 'button', class: 'primary', id: 'btn-generate' }, 'Rebuild reflector');
    genBtn.addEventListener('click', () => ui.generateA());
    const ap = ui.autoPrefs(), auto = el('input', { type: 'checkbox', id: 'auto-a', checked: ap.paint }), autoS = el('input', { type: 'checkbox', id: 'auto-set', checked: ap.settings });
    auto.addEventListener('change', () => ui.setAuto('paint', auto.checked)); autoS.addEventListener('change', () => ui.setAuto('settings', autoS.checked));
    if (RF.SpecUI) side.append(section('Spec', { open: true, cls: 'only-D', key: 'D', tag: 'beam spec in cd' }, RF.SpecUI.section(ui, section)));
    side.append(section('Paint', { open: true, cls: 'only-A', key: 'A', tag: 'tile the painted pattern' },
      el('div', { class: 'note' }, 'Paint in the Editor. Rebuild runs the solver chosen here to place facets that reproduce the painting.'),
      el('div', { class: 'btnrow' }, genBtn, el('span', { class: 'note' }, 'Re-solve after'), el('label', { class: 'tog', title: 'Painting, an image or pattern, a new solver, or a drag in the 3D views' }, auto, ' painting'), el('label', { class: 'tog', title: 'Any number or solver setting in this sidebar. Off: the design is marked out of date until you press Rebuild.' }, autoS, ' settings')),
      ...rowsFor(ui, ['A.budget', 'A.minDist']),
      el('div', { id: 'solver-box', class: 'solver-box' }),
      el('div', { id: 'pattern-box' }),
      section('Advanced', { adv: true, key: 'A-adv' }, ...rowsFor(ui, ['A.type', 'A.refl', 'A.req'])),
      el('div', { id: 'modeA-report', class: 'note' })));
    side.append(section('Stamp tiles', { open: true, cls: 'only-B', key: 'B', tag: 'solve facet per tile' },
      el('div', { class: 'note' }, 'Tap the Result map to stamp a tile; drag stamps to move them. The Editor is the second picker: direction from the source (drag a marker to set it by hand).'),
      el('div', { id: 'stamp-list', class: 'stamp-list' }),
      el('div', { id: 'stamp-edit' }),
      el('div', { class: 'btnrow' }, confirmButton('Clear all stamps', 'Delete every stamp?', () => ui.clearStamps()))));
    const applyBtn = el('button', { type: 'button', onclick: () => ui.applyPreset() }, 'Apply preset to profile');
    side.append(section('Profile · revolve / extrude', { open: true, cls: 'only-C', key: 'C', tag: 'draw, then sweep' },
      el('div', { class: 'note' }, 'In the Editor: tap to append a point, drag points to move, tap a point to select it. The profile is drawn around the source (the dot); ticks show the front (reflecting / air) side.'),
      section('Shape', { open: true, key: 'C-shape' }, ...rowsFor(ui, ['C.preset', 'C.f', 'C.rim', 'C.depth', 'C.theta', 'C.a1', 'C.n']), el('div', { class: 'btnrow' }, applyBtn)),
      section('Sweep', { open: true, key: 'C-sweep' }, ...rowsFor(ui, ['C.sweep', 'C.len', 'C.az', 'C.axis', 'C.mirror', 'C.flip', 'C.rev'])),
      section('Material', { open: false, key: 'C-mat' }, ...rowsFor(ui, ['C.inter', 'C.refl', 'C.ior', 'C.T'])),
      el('div', { class: 'btnrow' },
        el('button', { type: 'button', id: 'btn-del-point', onclick: () => ui.deleteProfilePoint() }, 'Delete selected point'),
        confirmButton('Clear profile', 'Clear the profile?', () => ui.clearProfile())),
      el('div', { id: 'modeC-report', class: 'note' })));
    // ---- 2. Problem: what the design is for
    const lensKind = el('select', { id: 'lens-kind', 'aria-label': 'Lens preset' },
      el('option', { value: 'planoconvex' }, 'Plano-convex'), el('option', { value: 'biconvex' }, 'Biconvex'), el('option', { value: 'asphere' }, 'Aspheric (projector)'),
      el('option', { value: 'tir' }, 'TIR collimator'), el('option', { value: 'fresnel' }, 'Fresnel lens (N rings)'));
    side.append(section('Problem', { open: true, key: 'problem', tag: 'source · target · envelope' },
      section('Light source', { open: true, key: 'source' },
        el('div', { id: 'source-preset' }),
        ...rowsFor(ui, ['src.kind', 'src.shape', 'src.w', 'src.h', 'src.radius', 'src.length', 'src.dist', 'src.sigma', 'src.half', 'src.domeR', 'src.domeN', 'src.domeZ']),
        section('Advanced', { adv: true, key: 'source-adv' }, el('div', { class: 'note' }, 'Direction and position are also draggable in Optics (source dot, arrow tip), or in the Scene with Setup on.'), ...rowsFor(ui, ['src.az', 'src.el', 'src.roll', 'src.x', 'src.y', 'src.z', 'src.power'])),
        section('More emitters', { open: false, key: 'emitters', tag: 'multi-LED' },
          el('div', { class: 'note' }, 'Extra LEDs, each a copy of the source above (same die and dome) with its own position, aim and power. Rays are shared out by power. Solvers that design per emitter (TIR array) read them all; reflector solvers design for the first one.'),
          el('div', { class: 'btnrow' }, el('button', { type: 'button', onclick: () => ui.addEmitter() }, 'Add emitter')),
          el('div', { id: 'emitter-list', class: 'lens-list' }))),
      section('Target plane & aim point', { open: true, key: 'target' },
        ...rowsFor(ui, ['tgt.dist', 'tgt.size', 'tgt.tiltX', 'tgt.tiltY', 'tgt.linked', 'aim.x', 'aim.y', 'aim.z'])),
      section('Constraint envelope', { open: true, key: 'envelope' },
        el('div', { class: 'note' }, 'Drag the grey face handles in Optics to resize (or in the Scene with Setup on).'),
        ...rowsFor(ui, ['env.keep', 'env.shape', 'env.axis']),
        section('Advanced', { adv: true, key: 'envelope-adv' }, ...rowsFor(ui, ['env.hx', 'env.hy', 'env.hz', 'env.cx', 'env.cy', 'env.cz']))),
      section('Lenses', { open: false, key: 'lenses', tag: 'refractive presets' },
        el('div', { class: 'btnrow' }, lensKind, el('button', { type: 'button', onclick: () => ui.addLens(lensKind.value) }, 'Add lens')),
        el('div', { id: 'lens-list', class: 'lens-list' }))));
    // ---- 3. Simulation
    side.append(section('Simulation', { open: true, key: 'sim', tag: 'rays & grids' }, ...rowsFor(ui, ['rays', 'tgt.res', 'sim.res', 'sim.autoRes']), solveLimitRow(),
      el('div', { class: 'btnrow' }, el('button', { type: 'button', id: 'btn-refine', disabled: true, title: 'Keep tracing the finished run up to twice the rays (up to 50M). Exactly what that ray count would give from scratch, without starting over.', onclick: () => ui.refine(2) }, 'Refine ×2')),
      section('Advanced', { open: false, key: 'sim-adv', adv: true }, ...rowsFor(ui, ['bounces', 'floor', 'seed']))));
    // ---- 4. View (display only, remembered per browser)
    side.append(section('View', { open: false, key: 'view', tag: 'display only' },
      el('label', { class: 'tog', title: 'On: orbit keeps the horizon level. Off: free trackball rotation.' }, el('input', { type: 'checkbox', id: 'turntable', checked: true }), ' turntable orbit'),
      el('label', { class: 'tog', title: 'Heat maps in false colour (inferno-like: dark → violet → orange → pale yellow). Off: a single-hue teal ramp. Picture only; statistics are unchanged.' }, el('input', { type: 'checkbox', id: 'falsecolor' }), ' false-colour heat maps'),
      el('label', { class: 'tog', title: 'Clicking a facet (Optics, Scene) or a zone (Result) highlights it in every view. Off: the Scene ignores the selection, and taps there do nothing.' }, el('input', { type: 'checkbox', id: 'sel-scene' }), ' show selection in Scene'),
      el('div', { class: 'row', title: 'Optics turns slowly on its own after this long untouched (it always does on first load, until you move it)' }, el('label', {}, 'Optics idle orbit'), el('input', { type: 'range', id: 'idle-orbit', min: 0, max: 6, step: 1, value: 6 }), el('output', { id: 'idle-orbit-out' }, 'never')),
      el('div', { class: 'row' }, el('label', { title: 'How many ray paths to draw in the scene (0 = none; display only)' }, 'Rays drawn'), el('input', { type: 'range', id: 'ray-paths', min: 0, max: 2000, step: 20, value: 240 }), el('output', { id: 'ray-paths-out' }, '240'))));
    // ---- 5. Reference & debug
    const runBtn = el('button', { type: 'button', id: 'btn-checks' }, 'Run all checks');
    runBtn.addEventListener('click', () => ui.runChecks());
    side.append(section('Reference & debug', { open: false, key: 'ref' },
      section('What the numbers mean', { open: false, key: 'defs' }, definitions()),
      section('Verification', { open: false, key: 'checks', tag: 'in-page, pass/fail' },
        el('div', { class: 'note' }, 'Same checks as `node tests/headless.js`. They build their own scenes; your scene is not touched. #14 additionally drives the real DOM inputs here.'),
        el('div', { class: 'btnrow' }, runBtn), el('div', { id: 'checks-out', class: 'checks' })),
      section('Solver files', { open: false, key: 'solver', tag: 'load your own' }, el('div', { id: 'solver-files' })),
      section('Diagnostics (solver internals)', { open: false, key: 'diag', tag: 'read-only' }, el('div', { id: 'diag', class: 'note' })),
      section('Scene contents', { open: false, key: 'groups', tag: 'visibility override' }, el('div', { id: 'group-list', class: 'group-list' }))));
  }

  function definitions() {
    const d = el('dl', { class: 'defs' });
    const add = (t, s) => d.append(el('dt', {}, t), el('dd', {}, s));
    add('Coverage', 'IES beam / field convention. Mode A: share of painted cells receiving ≥50% (beam) and ≥10% (field) of the mean delivered÷painted ratio — beam is the "did the light actually arrive" number. Other modes: share of the target at ≥50% / ≥10% of the robust peak. Measured on the paint grid, so gaps narrower than one paint cell are averaged away.');
    add('Uniformity (U₀)', 'Lighting-practice uniformity E_min/E_avg over the task area, with E_min = 5th percentile (the strict min of many noisy cells is a noise spike). Mode A scores sim ÷ paint on painted cells, so multi-level paintings delivered exactly score 1. The noise ceiling (1 − 1.645/√rays-per-cell) is what perfectly even light would read at this sampling — a U₀ near it is noise-limited.');
    add('Peak', '99.5th percentile of lit sim cells, not the single brightest cell (a noise spike at fine grids). Both heat views map white to this value.');
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

  // ---------------------------------------------------------------- real emitters (js/source-presets.js)
  function renderSourcePreset(ui) {
    const box = document.getElementById('source-preset'); if (!box || !RF.SourcePresets) return;
    const SP = RF.SourcePresets, src = ui.store.scene.source, p = SP.PRESETS[src.preset];
    // grouped: datasheet parts, koef3's bench measurements, everything else
    const grp = (q, id) => (q.halogen ? 'Halogen (UN R37)' : q.custom || id === 'sketch' ? 'Other' : id.startsWith('generic') ? 'Generic' : q.measured ? 'Measured by koef3 (BLF/TLF)' : 'From datasheets');
    const groups = {}; for (const [id, q] of Object.entries(SP.PRESETS)) (groups[grp(q, id)] = groups[grp(q, id)] || []).push(el('option', { value: id }, q.label.replace(/ · koef3$/, '')));
    const sel = el('select', { 'aria-label': 'Emitter preset' }, el('option', { value: '' }, 'Custom (the fields below)'), ...['Generic', 'From datasheets', 'Measured by koef3 (BLF/TLF)', 'Halogen (UN R37)', 'Other'].filter((g) => groups[g]).map((g) => el('optgroup', { label: g }, ...groups[g])));
    sel.value = p ? src.preset : '';
    sel.addEventListener('change', () => { if (!sel.value) { delete src.preset; renderSourcePreset(ui); return; } ui._histHint = 'Emitter: ' + SP.PRESETS[sel.value].label; C.actions.applySourcePreset(ui.store, sel.value); ui.afterChange(); renderSourcePreset(ui); });
    box.innerHTML = '';
    box.append(el('div', { class: 'row' }, el('label', {}, 'Emitter'), sel));
    if (!p) return;
    if (p.custom) {                                   // the measured emitter: pasted rows
      const m = src.measured || {}, ta = el('textarea', { rows: 4, class: 'rows-in', placeholder: 'A  lm  cd/mm²  (one row per line, e.g. 2.8  760  160.6)', 'aria-label': 'Measured rows' });
      ta.value = (m.rows || []).map((r) => r.join('  ')).join('\n');
      const nm = el('input', { type: 'text', value: m.name || '', placeholder: 'name', 'aria-label': 'LED name' });
      const sh = el('select', { 'aria-label': 'Die shape' }, el('option', { value: 'rect' }, 'square die'), el('option', { value: 'disc' }, 'round die'));
      sh.value = m.shape || 'rect';
      const use = el('button', { type: 'button' }, 'Use these rows');
      use.addEventListener('click', () => {
        const rows = SP.parseRows(ta.value);
        if (!rows.length) { ta.focus(); return; }
        ui._histHint = 'Measured emitter rows';
        C.actions.applySourcePreset(ui.store, 'measured', { measured: { name: nm.value.trim(), shape: sh.value, rows }, amps: src.driveA || rows[rows.length - 1][0] });
        ui.afterChange(); renderSourcePreset(ui);
      });
      box.append(el('div', { class: 'row' }, el('label', {}, 'LED'), nm), el('div', { class: 'row' }, el('label', {}, 'Die'), sh), ta, el('div', { class: 'btnrow' }, use));
      const mm = SP.measuredModel(m);
      if (mm && mm.lum.length) box.append(el('div', { class: 'row help' }, 'Effective area Φ / (π L): ' + mm.lum.map(([a]) => a + ' A → ' + SP.areaAt(mm, a).toFixed(2) + ' mm²').join(' · ')));
      else if (mm) box.append(el('div', { class: 'reason' }, 'No luminance column: the die size can\u2019t be derived. Add cd/mm² as the third number.'));
    }
    if (p.drive && (!p.custom || SP.measuredModel(src.measured))) {
      const e = SP.electrical(src), models = Object.entries(p.drive.models);
      const a = el('input', { type: 'number', min: 0.1, max: e ? e.maxA : 4, step: 0.1, value: src.driveA, 'aria-label': 'Drive current (A)' });
      a.addEventListener('change', () => { const v = parseFloat(a.value); if (v > 0) { C.actions.setDriveCurrent(ui.store, v); ui.afterChange(); renderSourcePreset(ui); } });
      if (models.length > 1) {
        const mdl = el('select', { 'aria-label': 'Flux model' }, ...models.map(([k, m]) => el('option', { value: k }, m.label)));
        mdl.value = src.fluxModel;
        mdl.addEventListener('change', () => { C.actions.applySourcePreset(ui.store, src.preset, { model: mdl.value, amps: src.driveA }); ui.afterChange(); renderSourcePreset(ui); });
        box.append(el('div', { class: 'row' }, el('label', {}, 'Flux model'), mdl));
      }
      const L = SP.luminanceOf(src);
      box.append(el('div', { class: 'row', title: 'Flux follows the chosen curve; it sets Problem → Light source → Advanced → Power.' }, el('label', {}, 'Drive current (A)'), a),
        el('div', { class: 'row help' }, Math.round(src.power).toLocaleString() + ' lm at ' + src.driveA + ' A' + (L ? ' · ' + Math.round(L) + ' cd/mm²' : '') + (src.effArea > 0 ? ' · ' + src.effArea.toFixed(2) + ' mm² effective' : '') + (e && isFinite(e.vf) ? ' · Vf ' + e.vf.toFixed(2) + ' V · ' + e.watts.toFixed(1) + ' W · ' + e.lmPerW.toFixed(0) + ' lm/W' : '')));
      if (e && e.overRated) box.append(el('div', { class: 'note' }, '⚠ Over the datasheet\u2019s ' + e.ratedA + ' A' + (e.overPower ? ' and ' + e.maxW + ' W dissipation' : '') + ' rating (' + e.watts.toFixed(0) + ' W into a 2 mm die; Rth j–sp 0.7 °C/W, so the heatsink decides).' + (e.extrapolated ? ' Flux past 4 A is estimated from koef3\u2019s curve shape.' : '')));
    }
    if (p.volts) {
      const v = el('select', { 'aria-label': 'Lamp voltage' }, ...Object.keys(p.volts).map((k) => el('option', { value: k }, k + ' V · ' + p.volts[k].toLocaleString() + ' lm')));
      v.value = String(src.volts);
      v.addEventListener('change', () => { C.actions.setLampVolts(ui.store, +v.value); ui.afterChange(); renderSourcePreset(ui); });
      box.append(el('div', { class: 'row' }, el('label', {}, 'Voltage'), v));
    }
    box.append(el('div', { class: 'note' }, (SP.matches(src) ? '' : '⚠ Edited since the preset was applied. ') + p.note));
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
    if (!sc.modeB.stamps.length) list.append(el('div', { class: 'note' }, 'No stamps yet — tap the Result map.'));
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
    const names = { planoconvex: 'Plano-convex', biconvex: 'Biconvex', asphere: 'Aspheric', tir: 'TIR collimator', fresnel: 'Fresnel' };
    const PARAMS = {
      planoconvex: [['f', 'Focal length'], ['a', 'Aperture radius'], ['edge', 'Edge thickness']],
      biconvex: [['f', 'Focal length'], ['a', 'Aperture radius'], ['edge', 'Edge thickness']],
      asphere: [['f', 'Focal length'], ['a', 'Aperture radius'], ['edge', 'Edge thickness']],
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
  function renderEmitterList(ui) {
    const store = ui.store, list = document.getElementById('emitter-list');
    if (!list) return;
    list.innerHTML = '';
    const ems = store.scene.emitters || [];
    for (const e of ems) {
      const box = el('div', { class: 'item', style: 'flex-direction:column;align-items:stretch' });
      const on = el('input', { type: 'checkbox', checked: e.enabled !== false ? true : null, 'aria-label': 'Emitter ' + e.id + ' on' });
      on.addEventListener('change', () => ui.updateEmitter(e.id, 'enabled', on.checked));
      box.append(el('div', { style: 'display:flex;gap:6px;align-items:center' }, on, el('b', { class: 'grow' }, 'Emitter ' + e.id),
        el('button', { type: 'button', title: 'Copy the main source’s die, dome and distribution (keeps position, aim and power)', onclick: () => ui.updateEmitter(e.id, 'matchMain', true) }, 'match source'),
        confirmButton('remove', 'remove?', () => ui.removeEmitter(e.id))));
      const ae = V.toAzEl(e.axis);
      for (const [k, label, v] of [['x', 'Position x', e.pos[0]], ['y', 'Position y', e.pos[1]], ['z', 'Position z', e.pos[2]], ['az', 'Axis azimuth (°)', ae[0]], ['el', 'Axis elevation (°)', ae[1]], ['power', 'Power (lm)', e.power]]) {
        const inp = el('input', { type: 'number', step: 'any', value: +(+v).toFixed(3), 'data-emitter': e.id + '.' + k, 'aria-label': label });
        inp.addEventListener('change', () => { const x = parseFloat(inp.value); if (isFinite(x)) ui.updateEmitter(e.id, k, x); });
        box.append(el('div', { class: 'row' }, el('label', {}, label), inp));
      }
      list.append(box);
    }
    if (!ems.length) list.append(el('div', { class: 'note' }, 'One emitter (the source above).'));
    else list.append(el('div', { class: 'note' }, (ems.filter((e) => e.enabled !== false).length + 1) + ' emitters on · ' + Math.round(RF.Source.totalPower(store.scene)).toLocaleString() + ' lm in all'));
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
  // muted to sit in the Astra palette; 'via surfaces on target' = the heat ramp's bright end (the light you designed for);
  // segments differ by lightness, not just hue, for protan readers
  const EN_COLS = [['direct', '#6f8fb8', 'direct on target'], ['reflected', '#b9dcdc', 'via surfaces on target'], ['absorbed', '#56606b', 'absorbed'], ['backface', '#434b55', 'back faces'], ['interfaceLoss', '#8b7fb8', 'Fresnel loss'], ['escaped', '#1c2630', 'escaped'], ['targetBack', '#333c46', 'hit target back'], ['truncated', '#8e6440', 'cut (cap/floor)']];
  // photometry formatting: candela with its shot-noise error (1/√rays in the peak cell) and, when that's
  // over 3%, the ray count that would bring it to ±3% (error ∝ 1/√rays ⇒ rays needed ∝ 1/tolerance²)
  const fmtCd = (cd) => (cd >= 1e6 ? (cd / 1e6).toFixed(2) + ' Mcd' : cd >= 1e3 ? (cd / 1e3).toFixed(cd >= 1e5 ? 0 : 1) + ' kcd' : Math.round(cd) + ' cd');
  const noiseOf = (peakRays) => (peakRays > 0 ? 1 / Math.sqrt(peakRays) : 1);
  function raysFor3pc(peakRays, traced) { const need = traced * (1 / 0.03) ** 2 / Math.max(1e-9, peakRays); return need >= 1e6 ? (need / 1e6).toFixed(need >= 1e7 ? 0 : 1) + 'M' : Math.round(need / 1e3) + 'k'; }
  const fmtLm = (lm) => (lm >= 100 ? Math.round(lm) : lm >= 10 ? lm.toFixed(1) : lm.toPrecision(2)) + ' lm';
  const fmtMm2 = (a) => (a >= 100 ? Math.round(a).toLocaleString() : a.toFixed(1)) + ' mm²';
  function renderStats(ui, st, extra) {
    const box = document.getElementById('stats');
    if (!st) { box.innerHTML = '<div class="stat"><b>—</b><span>no run yet</span></div>'; return; }
    const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%');
    const E = st.energy, em = E.emitted || 1;
    box.innerHTML = '';
    const s = (val, lab, cls) => box.append(el('div', { class: 'stat ' + (cls || '') }, el('b', {}, val), el('span', {}, lab)));
    s(st.rays.toLocaleString() + (extra.running ? ' …' : ''), 'rays traced' + (extra.preview ? ' (coarse preview while dragging)' : '') + (extra.previewOf ? ' — PREVIEW: the solver\u2019s candidate ' + extra.previewOf + ', not the design' : ''));
    const fd = extra.fid;
    if (fd) {
      const q = fd.ratio, cnt = (x) => x ? pct(x.within) + ' of ' + x.cells : '—';
      box.append(el('h4', { class: 'stats-sub' }, 'Fidelity to the paint'));
      s(pct(fd.within) + (fd.noiseCeiling === null || fd.within < fd.noiseCeiling - 0.02 ? '' : ' (noise-limited)'), 'painted right: painted cells within ×/÷1.25 of the paint (or of the paint blurred by the smallest LED image, ' + fd.kernel.cells.toFixed(1) + ' cells) — at the best overall brightness; raw paint only: ' + pct(fd.withinRaw) + '; a perfect design would score ' + pct(fd.noiseCeiling) + ' at ' + Math.round(fd.raysPerCell) + ' rays/cell');
      s(pct(fd.fidelity), 'FIDELITY = F1 of painted-right and gaps-dark (the headline: near 0 if either half is)');
      s(pct(fd.gapsDark) + ' of ' + fd.gapCells, 'gaps dark: unpainted cells within ' + fd.gapBand + ' cells of the paint that stay under 10% of a painted cell (or the blurred paint\u2019s halo)');
      s(pct(fd.under) + ' · ' + pct(fd.over), 'failing painted cells: too dim · too bright');
      s(cnt(fd.interior) + ' · ' + cnt(fd.edge), 'within, interior cells · edge cells (a painted cell next to an unpainted one)', 'pair');
      s([q.p5, q.p25, q.p50, q.p75, q.p95].map((x) => x.toFixed(2)).join(' · '), 'delivered ÷ intended per painted cell: 5th · 25th · median · 75th · 95th pct (1 = as painted)', 'pair');
      s(pct(fd.onPaint) + ' · ' + pct(fd.spill) + ' (' + pct(fd.spillNear) + ' just outside the edge)', 'light on the paint (of emitted) · spill: target light on unpainted cells', 'pair');
      if (fd.farGlare !== undefined) s(pct(fd.farGlare) + ' → ×' + fd.farCredit.toFixed(2), 'far haze: the haziest 5×5-cell patches beyond the gap band (99th pct), as a share of a painted cell; free up to 10%, then it scales the gaps-dark half down (×0 at 40%)', 'pair');
    }
    const gc = extra.goal;
    if (gc) {
      box.append(el('h4', { class: 'stats-sub' }, 'Goal check'));
      if (gc.error) s('—', 'goal check failed: ' + gc.error);
      else {
        const K = { cutoff: 'cutoff', hotspot: 'hotspot', text: 'text / line art', photo: 'photo', wash: 'even wash', general: 'general' }, m = gc.ev.m, f2 = (x, d) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(d === undefined ? 2 : d));
        s(K[gc.kind] || gc.kind, 'painting type' + (gc.auto ? ' (as Auto judged it)' : '') + ': ' + gc.cls.why);
        if (gc.kind === 'cutoff') {
          s(f2(m.width, 1) + ' cells (floor ' + f2(m.floorWidth, 1) + ')', 'edge width: how far the light takes to fall from bright to dark across the painted line; the floor is the sharpest this LED allows');
          s(f2(m.sharpness), 'edge sharpness (1 = at the floor)');
          s(f2(m.offset, 1) + ' cells', 'edge position: how far the light-dark edge sits from the painted line (+ = above)');
          s(pct(m.glare), 'glare above the line: the brightest 1% of 5×5-cell patches in the dark zone above it, as a share of a lit cell');
          s(pct(m.litHoles), 'holes: lit-zone cells well under their painted level');
        } else if (gc.kind === 'hotspot') {
          s(fmtCd(m.hotCd) + ' · ' + pct(m.ofPossible), 'hot zone: mean intensity · of the most this light could give it');
          s('×' + f2(m.fillRel) + ' · ' + pct(m.fillCover), 'fill: its level vs the paint (1 = as painted) · share of the fill that is lit');
          s(pct(m.spill), 'spill');
        } else if (gc.kind === 'text') {
          s(pct(m.recall) + ' · ' + pct(m.leak), 'strokes lit · gaps leaking');
          s(f2(m.f1) + ' · ' + f2(m.contrast), 'legibility (F1 of strokes vs gaps) · contrast');
          s(m.litHoles + ' of ' + m.paintHoles + ' · ' + m.litComponents + ' of ' + m.paintComponents, 'loops kept open (e, o) · separate strokes kept apart');
          s(f2(m.farGlare), 'far glare (0 = none; 0.3 = fails)');
        } else if (gc.kind === 'photo') {
          s(f2(m.rho) + ' · ' + f2(m.pearson), 'brightness order kept (rank correlation) · linear correlation');
          s(pct(m.lightnessErr) + ' · ' + f2(m.detail), 'tone error on a lightness scale (≈ how the eye compares) · fine detail kept (correlation of the small-scale contrast, e.g. eyes and mouth)');
          s(pct(m.rangeKept), 'tonal range kept: the picture\u2019s 10→90% span of tones vs this design\u2019s (a flat grey scores 0)');
        } else if (gc.kind === 'wash') {
          s(f2(m.cv, 3) + ' (noise ' + f2(m.noiseCV, 3) + ')', 'unevenness: variation across 5×5 patches, and how much of it is just ray noise');
          s(f2(m.p10OverMean) + ' · ' + f2(m.minOverMean), 'dim patches: 10th pct ÷ mean · min ÷ mean');
          s(pct(m.spill), 'spill');
        } else s('—', 'no goal-specific measure: fidelity is the score');
        const g = gc.ev.gates;
        s(g.pass ? '✓ all pass' : '✗ ' + g.why.join(' · '), 'guardrails for this goal (the floors Auto holds a design to)');
        for (const r of gc.recs || []) s('→', r, 'pair');
      }
    }
    s(String(st.surfaces), 'surfaces placed');
    const area = st.basis === 'paint' ? 'painted cells' : 'beam (≥10% of peak)';
    s('beam ' + pct(st.coverage) + ' · field ' + pct(st.coverageField) + ' · U₀ ' + st.uniformity.toFixed(2), 'coverage (≥50% · ≥10% of ' + (st.basis === 'paint' ? 'intended' : 'peak') + ') · uniformity over ' + area + ' — U₀ = 5th pct ÷ mean' + (st.basis === 'paint' ? ' of sim ÷ paint' : '') + '; noise ceiling ' + st.noiseCeiling.toFixed(2) + ' (' + Math.round(st.raysPerCell) + ' rays/cell)' + (st.uniformity >= st.noiseCeiling - 0.02 ? ' — noise-limited: more rays or a coarser sim grid' : ''), 'pair');
    s(pct(st.effIntercepted), 'intercepted by any surface');
    s(pct(st.effViaSurface), 'reach target via a surface');
    s(pct(st.effDirect), 'reach target directly');
    s(st.timeMs.toFixed(0) + ' ms', 'measured trace time');
    if (extra.match) s('r = ' + extra.match.r.toFixed(3) + ' · ' + pct(extra.match.onPaint), 'shape match: correlation intended↔simulated · energy on painted cells', 'pair');
    if (ui.peakInfo) s('≈ ' + ui.peakInfo.lux + ' lx', 'peak — 99.5th pct of ' + ui.peakInfo.res + '² sim cells (not the single max: a noise spike); white point of both heat views');
    // a preview carries only the footer's photometry (phF); the drawer's Photometry section needs a real run (ph)
    const phF = extra.photo, ph = extra.previewOf ? null : phF, pct0 = (x) => (x === null || x === undefined ? '—' : Math.round(100 * x) + '%');
    if (ph) {
      const nz = noiseOf(ph.peakRays);
      box.append(el('h4', { class: 'stats-sub' }, 'Photometry'));
      s(fmtCd(ph.peakCd) + ' ±' + Math.round(100 * nz) + '%', 'peak intensity (99.5th pct cell × distance²)' + (nz > 0.03 ? ' — noise-limited: ~' + raysFor3pc(ph.peakRays, st.rays) + ' rays for ±3%' : ''));
      s(Math.round(ph.throwM).toLocaleString() + ' m', 'throw (ANSI FL1: distance to 0.25 lx = 2·√cd)');
      s(pct0(ph.ofDesign) + ' · ' + pct0(ph.ofEnvelope), 'of the brightness ceiling: this design (' + fmtCd(ph.designCeiling) + ') · any design in this envelope (' + fmtCd(ph.envelopeCeiling) + ') — ceiling = LED luminance × reflectivity × area facing the target', 'pair');
      s(isFinite(ph.luminance) ? ph.luminance.toFixed(ph.luminance >= 100 ? 0 : 1) + ' cd/mm²' : '∞ (point)', 'LED luminance (on axis)');
      s(fmtMm2(ph.reflectorArea) + ' · ' + fmtMm2(ph.apertureProj), 'reflector area · its area facing the target');
      s(fmtLm(ph.lmOnTarget), 'on target');
      if (ph.ratio) s(ph.ratio.p5.toFixed(2) + ' · ' + ph.ratio.p50.toFixed(2) + ' · ' + ph.ratio.p95.toFixed(2), 'delivered ÷ intended per painted cell (5th · median · 95th pct; 1 = as painted, scaled to the mean)', 'pair');
    }
    const oc = st.occlusion;
    if (oc) s((100 * oc.blocked).toFixed(1) + '% · ' + (oc.shadowed === null ? '…' : (100 * oc.shadowed).toFixed(1) + '%'), 'occlusion: blocked (reflected light that runs into another surface' + (oc.blockedWorst.length ? '; worst ' + oc.blockedWorst.slice(0, 2).map((w) => w.id + ' ' + Math.round(100 * w.lost) + '%').join(', ') : '') + ') · shadowed (source light a facet lost to one in front of it' + (oc.shadowedWorst && oc.shadowedWorst.length ? '; worst ' + oc.shadowedWorst.slice(0, 2).map((w) => w.id + ' ' + Math.round(100 * w.lost) + '%').join(', ') : '') + ')', 'pair');
    const bar = el('div', { class: 'energy', title: 'energy accounting' });
    const leg = el('div', { class: 'legend' });
    for (const [k, col, lab] of EN_COLS) {
      const f = (E[k] || 0) / em;
      if (f > 0) bar.append(el('i', { style: 'width:' + (f * 100) + '%;background:' + col, title: lab + ' ' + pct(f) }));
      if (f > 0.0005) leg.append(el('span', {}, el('i', { style: 'background:' + col }), lab + ' ' + pct(f)));
    }
    leg.append(el('span', {}, 'Σ − emitted = ' + st.conservationError.toExponential(1)));
    box.append(bar, leg);
    // footer: headline tiles (value over label; full definitions on hover and in Details), counts, energy bar
    const row = document.getElementById('min-row'), mb = document.getElementById('min-bar');
    if (row) {
      const t = (v, l, tip, cls) => el('div', { class: 'tile ' + (cls || ''), title: tip }, el('b', {}, v), el('span', {}, l));
      // which solver made this design (Auto: the one it picked) — transparency, not a setting
      const solverName = (sc) => { const id = sc.solve && sc.solve.id, d = id && RF.Solvers.get(id); return d ? d.name : (id || 'solver'); };
      const solverLabel = (sc, rA) => rA.auto && rA.auto.picked ? 'Auto → ' + rA.auto.picked : solverName(sc);
      const solverTip = (sc, rA) => rA.auto ? 'Made by Auto, which judged the painting "' + rA.auto.kind + '" and picked ' + (rA.auto.picked || 'a solver') + ' (Details has why).' : 'Made by ' + solverName(sc) + '.';

      const delivered = ((E.direct || 0) + (E.reflected || 0)) / em;
      const rA = ui.store.reports.A, sc = ui.store.scene;
      row.innerHTML = '';
      row.classList.toggle('pv', !!extra.previewOf);
      if (extra.previewOf) row.append(el('div', { class: 'tile pv-tag', title: 'Numbers from the solver\u2019s newest traced candidate (' + extra.previewOf + '): coarse, display only. The real numbers return with the result. Solver settings → Live numbers from previews.' }, el('b', {}, 'PREVIEW'), el('span', {}, extra.previewOf)));
      const fd = extra.fid, specOn = sc.mode === 'D' && RF.SpecUI;
      if (specOn) {
        // Spec mode: the regulation's numbers, not the paint's (the painting is only the secondary goal here)
        const s = !extra.previewOf ? ui.spec : null, ev = s && s.ev;
        if (ev) {
          const worst = ev.rows.slice().sort((a, b) => a.margin - b.margin)[0], wt = worst ? RF.SpecUI.rowText(worst) : null;
          row.append(el('div', { class: 'tile spec-v', title: 'Constraints that pass / fail / are unsure (the ±2σ noise band crosses the limit; more rays would settle them). Measured at ' + (s.G && isFinite(s.G.distance) ? Math.round(s.G.distance / 1000) + ' m' : '∞') + '.' },
            el('b', {}, el('span', { class: 'v-pass' }, ev.n.pass + '✓'), ' ', el('span', { class: 'v-fail' }, ev.n.fail + '✗'), ' ', el('span', { class: 'v-unsure' }, ev.n.unsure + '?')), el('span', {}, 'pass · fail · unsure')));
          if (worst) row.append(t(worst.name, (worst.margin < 0 ? wt.off : wt.off || 'met') , 'Tightest constraint: ' + worst.name + ' needs ' + wt.need + ', read ' + wt.got + ' (' + worst.verdict + ').', 'spec-worst v-' + worst.verdict));
        } else row.append(t('—', extra.previewOf ? 'not judged (preview)' : 'not judged yet', extra.previewOf ? 'Preview candidates are traced for the picture, not judged (the judge takes seconds).' : 'The report appears when the trace runs.'));
        const rd = s && RF.SpecUI.roadModel ? RF.SpecUI.roadModel(ui) : null;
        if (rd) row.append(t(rd.iihs.right + ' / ' + rd.iihs.left + ' m', '5 lx reach R / L', 'IIHS-style straightaway (5 lx, 25 cm up, edges of a 6.6 m road; ' + (rd.mdl.road.two ? 'two lamps' : 'one lamp') + ' at ' + rd.mdl.road.mountH + ' m). IIHS low-beam demerits: right ' + rd.iihs.demerits.right.toFixed(1) + ' (0 at ≥ 100 m), left ' + rd.iihs.demerits.left.toFixed(1) + ' (0 at ≥ 60 m). Glare 5–10 m: ' + rd.iihs.glareMax.toFixed(1) + ' lx (limit 10). Curves (shorter travel-lane edge): ' + rd.curves.map((c) => c.R + ' m ' + c.dir + ' ' + c.d + ' m (' + c.demerits.toFixed(1) + ' dem.)').join(', ') + '. Result → Road shows it.', 'road-reach' + (rd.iihs.glareOver ? ' v-fail' : '')));
        const bq = rd && rd.quality && !rd.quality.empty ? rd.quality : null;
        if (bq) {   // beam quality: report only, never part of the verdict (js/beam-quality.js)
          const hv = (h, v) => Math.abs(h) + '° ' + (h < 0 ? 'L' : 'R') + ', ' + Math.abs(v) + '° ' + (v < 0 ? 'D' : 'U'), c4 = bq.core['1/4'], cv = rd.curves || [], cs = cv.map((c) => c.R + (c.dir === 'right' ? 'R ' : 'L ') + c.d + ' m').join(', ');
          row.append(t(Math.round(c4.width) + '° × ' + c4.height.toFixed(1) + '°', 'beam core', 'Beam quality (report only, not part of the verdict). Bright core = everything ≥ ¼ of the centre peak (' + fmtCd(bq.peak.cd) + ' at ' + hv(bq.peak.h, bq.peak.v) + '), dropouts up to 1° bridged: ' + c4.width + '° wide × ' + c4.height + '° tall, from ' + Math.abs(c4.v[1]) + '° ' + (c4.v[1] < 0 ? 'D' : 'U') + ' to ' + Math.abs(c4.v[0]) + '° D at this aim (0 = the horizon after aiming). Width at ⅓ / ⅕ of peak: ' + ['1/3', '1/5'].map((k) => bq.core[k] ? bq.core[k].width + '°' : '–').join(' / ') + '. Lobes ' + bq.lobes.length + (bq.stray.ratio > 0 ? ', brightest outside the centre box ' + bq.stray.ratio.toFixed(2) + '× the peak at ' + hv(bq.stray.h, bq.stray.v) : '') + '. Holes ' + Math.round(100 * bq.holes) + ' %, roughness ' + bq.roughness.toFixed(2) + ' (info). IIHS curves 5 lx: ' + cs + '.'));
          row.append(t(Math.round(100 * bq.foreground.lmShare) + ' %', 'below 4° D', 'Beam quality (report only): share of the lumens within ±' + RF.BeamQuality.DEF.h1 + '° × ' + (-RF.BeamQuality.DEF.v0) + '° D…' + RF.BeamQuality.DEF.v1 + '° U landing below 4° D at this aim — the foreground just ahead of the car. Brightest point there: ' + bq.foreground.peakRatio.toFixed(2) + '× the centre peak.'));
        }
        if (s && s.G && isFinite(s.G.lmWindow)) row.append(t(fmtLm(s.G.lmWindow), 'in spec window', 'Lumens inside the spec\u2019s measuring window (of ' + fmtLm(st.energy.emitted) + ' emitted).'));
      } else if (fd) row.append(
        t(pct(fd.fidelity), 'fidelity', 'Both must hold (F1 score of the two): painted cells within ×/÷1.25 of the paint (' + pct(fd.within) + '; too dim ' + pct(fd.under) + ', too bright ' + pct(fd.over) + ') and the gaps around the paint stay dark (' + pct(fd.gapsDark) + ' of ' + fd.gapCells + ' cells). A perfect design would score ' + pct(fd.fidelityNoiseCeiling) + ' at this ray count.', fd.fidelityNoiseCeiling !== null && fd.fidelity >= fd.fidelityNoiseCeiling - 0.02 ? 'capped' : ''),
        t(pct(fd.onPaint), 'on paint', 'Share of the LED\u2019s light landing on painted cells (efficiency that counts only light where you asked). ' + pct(delivered) + ' reaches the target in all.'),
        t(pct(fd.spill), 'spill', 'Share of the target light landing on unpainted cells. ' + pct(fd.spillNear) + ' lands just outside the painted edge (a cutoff leak shows here).'));
      else row.append(
        t(pct(delivered), 'delivered', 'Fraction of emitted light that reaches the target (direct + via optics).'),
        t(pct(st.coverage), 'beam', 'Beam coverage: share of the ' + (st.basis === 'paint' ? 'painted cells' : 'beam area') + ' at ≥50% of ' + (st.basis === 'paint' ? 'intended' : 'peak') + '. Field (≥10%): ' + pct(st.coverageField) + '.'),
        t(st.uniformity.toFixed(2), 'uniformity', 'Uniformity U₀ = 5th percentile ÷ mean over ' + (st.basis === 'paint' ? 'painted cells (sim ÷ paint)' : 'the beam area') + '. Noise ceiling ' + st.noiseCeiling.toFixed(2) + ' at ' + Math.round(st.raysPerCell) + ' rays/cell.' + (st.uniformity >= st.noiseCeiling - 0.02 ? ' Noise-limited: more rays or a coarser sim grid.' : ''), st.uniformity >= st.noiseCeiling - 0.02 ? 'capped' : ''));
      if (extra.match && !fd && !specOn) row.append(t(extra.match.r.toFixed(2), 'shape', 'Shape match: correlation between intended and simulated (raw grid). ' + pct(extra.match.onPaint) + ' of target energy lands on painted cells.'));
      if (phF) row.append(t(fmtCd(phF.peakCd), 'peak', 'Peak intensity ±' + Math.round(100 * noiseOf(phF.peakRays)) + '% (shot noise). Throw ' + Math.round(phF.throwM) + ' m. ' + pct0(phF.ofDesign) + ' of this design\u2019s brightness ceiling, ' + pct0(phF.ofEnvelope) + ' of the envelope\u2019s. More in Details.'));
      if (fd && !specOn) row.append(t(st.uniformity.toFixed(2), 'uniformity', 'U₀ = 5th percentile ÷ mean of delivered ÷ painted. Sees only the dim end (holes), not hotspots. Noise ceiling ' + st.noiseCeiling.toFixed(2) + '.'));
      row.append(el('span', { class: 'tile-sep' }));
      row.append(isPaint(sc.mode) && rA && !rA.error
        ? t(rA.placed + ' / ' + sc.modeA.budget, 'facets · ' + solverLabel(sc, rA), 'Facets placed / facet budget.' + (rA.dropped ? ' ' + rA.dropped + ' could not be placed inside the envelope.' : '') + ' ' + solverTip(sc, rA), 'facets')
        : t(String(st.surfaces), 'surfaces', 'Surfaces in the scene.'));
      row.append(el('div', { class: 'tile rays', title: 'Rays traced · trace time (tracing work only, not total wait)' + (extra.preview ? ' · coarse preview while dragging' : '') },
        el('b', {}, st.rays.toLocaleString() + (extra.running ? ' …' : '')), el('span', {}, 'rays ', el('small', { class: 'ms' }, st.timeMs.toFixed(0) + ' ms'))));
      mb.innerHTML = ''; for (const n of bar.children) mb.append(n.cloneNode(true));
    }
  }
  function renderFeasibility(ui, f, extra) {
    const box = document.getElementById('feasibility');
    box.innerHTML = '';
    box.append(el('h3', {}, 'Physical limits — first-order check'));
    if (!f) { box.append(el('div', { class: 'note' }, '—')); return; }
    box.append(el('div', { class: 'bind ' + (f.binding ? 'bad' : 'ok') }, el('span', { class: 'mk' }, f.binding ? '✗' : '✓'), ' ' + f.summary));
    const ul = el('ul');
    for (const it of f.items) ul.append(el('li', { class: it.violated ? 'bad' : 'ok' }, el('b', {}, it.title + (it.ratio > 0 ? ' (×' + it.ratio.toFixed(2) + ')' : '') + ': '), it.text));
    box.append(ul);
    if (extra && extra.warnings && extra.warnings.length) for (const w of extra.warnings) box.append(el('div', { class: 'reason' }, w));
    // footer issue line: this design's own problems first (they're actionable), then the global limits
    const ml = document.getElementById('min-limits');
    if (ml) {
      ml.innerHTML = '';
      const rA = isPaint(ui.store.scene.mode) ? ui.store.reports.A : null, issues = [];
      if (rA && !rA.error) {
        if (rA.dropped) issues.push(rA.dropped + ' facet' + (rA.dropped > 1 ? 's' : '') + ' dropped (no room in the envelope)');
        if (rA.clamped) issues.push(rA.clamped + ' zone' + (rA.clamped > 1 ? 's' : '') + ' blurrier than their tile');
        if (rA.warnings.some((w) => /budget too small/i.test(w))) issues.push('budget too small: azimuth trimmed');
        for (const w of rA.warnings) if (/^⚠/.test(w)) issues.push(w.replace(/^⚠\s*/, ''));   // a solver's own headline warnings
      }
      if (isPaint(ui.store.scene.mode) && RF.Feasibility.minDistanceLoss) {
        const md = ui.store.scene.modeA.minDistance || 0, lossMD = RF.Feasibility.minDistanceLoss(ui.store.scene);
        if (lossMD >= 0.05) issues.push('Min facet distance ' + md + ' mm: at least ' + Math.round(100 * lossMD) + '% of the LED\'s light has room for a mirror only closer than that');
      }
      if (f.binding) issues.push(f.summary);
      if (issues.length) ml.append(el('div', { class: 'issue' }, el('span', { class: 'mk' }, '!'), ' ' + issues.join(' · ')));
      else {
        const rest = f.items.filter((it) => !it.violated && it.ratio > 0).sort((a, b) => b.ratio - a.ratio);
        ml.append(el('div', { class: 'bind ok' }, el('span', { class: 'mk' }, '✓'), ' No design issues',
          rest.length ? el('span', { class: 'note' }, ' · closest limit: ' + rest[0].title + ' ×' + rest[0].ratio.toFixed(2)) : null));
      }
    }
  }
  function renderNotices(ui) {
    const box = document.getElementById('notices');
    box.innerHTML = '';
    if (ui.renderSolveFail) ui.renderSolveFail(box);   // a solve that stopped without a result: stays until dismissed (ui.js)
    // notices live NOTICE_TTL ms (fading over the last second); the same warnings stay in the limits report
    const NOTICE_TTL = 8000, now = Date.now();
    const live = ui.store.notices.filter((n) => now - n.t < NOTICE_TTL).slice(0, 4);
    for (const n of live) {
      const left = NOTICE_TTL - (now - n.t);
      box.append(el('div', { class: 'notice', style: 'animation-delay:' + Math.max(0, left - 1000) + 'ms' }, '• ' + n.msg));
    }
    clearTimeout(ui._noticeT);
    if (live.length) ui._noticeT = setTimeout(() => renderNotices(ui), Math.min(...live.map((n) => NOTICE_TTL - (now - n.t))) + 20);
  }

  // ---------------------------------------------------------------- presets
  function presetScene(name) {
    const sc = RF.State.defaultScene();
    const noteList = [];
    const ledForward = () => { sc.source.axis = [1, 0, 0]; noteList.push('source emission axis set to +x (toward the target)'); };
    for (const k of Object.keys(sc.groups)) sc.groups[k].surfaces = [];
    switch (name) {
      case 'headlamp': noteList.push('default headlamp: 2 mm LED facing up, half-parabola envelope above it'); break;
      case 'spec-box': case 'spec-slim': case 'spec-module': case 'spec-sealed7': {      // Spec mode on a bench fixture (js/spec.js FIXTURES)
        const f = RF.Spec.applyFixture(sc, name.slice(5)); sc.mode = 'D';
        sc.target.distance = 25000; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc)); sc.modeA.paint = RF.Spec.seedPaint(sc); sc.sim.rays = 2000000;
        noteList.push('Spec mode, ' + f.label + '; R112 class B; target at 25 m; seeded low-beam painting; 2 M rays');
        break;
      }
      case 'deepbox': { if (!RF.Checks) return null; const a = RF.Checks.helpers.asymScene(); Object.assign(sc, a); noteList.push('tall deep box 160×80×50 mm, LED on its side wall; spot pattern'); break; }
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
      try { ui._histHint = 'Open ' + file.name; ui._histMode = ui.store.scene.mode; ui.loadScene(RF.State.deserialize(String(r.result)), 'Loaded ' + file.name); }
      catch (e) { ui.store.notice('Could not load ' + file.name + ': ' + e.message); ui.refreshPanels(); }
    };
    r.readAsText(file);
  }

  // ---------------------------------------------------------------- in-page checks
  function runChecks(ui) {
    const out = document.getElementById('checks-out'), btn = document.getElementById('btn-checks');
    out.innerHTML = '';
    if (!RF.Checks) { out.textContent = 'The verification checks are not included in this build.'; return; }
    btn.disabled = true;
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
        ui.loadScene(Object.assign(RF.State.deserialize(snapshot), { solve: { id: RF.Solvers.DEFAULT_ID } }), null, true);   // a synchronous solver: commit() skips worker solvers
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

  RF.Panels = { renderSourcePreset, el, numberControl, fmtCd, noiseOf, raysFor3pc, fmtLm, fmtMm2, buildSide, syncControls, renderStampList, renderLensList, renderEmitterList, renderGroups, renderStats, renderFeasibility, renderNotices, presetScene, download, upload, runChecks, confirmButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
