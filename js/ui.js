/* ui.js — page controller: boot, mode switching, the progressive run loop, and canvas
 * interactions (scene handles, painting, stamping, direction picking, profile drawing).
 *
 * Progressive accumulation: a run is traced in ~12 ms slices per animation frame, so the page
 * never blocks; while the user is dragging, runs restart as a coarse preview (≤ 1,500 rays) and
 * the full count refines once they let go.  Rays keep their index-seeded streams, so the finished
 * progressive grid is byte-identical to a one-shot run (check #8).                             */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const C = RF.Controller, P = RF.Panels, R2 = RF.Render2D;
  const PREVIEW_RAYS = 1500;

  const ui = {
    store: null,
    cam: new RF.Render.Camera(-130, 28), camS: new RF.Render.Camera(-130, 28),   // eye on the lamp's side of the target (lit face)
    vLeft: new R2.View2D(), vHeat: new R2.View2D(), vPick: new R2.View2D(), vProf: new R2.View2D(),
    fitMode: 'fixture', showRays: true, smooth: false, view: 'total', surfaceView: 'shaded',
    interacting: false, run: null, model: null, handles: [], activeHandle: null, preview: null,
    raf: 0, display: 'grid', pendingA: 0, lastHeat: 0, lastStats: 0, pickMarks: [], profHandles: [], profSel: -1, heatImg: null, sceneDirty: true,
  };
  RF.UI = ui;

  // ---------------------------------------------------------------- state changes
  ui.setControl = function (id, v) {
    C.setControl(ui.store, id, v);
    ui.afterChange();
  };
  ui.previewControl = function (id, v) {           // live slider drags: coarse preview
    C.setControl(ui.store, id, v);
    ui.store.commit({ deferA: true });
    ui.requestRun(true);
  };
  ui.afterChange = function (opts) {
    const store = ui.store;
    const aDirty = store.dirty.has('A');
    store.commit({ deferA: true });                 // B, C, L rebuild immediately (cheap)
    if (aDirty && store.autoA) ui.pendingA = performance.now() + (ui.interacting ? 600 : 250);
    ui.refreshPanels();
    ui.requestRun(ui.interacting);
    ui.autosave();
  };
  ui.generateA = function () {
    ui.setStatus('Generating reflector…'); ui.progress('solve');
    setTimeout(() => {                               // let the status paint first
      const t0 = performance.now();
      C.regenerateA(ui.store);
      const r = ui.store.reports.A;
      if (r && r.error) ui.store.notice('Mode A: ' + r.error);
      ui.lastGenMs = performance.now() - t0;
      ui.pendingA = 0;
      ui.refreshPanels(); ui.requestRun(false); ui.autosave();
    }, 20);
  };
  ui.autosave = function () { histCheckpoint(); saveSoon(); };
  function saveSoon() { clearTimeout(ui._saveT); ui._saveT = setTimeout(() => RF.State.saveLocal(ui.store.scene), 800); }

  // ---------------------------------------------------------------- undo / redo (see history.js)
  // Checkpoint wherever the app autosaves; ui._histHint labels whole-scene loads.
  function histCheckpoint() {
    if (!ui.hist || ui.restoring) return;
    ui.hist.checkpoint(RF.History.intent(ui.store.scene), performance.now(), ui._histHint || null, ui._histMode);
    ui._histHint = null; ui._histMode = undefined; updateUndoButtons();
  }
  function restoreIntent(it, mode) {
    ui.restoring = true;
    try {
      RF.History.apply(ui.store.scene, it);
      if (mode) ui.store.scene.mode = mode;
      ui.store.invalidate(['A', 'B', 'C', 'L']); ui.store.commit({ forceA: true });
      ui.setMode(ui.store.scene.mode, true);
      ui.vLeft.fitted = ui.vHeat.fitted = ui.vPick.fitted = ui.vProf.fitted = false;
      ui.refreshPanels(); ui.requestRun(false); saveSoon();
    } finally { ui.restoring = false; }
  }
  ui.undo = function () {
    histCheckpoint();                                  // flush an edit that hasn't checkpointed yet
    const e = ui.hist.undo(RF.History.intent(ui.store.scene), ui.store.scene.mode);
    if (!e) { toast('Nothing to undo'); return; }
    restoreIntent(e.it, e.mode); toast('Undid: ' + e.label); updateUndoButtons();
  };
  ui.redo = function () {
    histCheckpoint();
    const e = ui.hist.redo(RF.History.intent(ui.store.scene), ui.store.scene.mode);
    if (!e) { toast('Nothing to redo'); return; }
    restoreIntent(e.it, e.mode); toast('Redid: ' + e.label); updateUndoButtons();
  };
  function updateUndoButtons() {
    const u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo'), h = ui.hist;
    if (!u || !h) return;
    const p = h.past[h.past.length - 1], f = h.future[h.future.length - 1];
    u.disabled = !p; u.title = p ? 'Undo: ' + p.label + ' (⌘Z)' : 'Nothing to undo';
    r.disabled = !f; r.title = f ? 'Redo: ' + f.label + ' (⇧⌘Z)' : 'Nothing to redo';
  }
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = P.el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(ui._toastT); ui._toastT = setTimeout(() => el.classList.remove('show'), 1800);
  }
  ui.loadScene = function (scene, notice, silent) {
    ui.store = C.createStore(scene);
    ui.store.autoA = document.getElementById('auto-a') ? document.getElementById('auto-a').checked : true;
    // rebuild derived groups from intent. Mode A is re-solved too (~50 ms): the solver report isn't
    // saved with the scene, so otherwise the limits panel is empty after any load.
    ui.store.invalidate(['B', 'C', 'L']);
    if ((scene.groups.A.surfaces.length || scene.mode === 'A') && scene.modeA.paint.some((x) => x > 0)) ui.store.invalidate(['A']);
    ui.store.commit({ forceA: ui.store.dirty.has('A') });
    if (notice) ui.store.notice(notice);
    if (silent) return;
    ui.setMode(scene.mode, true);
    ui.fit(ui.fitMode);
    ui.vLeft.fitted = ui.vHeat.fitted = ui.vPick.fitted = ui.vProf.fitted = false;
    ui.refreshPanels(); ui.requestRun(false); ui.autosave();
  };

  // ---------------------------------------------------------------- modes
  ui.setMode = function (m, quiet) {
    const sc = ui.store.scene;
    C.actions.setMode(ui.store, m);
    // each mode shows only its own optics (lenses / manual surfaces stay); B re-aims around what's left
    for (const g of ['A', 'B', 'C']) sc.groups[g].enabled = g === m;
    ui.store.invalidate(['B']); ui.store.commit({ deferA: true });
    document.body.classList.remove('mode-A', 'mode-B', 'mode-C');
    document.body.classList.add('mode-' + m);
    const gt = document.getElementById('btn-generate-top');
    if (gt) { gt.disabled = m !== 'A'; gt.title = m === 'A' ? 'Solve the reflector for the painted target' : 'Stamp and Profile modes rebuild live; Generate is for Paint mode'; }
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', b.dataset.mode === m ? 'true' : 'false');
    const cap = { A: ['Intended — paint here', 'Simulated'], B: ['Direction from the source (2nd picker)', 'Simulated · tap to stamp'], C: ['Profile cross-section — tap to add points', 'Simulated'] }[m];
    document.getElementById('left-caption').textContent = cap[0];
    document.getElementById('right-caption').textContent = cap[1];
    buildLeftTools();
    ui.refreshPanels();
    ui.requestRun(false);
  };
  function buildLeftTools() {
    const box = document.getElementById('left-tools'); box.innerHTML = '';
    const m = ui.store.scene.mode;
    if (m === 'A') {
      for (const id of ['A.brush', 'A.strength', 'A.erase']) {
        const c = C.BY_ID[id];
        const inp = c.type === 'check' ? P.el('input', { type: 'checkbox', 'data-control': id }) : P.el('input', { type: 'range', 'data-control': id, min: c.min, max: c.max, step: c.step });
        const out = c.type === 'check' ? null : P.el('output', {}, String(c.get(ui.store)));
        if (out) inp.addEventListener('input', () => { out.textContent = inp.value; });
        inp.addEventListener('change', () => { ui.setControl(id, c.type === 'check' ? inp.checked : parseFloat(inp.value)); if (out) out.textContent = String(c.get(ui.store)); });
        box.append(P.el('label', { 'data-wrap': id, class: c.type === 'check' ? 'tog' : 'slider' }, c.label.replace(' (cells)', '') + ' ', inp, out));
      }
    } else if (m === 'B') {
      box.append(P.el('span', {}, 'centre = emission axis, rings = 30° steps · bright = source intensity · dim = no room in the envelope'));
    } else {
      box.append(P.el('span', { id: 'prof-info' }, ''));
    }
  }

  // ---------------------------------------------------------------- panels
  ui.refreshPanels = function () {
    P.syncControls(ui);
    P.renderStampList(ui); P.renderLensList(ui); P.renderGroups(ui); P.renderNotices(ui);
    P.syncControls(ui);
    const rA = ui.store.reports.A, box = document.getElementById('modeA-report');
    const nA = ui.store.scene.groups.A.surfaces.length;
    if (box) box.textContent = rA ? (rA.error ? rA.error : rA.placed + ' facets placed, intercepting ' + (rA.capturedFraction * 100).toFixed(1) + '% of the lamp (solid-angle accounting).' + (rA.warnings.length ? ' ' + rA.warnings.join(' ') : '') + (ui.lastGenMs ? ' Solve took ' + ui.lastGenMs.toFixed(0) + ' ms.' : ''))
      : nA ? nA + ' facets loaded with the scene (the solver report is not stored — press Generate to recompute it).' : 'No design yet.';
    const rC = ui.store.reports.C, bc = document.getElementById('modeC-report');
    if (bc) bc.textContent = rC ? (rC.error || rC.segments + ' surfaces from ' + ui.store.scene.modeC.profile.length + ' profile points.') : '';
    const diag = document.getElementById('diag');
    if (diag && rA && rA.search) diag.textContent = 'Derived from budget/envelope, not user controls — spokes: ' + rA.search.spokes + ', r0 candidates: ' + rA.search.r0Candidates + '. Per spoke r0 / captured θ-range / flux: ' + rA.spokes.map((s) => s.r0 ? s.r0.toFixed(1) + ' mm [' + s.span[0].toFixed(0) + '°–' + s.span[1].toFixed(0) + '°] ' + (s.flux * 100).toFixed(1) + '%' : '—').join('; ');
    ui.sceneDirty = true;
  };
  ui.setStatus = function (t) {
    document.getElementById('progress-text').textContent = t;
    const s = document.getElementById('run-state'); s.textContent = t; s.title = t;
  };
  // Progress: one line for the whole job (solve → trace).  'solve' = indeterminate shimmer (a
  // compositor animation, so it keeps moving while a blocking solve holds the main thread);
  // 'trace' = determinate.  The strip under the header opens only for jobs that outlast 400 ms
  // (never for drag previews), overlays the panels instead of pushing them, and tucks away 0.8 s
  // after the job ends.
  ui.progress = function (phase, frac) {
    const line = document.querySelector('.progress-line'), bar = document.getElementById('progress-bar');
    const strip = document.getElementById('progress-strip'), now = performance.now();
    if (phase !== 'done' && !ui.jobT0) {
      // new job: snap the bar to its real width with the transition off, or it animates down from
      // the previous run's 100% while fading in (read as "spawns at 50%, bounces to 20%")
      ui.jobT0 = now; bar.style.transition = 'none'; bar.style.width = phase === 'trace' ? (frac * 100).toFixed(1) + '%' : '0%';
      void bar.offsetWidth; bar.style.transition = '';
    }
    line.classList.toggle('solving', phase === 'solve');
    line.classList.toggle('done', phase === 'done');
    if (phase === 'trace') bar.style.width = (frac * 100).toFixed(1) + '%';
    if (phase === 'done') { bar.style.width = '100%'; ui.jobT0 = 0; clearTimeout(ui._stripT); ui._stripT = setTimeout(() => strip.classList.remove('open'), 800); return; }
    if (!ui.previewRun && now - ui.jobT0 > 400) { clearTimeout(ui._stripT); strip.classList.add('open'); }
  };

  // ---------------------------------------------------------------- run loop
  ui.requestRun = function (interactive) {
    ui.needCompile = true; ui.previewRun = !!interactive;
    schedule();
  };
  // rAF drives the loop; a timer fallback keeps it alive in hidden tabs (rAF is paused there),
  // where bigger slices are fine because there is no UI to keep responsive.
  function schedule() {
    if (ui.raf) return;
    ui.raf = requestAnimationFrame(tick);
    ui.tmo = setTimeout(tick, 80);
  }
  function tick() {
    cancelAnimationFrame(ui.raf); clearTimeout(ui.tmo);
    ui.raf = 0;
    const now = performance.now(), store = ui.store;
    if (ui.pendingA && !ui.interacting && now >= ui.pendingA && store.dirty.has('A') && !ui.solveArmed) {
      ui.solveArmed = true; ui.setStatus('Generating reflector…'); ui.progress('solve');   // let this frame paint first
    } else if (ui.solveArmed) {
      ui.solveArmed = false; ui.pendingA = 0;
      const t0 = performance.now(); C.regenerateA(store); ui.lastGenMs = performance.now() - t0;
      ui.refreshPanels(); ui.needCompile = true; ui.autosave();
    }
    if (ui.needCompile) {
      ui.needCompile = false;
      const sc = store.scene;
      const Pc = RF.Engine.prepare(sc, RF.State.allSurfaces(sc));
      ui.model = RF.Render.buildDrawModel(sc, Pc); ui.model.scene = sc;
      // the optics-only view follows the optics: refit when their bounding box changes
      const key = Pc.G.n + ':' + Pc.G.lo.concat(Pc.G.hi).map((v) => Math.round(v * 10)).join(',');
      if ((key !== ui.surfKey || !ui.camS.fitted) && !ui.interacting) {   // also: never fitted yet (load order)
        ui.surfKey = key;
        refitSurfaces();
      }
      const N = ui.previewRun ? Math.min(sc.sim.rays, PREVIEW_RAYS) : sc.sim.rays;
      Pc.recordHits = true;
      ui.run = { P: Pc, ctx: RF.Engine.newCtx(Pc, N, ui.rayPaths === undefined ? 240 : ui.rayPaths), preview: ui.previewRun, started: now };
      ui.lastHeat = 0; ui.sceneDirty = true;
    }
    const run = ui.run;
    let justDone = false;
    if (run && !run.ctx.done) { RF.Engine.step(run.ctx, document.hidden ? 200 : 12); justDone = run.ctx.done; }
    if (run && (justDone || now - ui.lastHeat > 90)) { drawHeat(); ui.lastHeat = now; ui.sceneDirty = true; }
    if (run) {
      const c = run.ctx, pct = c.N ? c.next / c.N : 1;
      if (!ui.solveArmed) ui.progress(c.done ? 'done' : 'trace', pct);
      if (!ui.pendingA || !store.dirty.has('A')) ui.setStatus((c.done ? 'done · ' : 'tracing · ') + c.next.toLocaleString() + ' / ' + c.N.toLocaleString() + ' rays' + (run.preview ? ' (preview)' : '') + ' · ' + c.elapsed.toFixed(0) + ' ms');
      else ui.setStatus('design changed — regenerating when you pause…');
    }
    if (run && (justDone || now - ui.lastStats > 300)) { renderStats(!run.ctx.done); ui.lastStats = now; }
    if (ui.sceneDirty) { drawSceneView(); drawSurfaceView(); drawLeft(); ui.sceneDirty = false; }
    if ((run && !run.ctx.done) || (ui.pendingA && store.dirty.has('A')) || ui.solveArmed) schedule();
  }
  function renderStats(running) {
    const run = ui.run; if (!run) return;
    const sc = ui.store.scene;
    const st = RF.Engine.stats(run.ctx, sc.mode === 'A' ? { paint: sc.modeA.paint, paintRes: sc.target.res } : null);
    let match = null;
    if (sc.mode === 'A' && run.ctx.next > 0) {
      // intent only exists at paint resolution: sum sim cells into paint cells first
      const gs = RF.Engine.gridTotal(run.ctx), rs = run.P.res, rp = sc.target.res, p = sc.modeA.paint, n = rp * rp;
      const g = RF.Engine.toPaintGrid(gs, rs, rp);
      let sg = 0, sp = 0; for (let i = 0; i < n; i++) { sg += g[i]; sp += p[i]; }
      const mg = sg / n, mp = sp / n; let cov = 0, vg = 0, vp = 0, on = 0;
      for (let i = 0; i < n; i++) { cov += (g[i] - mg) * (p[i] - mp); vg += (g[i] - mg) ** 2; vp += (p[i] - mp) ** 2; if (p[i] > 0) on += g[i]; }
      match = { r: vg > 0 && vp > 0 ? cov / Math.sqrt(vg * vp) : 0, onPaint: sg > 0 ? on / sg : 0 };
    }
    P.renderStats(ui, st, { running, preview: run.preview, match });
    if (!running) {
      const f = RF.Feasibility.analyze(sc, { designReport: sc.mode === 'A' ? ui.store.reports.A : null, stats: st, stampReports: ui.store.reports.B });
      P.renderFeasibility(ui, f, { warnings: sc.mode === 'A' && ui.store.reports.A ? ui.store.reports.A.warnings : [] });
    }
  }

  // ---------------------------------------------------------------- drawing
  function heatValues() {
    const c = ui.run.ctx, n = c.gridD.length;
    const g = RF.Engine.gridTotal(c);
    return ui.display === 'smooth' ? R2.smoothCopy(g, ui.run.P.res) : g;
  }
  // Ray-hits picture: bin every recorded hit into an M×M image, brightness clipped at the 99.5th
  // percentile of lit pixels so one hot pixel doesn't flatten the rest.  M snaps to a power of two
  // (64…2048) and each slot ('panel', 'scene') is cached until M or the hit count changes, so orbiting
  // doesn't re-bin every frame.  Percentile from an evenly strided sample of ≤20k lit pixels.
  const HIT_SIZES = [64, 128, 256, 512, 1024, 2048];
  function hitsCanvas(slot, px) {
    const c = ui.run.ctx, T = ui.run.P.T;
    const M = HIT_SIZES.find((s) => s >= px) || 2048;
    const key = M + ':' + c.nHits, cache = ui.hitsCache || (ui.hitsCache = {});
    const hit = cache[slot];
    if (hit && hit.ctx === c && hit.key === key) return hit.img;
    const buf = new Float64Array(M * M), k = M / (2 * T.half), h = c.hits;
    for (let q = 0; q < 3 * c.nHits; q += 3) {
      let i = Math.floor((h[q] + T.half) * k), j = Math.floor((h[q + 1] + T.half) * k);
      if (i >= M) i = M - 1; if (j >= M) j = M - 1; if (i < 0 || j < 0) continue;
      buf[j * M + i] += h[q + 2];
    }
    let nLit = 0; for (let i = 0; i < buf.length; i++) if (buf[i] > 0) nLit++;
    const stride = Math.max(1, Math.floor(nLit / 20000)), sample = [];
    for (let i = 0, n = 0; i < buf.length; i++) if (buf[i] > 0 && (n++ % stride === 0)) sample.push(buf[i]);
    sample.sort((x, y) => x - y);
    const clip = sample.length ? sample[Math.min(sample.length - 1, Math.floor(0.995 * sample.length))] : 0;
    const img = R2.gridCanvas(buf, M, hit ? hit.img : null, clip);
    cache[slot] = { ctx: c, key, img };
    return img;
  }
  function hitsImage(pres) {
    const dpr = Math.min(2, root.devicePixelRatio || 1), a = ui.vHeat.toScreen(0, pres), b = ui.vHeat.toScreen(pres, 0);
    return hitsCanvas('panel', Math.abs(b[0] - a[0]) * dpr);
  }
  // Scene texture: same picture setting as the panel, sized to the target's on-screen footprint.
  function sceneHeatTexture() {
    if (!ui.run || ui.display !== 'hits' || !ui.run.ctx.hits) return ui.heatImg;
    const T = RF.Engine.targetFrame(ui.store.scene.target), dpr = Math.min(2, root.devicePixelRatio || 1);
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ui.cam.project(RF.Engine.targetUVtoWorld(T, a * T.half, b * T.half)));
    let edge = 0; for (let i = 0; i < 4; i++) edge = Math.max(edge, Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]));
    return hitsCanvas('scene', edge * dpr);
  }
  function drawHeat() {
    if (!ui.run) return;
    const res = ui.run.P.res, vals = heatValues();
    const si = document.querySelector('[data-control="sim.res"]');           // auto: show the grid actually used
    if (si) { si.disabled = !!ui.store.scene.sim.autoRes; if (si.disabled) si.value = res; }
    // same brightness scale as the ray-hits view: white = 99.5th percentile, not the single max cell
    const litV = []; for (let i = 0; i < vals.length; i++) if (vals[i] > 0) litV.push(vals[i]);
    litV.sort((a, b) => a - b); const clip = RF.Engine.pctl(litV, 0.995);
    ui.heatImg = R2.gridCanvas(vals, res, ui.heatImg, clip); ui.heatImg.clipValue = clip;   // also the 3D scene texture
    const sc = ui.store.scene, pres = sc.target.res;
    const overlay = sc.mode === 'B' ? R2.stampOverlay(sc, ui.store.reports.B, sc.modeB.selected) : null;
    // The panel's content frame is always the PAINT grid (so taps/stamps map the same at any sim res);
    // the sim image is stretched into it.
    R2.drawGridPanel(document.getElementById('heat-canvas'), ui.vHeat, ui.display === 'hits' ? hitsImage(pres) : ui.heatImg, pres, overlay);
    alignFigure('heat-canvas', ui.vHeat);
    const T = ui.run.P.T, cellArea = (2 * T.half / res) ** 2 * 1e-6;       // m²
    const peak = ui.heatImg.clipValue / Math.max(1e-300, ui.run.ctx.next / ui.run.ctx.N);
    const cb = document.getElementById('colorbar');
    cb.innerHTML = '';
    const lux = peak / cellArea, luxTxt = lux >= 100 ? Math.round(lux).toLocaleString() : lux.toPrecision(3);
    cb.append(P.el('i', { style: 'background:' + R2.colorbarCSS() }), P.el('div', { class: 'cb-labels' }, P.el('span', {}, '0'), P.el('span', {}, 'peak ≈ ' + luxTxt + ' lx')));
    ui.peakInfo = { lux: luxTxt, res };
  }
  // captions / tools line up with the drawn square (the canvas letterboxes it), using the view's own fit
  function alignFigure(id, view) {
    const f = document.getElementById(id).closest('figure');
    if (f && view.fitSq) { const v = Math.floor(view.fitSq) + 'px'; if (f.style.getPropertyValue('--sq') !== v) f.style.setProperty('--sq', v); }
  }
  function drawLeft() {
    const sc = ui.store.scene, cv = document.getElementById('left-canvas');
    if (sc.mode === 'A') {
      ui.paintImg = R2.gridCanvas(sc.modeA.paint, sc.target.res, ui.paintImg);
      R2.drawGridPanel(cv, ui.vLeft, ui.paintImg, sc.target.res, (ctx, view) => {
        if (ui.brushAt) { const b = sc.modeA.brush, p = view.toScreen(ui.brushAt[0], ui.brushAt[1]); ctx.beginPath(); ctx.arc(p[0], p[1], b.size / 2 * view.s, 0, 2 * Math.PI); ctx.strokeStyle = b.erase ? '#ff9a3d' : '#f2b441'; ctx.lineWidth = 1.5; ctx.stroke(); }
      });
    } else if (sc.mode === 'B') {
      const r = R2.drawPicker(cv, ui.vPick, sc, ui.store.reports.B, sc.modeB.selected);
      ui.pickMarks = r.marks; ui.pickTmax = r.tmax;
    } else {
      const r = R2.drawProfile(cv, ui.vProf, sc, ui.profSel, false);
      ui.profHandles = r.handles;
      const info = document.getElementById('prof-info');
      if (info) info.textContent = sc.modeC.profile.length < 2 ? 'Empty profile — tap to add points, or use “Apply preset to profile” in the side panel.' : sc.modeC.profile.length + ' points · ' + (ui.profSel >= 0 ? 'point ' + (ui.profSel + 1) + ' selected' : 'tap empty space to add a point');
    }
    alignFigure('left-canvas', sc.mode === 'A' ? ui.vLeft : sc.mode === 'B' ? ui.vPick : ui.vProf);
  }
  function drawSceneView() {
    if (!ui.model) return;
    const sc = ui.store.scene;
    ui.handles = RF.Render.drawScene(document.getElementById('scene-canvas'), ui.cam, {
      scene: sc, model: ui.model, paths: ui.run ? ui.run.ctx.paths : null, heatCanvas: sceneHeatTexture(), showRays: ui.showRays,
      activeHandle: ui.activeHandle, preview: ui.preview && performance.now() < ui.preview.until ? ui.preview.pts : null, highlight: ui.highlight,
    });
    const hint = document.getElementById('scene-hint');
    hint.classList.toggle('dragging', !!ui.activeHandle);
    hint.textContent = ui.activeHandle ? 'dragging ' + ui.activeHandle.label : (ui.turntable ? 'drag: orbit (level)' : 'drag: orbit (free)') + ' · pinch/wheel: zoom · two fingers/shift-drag: pan · handles: source, axis tip, envelope faces, target';
  }
  function drawSurfaceView() {
    if (!ui.model) return;
    RF.Render.drawSurfaceView(document.getElementById('surface-canvas'), ui.camS, { scene: ui.store.scene, model: ui.model, style: ui.surfaceView });
  }

  // camera fitting
  ui.fit = function (mode) {
    ui.fitMode = mode;
    {   // always rebuild: surfaces can be regenerated into the same scene object (stale model ⇒ bad fit on load)
      const Pc = RF.Engine.prepare(ui.store.scene, RF.State.allSurfaces(ui.store.scene));
      ui.model = RF.Render.buildDrawModel(ui.store.scene, Pc); ui.model.scene = ui.store.scene;
    }
    const sc = ui.store.scene, pts = [sc.source.pos];
    const e = sc.envelope;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([e.center[0] + sx * e.half[0], e.center[1] + sy * e.half[1], e.center[2] + sz * e.half[2]]);
    // fit to the actual surface outlines (a revolved surface's origin is just the source point)
    const outlinePts = [];
    if (ui.model) for (const p of ui.model.polys) for (const q of p.pts) outlinePts.push(q);
    pts.push(...outlinePts);
    const cvs = document.getElementById('scene-canvas').getBoundingClientRect();
    ui.cam.w = cvs.width; ui.cam.h = cvs.height;
    if (mode === 'all') {
      const T = RF.Engine.targetFrame(sc.target);
      for (const a of [-1, 1]) for (const b of [-1, 1]) pts.push(RF.Engine.targetUVtoWorld(T, a * T.half, b * T.half));
    }
    ui.cam.fit(pts, 0.1);
    const cs = document.getElementById('surface-canvas').getBoundingClientRect();
    ui.camS.w = cs.width; ui.camS.h = cs.height; ui.camS.R = ui.cam.R.map((r) => r.slice());
    ui.camS.fit([sc.source.pos].concat(outlinePts), 0.12);
    for (const b of document.querySelectorAll('[data-fit]')) b.classList.toggle('on', b.dataset.fit === mode);
    ui.sceneDirty = true; schedule();
  };

  // ---------------------------------------------------------------- canvas interactions
  function interact(on) {
    const was = ui.interacting;
    ui.interacting = on;
    if (was && !on) {                                   // gesture ended: refine to full quality
      if (ui.store.dirty.has('A') && ui.store.autoA) ui.pendingA = performance.now() + 250;
      if (ui.movedSomething) { ui.movedSomething = false; ui.requestRun(false); ui.autosave(); ui.refreshPanels(); }
      ui.activeHandle = null; ui.sceneDirty = true; schedule();
    }
  }
  function wireScene() {
    const cv = document.getElementById('scene-canvas');
    RF.Input.attach(cv, {
      onInteract: interact,
      hitTest(x, y) {
        let best = null, bd = Infinity;
        for (const h of ui.handles) { const d = Math.hypot(h.x - x, h.y - y); if (d <= Math.max(h.r, 14) && d < bd) { best = h; bd = d; } }
        return best;
      },
      onDragStart(h) { ui.activeHandle = h; },
      onDrag(h, x, y, dx, dy) {
        const sc = ui.store.scene, cam = ui.cam;
        const along = (axis) => {                        // world distance moved along a unit axis
          const sv = [V.dot(cam.R[0], axis) * cam.scale, -V.dot(cam.R[1], axis) * cam.scale];
          const l2 = sv[0] * sv[0] + sv[1] * sv[1];
          return l2 > 1e-9 ? (dx * sv[0] + dy * sv[1]) / l2 : 0;
        };
        if (h.id === 'src') C.actions.moveSource(ui.store, V.add(sc.source.pos, cam.screenToWorldDelta(dx, dy)));
        else if (h.id === 'axis') {
          h.tip = V.add(h.tip, cam.screenToWorldDelta(dx, dy));
          C.actions.setSourceAxis(ui.store, V.sub(h.tip, sc.source.pos));
        } else if (h.id === 'env') {
          const ax = [0, 0, 0]; ax[h.axis] = 1;
          const d = along(ax), e = sc.envelope;
          const lo = e.center[h.axis] - e.half[h.axis], hi = e.center[h.axis] + e.half[h.axis];
          let nlo = lo, nhi = hi;
          if (h.sign > 0) nhi = Math.max(lo + 1e-3 * (hi - lo + 1), hi + d); else nlo = Math.min(hi - 1e-3 * (hi - lo + 1), lo + d);
          const c = e.center.slice(); c[h.axis] = (nlo + nhi) / 2;
          C.actions.setEnvelopeCenter(ui.store, c); C.actions.setEnvelopeHalf(ui.store, h.axis, (nhi - nlo) / 2);
        } else if (h.id === 'tgt') {
          C.actions.setTargetDistance(ui.store, sc.target.distance + along([1, 0, 0]));
        }
        ui.movedSomething = true;
        ui.store.commit({ deferA: true });
        if (ui.store.dirty.has('A') && ui.store.autoA) ui.pendingA = performance.now() + 600;
        P.syncControls(ui);
        ui.requestRun(true);
      },
      onDragEnd() {},
      onPrimary(x, y, dx, dy) { ui.cam[ui.turntable ? 'turntable' : 'orbit'](dx, dy); ui.sceneDirty = true; schedule(); },
      onPan(dx, dy) { ui.cam.pan[0] += dx; ui.cam.pan[1] += dy; ui.sceneDirty = true; schedule(); },
      onZoom(f, x, y) { ui.cam.zoomAt(f, x, y); ui.sceneDirty = true; schedule(); },
    });
    const cs = document.getElementById('surface-canvas');
    RF.Input.attach(cs, {
      onPrimary(x, y, dx, dy) { ui.camS[ui.turntable ? 'turntable' : 'orbit'](dx, dy); ui.sceneDirty = true; schedule(); },
      onPan(dx, dy) { ui.camS.pan[0] += dx; ui.camS.pan[1] += dy; ui.sceneDirty = true; schedule(); },
      onZoom(f, x, y) { ui.camS.zoomAt(f, x, y); ui.sceneDirty = true; schedule(); },
    });
  }
  function wireHeat() {
    const cv = document.getElementById('heat-canvas');
    const T = () => RF.Engine.targetFrame(ui.store.scene.target);
    const toUV = (x, y) => { const c = ui.vHeat.toContent(x, y); return R2.cellToUV(T(), c[0], c[1]); };
    RF.Input.attach(cv, {
      onInteract: interact,
      hitTest(x, y) {
        const sc = ui.store.scene; if (sc.mode !== 'B') return null;
        const t = T(), cell = 2 * t.half / t.res;
        let best = null, bd = Infinity;
        for (const st of sc.modeB.stamps) {
          const c = R2.uvToCell(t, st.u, st.v), p = ui.vHeat.toScreen(c[0], c[1]);
          const d = Math.hypot(p[0] - x, p[1] - y), half = st.scale / cell / 2 * ui.vHeat.s;
          if ((d < 16 || (Math.abs(p[0] - x) < half && Math.abs(p[1] - y) < half)) && d < bd) { best = st; bd = d; }
        }
        return best;
      },
      onDragStart(st) { ui.store.scene.modeB.selected = st.id; },
      onDrag(st, x, y) { const uv = toUV(x, y); C.actions.moveStamp(ui.store, st.id, uv[0], uv[1]); ui.movedSomething = true; ui.store.commit({ deferA: true }); firePreview(st.id); ui.requestRun(true); },
      onTap(x, y, st) {
        const sc = ui.store.scene;
        if (sc.mode !== 'B') return;
        if (st) { ui.selectStamp(st.id); return; }
        const uv = toUV(x, y), t = T();
        if (Math.abs(uv[0]) > t.half || Math.abs(uv[1]) > t.half) return;
        ui.addStampAt(uv[0], uv[1]);
      },
      onPrimary(x, y, dx, dy) { ui.vHeat.panBy(dx, dy); drawHeat(); },
      onPan(dx, dy) { ui.vHeat.panBy(dx, dy); drawHeat(); },
      onZoom(f, x, y) { ui.vHeat.zoomAt(f, x, y); drawHeat(); },
    });
  }
  function wireLeft() {
    const cv = document.getElementById('left-canvas');
    const view = () => ({ A: ui.vLeft, B: ui.vPick, C: ui.vProf }[ui.store.scene.mode]);
    RF.Input.attach(cv, {
      onInteract: interact,
      hitTest(x, y) {
        const m = ui.store.scene.mode;
        // nearest handle within reach (handles can be packed tightly, e.g. near a profile vertex)
        const nearest = (list, r) => { let best = null, bd = r; for (const k of list) { const d = Math.hypot(k.x - x, k.y - y); if (d < bd) { bd = d; best = k; } } return best; };
        if (m === 'B') { const k = nearest(ui.pickMarks, 16); if (k) return { kind: 'mark', id: k.id }; }
        if (m === 'C') { const hd = nearest(ui.profHandles, 14); if (hd) return { kind: 'pt', i: hd.i }; }
        return null;
      },
      onDragStart(t) { if (t.kind === 'pt') { ui.profSel = t.i; ui.vProf.lockBounds = ui.vProf.bounds.slice(); } if (t.kind === 'mark') ui.store.scene.modeB.selected = t.id; },
      onDrag(t, x, y) {
        if (t.kind === 'mark') {
          const c = ui.vPick.toContent(x, y), rr = Math.min(1, Math.hypot(c[0], c[1]));
          C.actions.setStampDir(ui.store, t.id, Math.max(0.5, rr * ui.pickTmax), Math.atan2(c[1], c[0]) * 180 / Math.PI);
          ui.store.commit({ deferA: true }); firePreview(t.id);
        } else if (t.kind === 'pt') {
          const c = ui.vProf.toContent(x, y), pts = ui.store.scene.modeC.profile.map((p) => p.slice());
          pts[t.i] = [ui.store.scene.modeC.sweep === 'revolve' ? Math.max(0, c[0]) : c[0], c[1]];
          C.actions.setProfile(ui.store, pts); ui.store.commit({ deferA: true });
        }
        ui.movedSomething = true; ui.sceneDirty = true; ui.requestRun(true);
      },
      onDragEnd(t) { if (t && t.kind === 'pt') ui.vProf.lockBounds = null; },
      onTap(x, y, t) {
        const m = ui.store.scene.mode;
        if (m === 'B' && t && t.kind === 'mark') { ui.selectStamp(t.id); return; }
        if (m === 'C') {
          if (t && t.kind === 'pt') { ui.profSel = t.i; ui.sceneDirty = true; schedule(); return; }
          const c = ui.vProf.toContent(x, y), pts = ui.store.scene.modeC.profile.map((p) => p.slice());
          pts.push([ui.store.scene.modeC.sweep === 'revolve' ? Math.max(0, c[0]) : c[0], c[1]]);
          ui.profSel = pts.length - 1;
          ui.vProf.lockBounds = ui.vProf.bounds.slice();
          C.actions.setProfile(ui.store, pts); ui.afterChange();
          setTimeout(() => { ui.vProf.lockBounds = null; }, 0);
        }
        if (m === 'A') paintAt(x, y, true);
      },
      onPrimaryStart(x, y) { if (ui.store.scene.mode === 'A') paintAt(x, y, false); },
      onPrimary(x, y, dx, dy) {
        const m = ui.store.scene.mode;
        if (m === 'A') paintAt(x, y, false);
        else { view().panBy(dx, dy); ui.sceneDirty = true; schedule(); }
      },
      onPrimaryEnd() { if (ui.store.scene.mode === 'A' && ui.painted) { ui.painted = false; ui.afterChange(); } },
      onHover(x, y) { if (ui.store.scene.mode === 'A') { ui.brushAt = ui.vLeft.toContent(x, y); ui.sceneDirty = true; schedule(); } },
      onPan(dx, dy) { view().panBy(dx, dy); ui.sceneDirty = true; schedule(); },
      onZoom(f, x, y) { const v = view(); v.zoomAt(f, x, y); if (v === ui.vProf) v.lockBounds = v.bounds.slice(); ui.sceneDirty = true; schedule(); },
    });
    function paintAt(x, y, commit) {
      const c = ui.vLeft.toContent(x, y), uv = R2.cellToUV(RF.Engine.targetFrame(ui.store.scene.target), c[0], c[1]);
      ui.brushAt = c;
      if (C.actions.paintAt(ui.store, uv[0], uv[1])) ui.painted = true;
      ui.sceneDirty = true; schedule();
      if (commit && ui.painted) { ui.painted = false; ui.afterChange(); }
    }
  }

  // Single-ray preview through the engine: source centre → facet centre → onward
  function firePreview(stampId) {
    const sc = ui.store.scene, f = sc.groups.B.surfaces.find((s) => s.id === 'B' + stampId);
    if (!f) { ui.preview = null; return; }
    const Pc = RF.Engine.prepare(sc, RF.State.allSurfaces(sc));
    const pr = RF.Engine.probeRay(Pc, sc.source.pos, V.sub(f.P, sc.source.pos));
    const pts = [sc.source.pos.slice()];
    for (const e of pr.events) { if (e.point) pts.push(e.point); else if (e.dir) pts.push(V.madd(pts[pts.length - 1], e.dir, Pc.scale * 1.5)); }
    ui.preview = { pts, until: performance.now() + 4000 };
    ui.highlight = f.id; ui.sceneDirty = true; schedule();
    setTimeout(() => { ui.sceneDirty = true; ui.highlight = null; schedule(); }, 4100);
  }

  // ---------------------------------------------------------------- actions used by panels
  ui.addStampAt = function (u, v, quiet) {
    const st = C.actions.addStamp(ui.store, u, v);
    ui.store.commit({ deferA: true });
    if (!quiet) { firePreview(st.id); ui.afterChange(); }
    return st;
  };
  ui.selectStamp = function (id) { ui.store.scene.modeB.selected = id; firePreview(id); ui.refreshPanels(); drawHeat(); };
  ui.duplicateStamp = function (id) { const s = C.actions.duplicateStamp(ui.store, id); ui.afterChange(); if (s) firePreview(s.id); };
  ui.deleteStamp = function (id) { C.actions.deleteStamp(ui.store, id); ui.afterChange(); };
  ui.clearStamps = function () { C.actions.clearStamps(ui.store); ui.afterChange(); };
  ui.paintPreset = function (k) { C.actions.paintPreset(ui.store, k); ui.afterChange(); };
  // paint patterns: built-ins + saved in this browser (resampled to the current paint grid on load)
  const BUILTIN_PATTERNS = [['beam', 'Beam (two-level)'], ['lowbeam', 'Low beam (15° cutoff)'], ['spot', 'Spot'], ['twospot', 'Two spots'], ['ring', 'Ring'], ['thinring', 'Thin ring'],
    ['band', 'Band'], ['stripes', 'Stripes'], ['cross', 'Cross'], ['frame', 'Frame'], ['gradient', 'Gradient'], ['wall', 'Wall wash'], ['checker', 'Checker (1-cell)']];
  const loadPatterns = () => { try { return JSON.parse(localStorage.getItem('flux/patterns') || '{}'); } catch (e) { return {}; } };
  const savePatterns = (o) => { try { localStorage.setItem('flux/patterns', JSON.stringify(o)); return true; } catch (e) { return false; } };
  function renderPatterns() {
    const box = document.getElementById('pattern-box'); if (!box) return;
    box.innerHTML = '';
    const saved = loadPatterns(), sel = P.el('select', { 'aria-label': 'Paint pattern' }, P.el('option', { value: '' }, 'Pattern…'),
      P.el('optgroup', { label: 'Built-in' }, ...BUILTIN_PATTERNS.map(([k, n]) => P.el('option', { value: 'b:' + k }, n))),
      ...(Object.keys(saved).length ? [P.el('optgroup', { label: 'Saved' }, ...Object.keys(saved).sort().map((n) => P.el('option', { value: 's:' + n }, n)))] : []));
    sel.addEventListener('change', () => {
      const v = sel.value; if (!v) return;
      if (v.startsWith('b:')) ui.paintPreset(v.slice(2));
      else { const s = loadPatterns()[v.slice(2)]; if (s) { C.actions.setPaint(ui.store, s.paint, s.res); ui.afterChange(); } }
      del.disabled = !v.startsWith('s:'); ui._patSel = v;
    });
    const name = P.el('input', { type: 'text', placeholder: 'name', 'aria-label': 'Pattern name', class: 'pat-name' });
    const saveBtn = P.el('button', { type: 'button', title: 'Save the current painting as a pattern in this browser' }, 'Save');
    saveBtn.addEventListener('click', () => {
      const n = name.value.trim() || ('Pattern ' + new Date().toLocaleString());
      const o = loadPatterns(); o[n] = { res: ui.store.scene.target.res, paint: ui.store.scene.modeA.paint.slice() };
      ui.store.notice(savePatterns(o) ? 'Saved pattern “' + n + '”.' : 'Could not save the pattern (browser storage full or unavailable).');
      ui._patSel = 's:' + n; renderPatterns(); ui.refreshPanels();
    });
    const del = confirmDel(() => { const o = loadPatterns(); delete o[(ui._patSel || '').slice(2)]; savePatterns(o); ui._patSel = ''; renderPatterns(); });
    del.disabled = !(ui._patSel || '').startsWith('s:');
    if (ui._patSel && [...sel.options].some((o) => o.value === ui._patSel)) sel.value = ui._patSel;
    box.append(P.el('div', { class: 'row' }, P.el('label', {}, 'Pattern'), sel),
      P.el('div', { class: 'btnrow' }, name, saveBtn, del, P.confirmButton('Clear paint', 'Clear the painting?', () => ui.clearPaint())));
  }
  const confirmDel = (fn) => { const b = P.confirmButton('Delete', 'Delete this saved pattern?', fn); b.title = 'Delete the selected saved pattern'; return b; };
  ui.renderPatterns = renderPatterns;
  ui.clearPaint = function () { C.actions.clearPaint(ui.store); ui.afterChange(); };
  ui.applyPreset = function (quiet) { C.actions.applyPreset(ui.store); ui.profSel = -1; ui.vProf.fitted = false; ui.store.commit({ deferA: true }); if (!quiet) ui.afterChange(); };
  ui.deleteProfilePoint = function () {
    if (ui.profSel < 0) return;
    const pts = ui.store.scene.modeC.profile.filter((p, i) => i !== ui.profSel);
    ui.profSel = -1; C.actions.setProfile(ui.store, pts); ui.afterChange();
  };
  ui.clearProfile = function () { ui.profSel = -1; C.actions.setProfile(ui.store, []); ui.afterChange(); };
  ui.addLens = function (kind) { C.actions.addLens(ui.store, kind); ui.afterChange(); };
  ui.updateLens = function (id, k, v) { C.actions.updateLens(ui.store, id, k, v); ui.afterChange(); };
  ui.removeLens = function (id) { C.actions.removeLens(ui.store, id); ui.afterChange(); };
  ui.setGroupEnabled = function (g, on) { C.actions.setGroupEnabled(ui.store, g, on); ui.store.invalidate(g === 'B' ? [] : ['B']); ui.afterChange(); };
  ui.clearGroup = function (g) { C.actions.clearGroup(ui.store, g); ui.afterChange(); };
  ui.runChecks = function () { P.runChecks(ui); };

  // ---------------------------------------------------------------- layout grid
  // Computes the main grid from the sidebar and collapsed-panel state (a static CSS grid can't express
  // every combination).  Collapsed panels keep only their title bar; the others take the space.
  function layoutGrid() {
    const L = document.querySelector('.layout'), c = ui.collapsed || {}, w = root.innerWidth;
    const side = !document.body.classList.contains('side-hidden') && w > 820;
    for (const [k, sel] of [['scene', '.scene-panel'], ['target', '.target-panel'], ['surface', '.surface-panel']]) document.querySelector(sel).classList.toggle('collapsed', !!c[k]);
    document.body.classList.toggle('target-collapsed', !!c.target);
    const S = side ? ' side' : '';
    let cols, areas, rows;
    if (w > 1180) {
      cols = 'minmax(0, 1.3fr) minmax(0, 1fr)' + (side ? ' 340px' : '');
      if (!c.scene) {
        // min-content, not auto: auto rows get stretched by the scene panel spanning both rows
        const MC = 'min-content';
        areas = ['scene target' + S, 'scene surface' + S, 'stats stats' + S];
        // a lone flexible row must be 1fr: fr factors summing to < 1 claim only that fraction of the space
        rows = [c.target ? MC : (c.surface ? 'minmax(0, 1fr)' : 'minmax(0, 1.2fr)'), c.surface ? (c.target ? 'minmax(0, 1fr)' : MC) : (c.target ? 'minmax(0, 1fr)' : 'minmax(0, .8fr)'), MC];
      } else {
        const MC = 'min-content';
        areas = ['scene scene' + S, 'target surface' + S, 'stats stats' + S];
        rows = [MC, c.target && c.surface ? MC : 'minmax(0, 1fr)', MC];
      }
    } else {
      // stacked: scene ≥ square, ~60% of the screen, capped; phones get paint/sim stacked (CSS)
      cols = w > 820 ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)';
      const one = (a) => (w > 820 ? a + ' ' + a : a);
      areas = [one('scene'), one('target'), one('surface'), one('stats')].concat(side ? [one('side')] : []);
      rows = [c.scene ? 'auto' : 'min(max(60vh, calc(100vw - 16px)), 85vh)', 'auto', c.surface ? 'auto' : (w > 820 ? '320px' : '280px'), 'auto'].concat(side ? ['auto'] : []);
    }
    L.style.gridTemplateColumns = cols; L.style.gridTemplateAreas = areas.map((a) => '"' + a + '"').join(' '); L.style.gridTemplateRows = rows.join(' ');
    requestAnimationFrame(() => { healCameras(); ui.sceneDirty = true; drawHeat(); schedule(); });
    setTimeout(() => { healCameras(); ui.sceneDirty = true; schedule(); }, 120);   // hidden tabs skip rAF
  }
  ui.layoutGrid = layoutGrid;
  function refitSurfaces() {
    if (!ui.model) return;
    const pts = [ui.store.scene.source.pos]; for (const p of ui.model.polys) for (const q of p.pts) pts.push(q);
    const cs = document.getElementById('surface-canvas').getBoundingClientRect();
    ui.camS.w = cs.width; ui.camS.h = cs.height; ui.camS.fit(pts, 0.12);
  }
  // after a layout change: a camera whose canvas was 0×0 (collapsed) has no valid scale — refit it
  function healCameras() {
    if (!ui.camS.fitted || !(ui.camS.scale > 0)) refitSurfaces();
    if (!ui.cam.fitted || !(ui.cam.scale > 0)) ui.fit(ui.fitMode || 'fixture');
  }

  // ---------------------------------------------------------------- boot
  function wireTopbar() {
    for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => ui.setMode(b.dataset.mode));
    document.querySelector('[data-control="tgt.res"]').addEventListener('change', () => { ui.vLeft.fitted = ui.vHeat.fitted = false; });
    document.querySelector('[data-control-view="surfaceView"]').addEventListener('change', (e) => { ui.surfaceView = e.target.value; ui.sceneDirty = true; schedule(); });
    for (const b of document.querySelectorAll('#heat-display button')) b.addEventListener('click', () => {
      ui.display = b.dataset.disp;
      for (const o of document.querySelectorAll('#heat-display button')) o.classList.toggle('on', o === b);
      drawHeat(); ui.sceneDirty = true; schedule();
    });
    // reset zoom on the target canvases (button or double-click)
    const resetView = (w) => { if (w === 'heat') ui.vHeat.fitted = false; else ui.vLeft.fitted = ui.vPick.fitted = ui.vProf.fitted = false; drawHeat(); ui.sceneDirty = true; schedule(); };
    for (const b of document.querySelectorAll('[data-reset]')) b.addEventListener('click', () => resetView(b.dataset.reset));
    document.getElementById('left-canvas').addEventListener('dblclick', () => resetView('left'));
    document.getElementById('heat-canvas').addEventListener('dblclick', () => resetView('heat'));
    // collapsible panels: click the title; the grid is recomputed so the others take the space
    ui.collapsed = {}; try { ui.collapsed = JSON.parse(localStorage.getItem('flux/collapsed') || '{}'); } catch (e) { /* ignore */ }
    for (const h of document.querySelectorAll('.collapser')) h.addEventListener('click', () => {
      const k = h.dataset.panel; ui.collapsed[k] = !ui.collapsed[k];
      try { localStorage.setItem('flux/collapsed', JSON.stringify(ui.collapsed)); } catch (e) { /* ignore */ }
      layoutGrid();
    });
    layoutGrid();
    // scene hint: on load, and again after a long idle; any interaction hides it
    const hint = document.getElementById('scene-hint');
    const showHint = (ms) => { hint.classList.add('show'); clearTimeout(ui._hintT); ui._hintT = setTimeout(() => { if (!ui.activeHandle) hint.classList.remove('show'); }, ms); };
    const poke = () => { clearTimeout(ui._idleT); ui._idleT = setTimeout(() => showHint(8000), 60000); };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, () => { if (!ui.activeHandle) hint.classList.remove('show'); poke(); }, { passive: true });
    showHint(6000); poke();
    for (const b of document.querySelectorAll('[data-fit]')) b.addEventListener('click', () => ui.fit(b.dataset.fit));
    document.getElementById('btn-download').addEventListener('click', () => P.download(ui));
    document.getElementById('btn-generate-top').addEventListener('click', () => ui.generateA());
    // Lens slider: 0–99 → 12–400 mm on a log scale; 100 → ∞ (orthographic).
    const lens = document.getElementById('lens'), lensOut = document.getElementById('lens-out');
    const focalOf = (t) => t >= 100 ? Infinity : 12 * Math.pow(400 / 12, t / 99);
    const applyLens = () => {
      const f = focalOf(+lens.value); ui.cam.focal = ui.camS.focal = f;
      lensOut.textContent = isFinite(f) ? Math.round(f) + ' mm' : '∞';
      try { localStorage.setItem('flux/lens', lens.value); } catch (e) { /* ignore */ }
      ui.sceneDirty = true; schedule();
    };
    try { const v = localStorage.getItem('flux/lens'); if (v !== null) lens.value = v; } catch (e) { /* ignore */ }
    lens.addEventListener('input', applyLens); applyLens();
    // ⋯ menu: toggle, close on outside click / Escape / after picking an item (confirm buttons keep it open)
    document.getElementById('btn-undo').addEventListener('click', () => ui.undo());
    document.getElementById('btn-redo').addEventListener('click', () => ui.redo());
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target;   // typing in a field keeps the browser's own text undo
      if (t && t.matches && t.matches('input:not([type=checkbox]):not([type=range]):not([type=file]), select, textarea, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); ui.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); ui.redo(); }
    });
    // stats footer: minimal by default, Details expands to the full readout (remembered)
    const det = document.getElementById('btn-details'), full = document.getElementById('stats-full');
    const setDetails = (open) => { full.hidden = !open; det.setAttribute('aria-expanded', String(open)); det.textContent = open ? 'Details ▴' : 'Details ▾';
      try { localStorage.setItem('flux/details', open ? '1' : '0'); } catch (e) { /* ignore */ } requestAnimationFrame(() => root.dispatchEvent(new Event('resize'))); };
    let detPref = null; try { detPref = localStorage.getItem('flux/details'); } catch (e) { /* ignore */ }
    setDetails(detPref === '1'); det.addEventListener('click', () => setDetails(full.hidden));
    const more = document.getElementById('btn-more'), pop = document.querySelector('.menu-pop');
    const closeMenu = () => { pop.hidden = true; more.setAttribute('aria-expanded', 'false'); };
    more.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; more.setAttribute('aria-expanded', String(!pop.hidden)); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    pop.addEventListener('click', (e) => { const b = e.target.closest('button,label'); if (b && !b.classList.contains('danger') && b.id !== 'btn-restore') setTimeout(closeMenu, 0); });
    // settings sidebar: collapsible (desktop) / drawer (phone); remembered per browser
    const sideBtn = document.getElementById('btn-side'), narrow = () => root.matchMedia('(max-width: 820px)').matches;
    const setSide = (show) => {
      document.body.classList.toggle('side-hidden', !show); sideBtn.setAttribute('aria-pressed', String(show));
      if (!narrow()) try { localStorage.setItem('flux/side', show ? '1' : '0'); } catch (e) { /* ignore */ }   // phones: drawer state isn't remembered
      if (ui.collapsed) layoutGrid();
      requestAnimationFrame(() => root.dispatchEvent(new Event('resize')));
    };
    let sidePref = null; try { sidePref = localStorage.getItem('flux/side'); } catch (e) { /* ignore */ }
    setSide(narrow() ? false : sidePref !== '0');
    sideBtn.addEventListener('click', () => setSide(document.body.classList.contains('side-hidden')));
    // drawn ray paths in the scene (display only — the trace itself is unaffected)
    const rp = document.getElementById('ray-paths'), rpOut = document.getElementById('ray-paths-out');
    try { const v = localStorage.getItem('flux/rayPaths'); if (v !== null) rp.value = v; } catch (e) { /* ignore */ }
    const applyRP = (rerun) => { ui.rayPaths = +rp.value; rpOut.textContent = rp.value; try { localStorage.setItem('flux/rayPaths', rp.value); } catch (e) { /* ignore */ } if (rerun) ui.requestRun(false); };
    rp.addEventListener('input', () => { rpOut.textContent = rp.value; }); rp.addEventListener('change', () => applyRP(true)); applyRP(false);
    const tt = document.getElementById('turntable');
    try { ui.turntable = localStorage.getItem('flux/turntable') !== '0'; } catch (e) { ui.turntable = true; }
    tt.checked = ui.turntable;
    tt.addEventListener('change', () => {
      ui.turntable = tt.checked; try { localStorage.setItem('flux/turntable', tt.checked ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ui.turntable) { ui.cam.turntable(0, 0); ui.camS.turntable(0, 0); ui.fit(ui.fitMode); }   // level it now
      ui.sceneDirty = true; schedule();
    });
    const snapTitle = () => { const t = RF.State.snapshotTime(); return t ? 'Restore the snapshot saved ' + new Date(t).toLocaleString() : 'No snapshot saved in this browser yet'; };
    const rs = P.confirmButton('Restore', 'Replace current scene?', () => {
      const s = RF.State.loadSnapshot(); if (!s) { ui.store.notice('No snapshot saved in this browser yet.'); ui.refreshPanels(); return; }
      ui._histHint = 'Restore snapshot'; ui._histMode = ui.store.scene.mode; ui.loadScene(s, 'Restored the snapshot from ' + new Date(RF.State.snapshotTime()).toLocaleString() + '.');
    });
    rs.id = 'btn-restore'; rs.classList.remove('danger'); rs.title = snapTitle();
    document.getElementById('btn-restore').replaceWith(rs);
    document.getElementById('btn-snapshot').addEventListener('click', () => {
      const ok = RF.State.saveSnapshot(ui.store.scene); rs.title = snapTitle();
      ui.store.notice(ok ? 'Snapshot saved in this browser. Restore brings it back; autosave never overwrites it.' : 'Could not save: browser storage unavailable or full.');
      ui.setStatus(ok ? 'snapshot saved' : 'snapshot failed'); ui.refreshPanels();
    });
    document.getElementById('file-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) P.upload(ui, f); e.target.value = ''; });
    const reset = document.getElementById('btn-reset');
    const rb = P.confirmButton('Reset', 'Reset everything?', () => { RF.State.clearLocal(); ui._histHint = 'Reset'; ui._histMode = ui.store.scene.mode; ui.loadScene(RF.State.defaultScene(), 'Scene reset to defaults.'); });
    rb.id = 'btn-reset'; reset.replaceWith(rb);
    const sel = document.getElementById('preset-select');
    sel.addEventListener('change', () => {
      const name = sel.value; if (!name) return;
      const bar = document.getElementById('preset-confirm') || P.el('div', { id: 'preset-confirm', class: 'btnrow' });
      bar.innerHTML = '';
      const presetLabel = sel.options[sel.selectedIndex].text;
      const ok = P.el('button', { type: 'button', class: 'primary' }, 'Replace scene with “' + presetLabel + '”');
      const no = P.el('button', { type: 'button' }, 'Cancel');
      ok.addEventListener('click', () => { const p = P.presetScene(name); bar.remove(); sel.value = ''; if (p) { ui._histHint = 'Preset: ' + presetLabel; ui._histMode = ui.store.scene.mode; } if (p) ui.loadScene(p.scene, 'Preset: ' + p.notes.join('; ') + '.'); });
      no.addEventListener('click', () => { bar.remove(); sel.value = ''; });
      bar.append(ok, no);
      document.querySelector('.side-top').append(bar);
    });
    root.addEventListener('resize', () => { clearTimeout(ui._layT); ui._layT = setTimeout(layoutGrid, 60); ui.sceneDirty = true; drawHeat(); schedule(); });
  }

  function boot() {
    let scene = null, restored = false;
    try { scene = RF.State.loadLocal(); restored = !!scene; } catch (e) { scene = null; }
    if (!scene) scene = RF.State.defaultScene();
    ui.store = C.createStore(scene);
    P.buildSide(ui); renderPatterns();
    wireTopbar(); wireScene(); wireHeat(); wireLeft();
    ui.loadScene(scene, restored ? 'Restored your last scene from this browser (localStorage).' : null, true);
    if (!scene.groups.A.surfaces.length && scene.mode === 'A') { C.regenerateA(ui.store); }
    ui.hist = RF.History.create(100); ui.hist.reset(RF.History.intent(ui.store.scene)); updateUndoButtons();   // history doesn't survive a reload
    ui.setMode(scene.mode, true);
    setTimeout(() => { ui.fit('fixture'); ui.refreshPanels(); ui.requestRun(false); }, 0);
  }
  function safeBoot() {
    try {
      const need = ['V', 'Geo', 'Source', 'Engine', 'State', 'Solver', 'ModeA', 'ModeB', 'Feasibility', 'Profile', 'Lenses', 'Controller', 'Render', 'Render2D', 'Input', 'Panels'];
      const missing = need.filter((k) => !RF[k]);
      if (missing.length) throw new Error('module(s) did not load: ' + missing.join(', ') + ' — check the js/ folder is complete.');
      boot();
    } catch (e) {
      const el = document.getElementById('boot-error');
      if (el) { el.hidden = false; el.textContent = 'The app failed to start: ' + e.message + ' (No HTTP server is needed — index.html runs from file://.)'; }
      throw e;
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot); else safeBoot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
