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
    ui.setStatus('Generating reflector…');
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
  ui.autosave = function () { clearTimeout(ui._saveT); ui._saveT = setTimeout(() => RF.State.saveLocal(ui.store.scene), 800); };
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
    document.body.classList.remove('mode-A', 'mode-B', 'mode-C');
    document.body.classList.add('mode-' + m);
    const gt = document.getElementById('btn-generate-top');
    if (gt) { gt.disabled = m !== 'A'; gt.title = m === 'A' ? 'Solve the reflector for the painted target' : 'Stamp and Profile modes rebuild live; Generate is for Paint mode'; }
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', b.dataset.mode === m ? 'true' : 'false');
    const cap = { A: ['Intended — paint here', 'Simulated'], B: ['Direction from the source (2nd picker)', 'Simulated · tap to stamp'], C: ['Profile cross-section — tap to add points', 'Simulated'] }[m];
    document.getElementById('left-caption').textContent = cap[0];
    document.getElementById('right-caption').textContent = cap[1];
    document.getElementById('target-title').textContent = { A: 'Target — Mode A', B: 'Target — Mode B', C: 'Target — Mode C' }[m];
    if (!quiet && m !== 'A' && sc.groups.A.enabled && sc.groups.A.surfaces.length) {
      ui.store.notice('The Mode A reflector is still in the scene and can shadow Mode ' + m + ' optics — toggle it under “Scene contents”.');
    }
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
        const inp = c.type === 'check' ? P.el('input', { type: 'checkbox', 'data-control': id }) : P.el('input', { type: 'number', 'data-control': id, min: c.min, max: c.max, step: c.step });
        inp.addEventListener('change', () => ui.setControl(id, c.type === 'check' ? inp.checked : parseFloat(inp.value)));
        box.append(P.el('label', { 'data-wrap': id }, c.label.replace(' (cells)', '') + ' ', inp));
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
  ui.setStatus = function (t) { document.getElementById('progress-text').textContent = t; };

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
    if (ui.pendingA && !ui.interacting && now >= ui.pendingA && store.dirty.has('A')) {
      ui.pendingA = 0; ui.setStatus('Generating reflector…');
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
      if (key !== ui.surfKey && !ui.interacting) {
        ui.surfKey = key;
        const pts = [sc.source.pos]; for (const p of ui.model.polys) for (const q of p.pts) pts.push(q);
        const cs = document.getElementById('surface-canvas').getBoundingClientRect();
        ui.camS.w = cs.width; ui.camS.h = cs.height; ui.camS.fit(pts, 0.12);
      }
      const N = ui.previewRun ? Math.min(sc.sim.rays, PREVIEW_RAYS) : sc.sim.rays;
      Pc.recordHits = true;
      ui.run = { P: Pc, ctx: RF.Engine.newCtx(Pc, N, 240), preview: ui.previewRun, started: now };
      ui.lastHeat = 0; ui.sceneDirty = true;
    }
    const run = ui.run;
    let justDone = false;
    if (run && !run.ctx.done) { RF.Engine.step(run.ctx, document.hidden ? 200 : 12); justDone = run.ctx.done; }
    if (run && (justDone || now - ui.lastHeat > 90)) { drawHeat(); ui.lastHeat = now; ui.sceneDirty = true; }
    if (run) {
      const c = run.ctx, pct = c.N ? c.next / c.N : 1;
      document.getElementById('progress-bar').style.width = (pct * 100).toFixed(1) + '%';
      if (!ui.pendingA || !store.dirty.has('A')) ui.setStatus((c.done ? 'done · ' : 'tracing · ') + c.next.toLocaleString() + ' / ' + c.N.toLocaleString() + ' rays' + (run.preview ? ' (preview)' : '') + ' · ' + c.elapsed.toFixed(0) + ' ms');
      else ui.setStatus('design changed — regenerating when you pause…');
    }
    if (run && (justDone || now - ui.lastStats > 300)) { renderStats(!run.ctx.done); ui.lastStats = now; }
    if (ui.sceneDirty) { drawSceneView(); drawSurfaceView(); drawLeft(); ui.sceneDirty = false; }
    if ((run && !run.ctx.done) || (ui.pendingA && store.dirty.has('A'))) schedule();
  }
  function renderStats(running) {
    const run = ui.run; if (!run) return;
    const st = RF.Engine.stats(run.ctx), sc = ui.store.scene;
    let match = null;
    if (sc.mode === 'A' && run.ctx.next > 0) {
      // intent only exists at paint resolution: sum sim cells into paint cells first
      const gs = RF.Engine.gridTotal(run.ctx), rs = run.P.res, rp = sc.target.res, p = sc.modeA.paint, n = rp * rp;
      const g = new Float64Array(n);
      for (let j = 0; j < rs; j++) for (let i = 0; i < rs; i++) g[Math.min(rp - 1, Math.floor((j + 0.5) * rp / rs)) * rp + Math.min(rp - 1, Math.floor((i + 0.5) * rp / rs))] += gs[j * rs + i];
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
    ui.heatImg = R2.gridCanvas(vals, res, ui.heatImg);                        // also the 3D scene texture
    const sc = ui.store.scene, pres = sc.target.res;
    const overlay = sc.mode === 'B' ? R2.stampOverlay(sc, ui.store.reports.B, sc.modeB.selected) : null;
    // The panel's content frame is always the PAINT grid (so taps/stamps map the same at any sim res);
    // the sim image is stretched into it.
    R2.drawGridPanel(document.getElementById('heat-canvas'), ui.vHeat, ui.display === 'hits' ? hitsImage(pres) : ui.heatImg, pres, overlay);
    const T = ui.run.P.T, cellArea = (2 * T.half / res) ** 2 * 1e-6;       // m²
    const peak = ui.heatImg.maxValue / Math.max(1e-300, ui.run.ctx.next / ui.run.ctx.N);
    const cb = document.getElementById('colorbar');
    cb.innerHTML = '';
    const lux = peak / cellArea, luxTxt = lux >= 100 ? Math.round(lux).toLocaleString() : lux.toPrecision(3);
    cb.append(P.el('span', {}, '0'), P.el('i', { style: 'background:' + R2.colorbarCSS() }), P.el('span', {}, 'peak ≈ ' + luxTxt + ' lx (' + res + '² sim-cell average, raw grid)' + (ui.display === 'smooth' ? '; picture smoothed' : ui.display === 'hits' ? '; picture = ray hits' : '')));
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
  }
  function drawSceneView() {
    if (!ui.model) return;
    const sc = ui.store.scene;
    ui.handles = RF.Render.drawScene(document.getElementById('scene-canvas'), ui.cam, {
      scene: sc, model: ui.model, paths: ui.run ? ui.run.ctx.paths : null, heatCanvas: sceneHeatTexture(), showRays: ui.showRays,
      activeHandle: ui.activeHandle, preview: ui.preview && performance.now() < ui.preview.until ? ui.preview.pts : null, highlight: ui.highlight,
    });
    const hint = document.getElementById('scene-hint');
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

  // ---------------------------------------------------------------- boot
  function wireTopbar() {
    for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => ui.setMode(b.dataset.mode));
    const rays = document.getElementById('rays-input');
    rays.addEventListener('change', () => ui.setControl('rays', parseFloat(rays.value)));
    document.querySelector('[data-control="tgt.res"]').addEventListener('change', (e) => { ui.setControl('tgt.res', parseFloat(e.target.value)); ui.vLeft.fitted = ui.vHeat.fitted = false; });
    document.querySelector('[data-control-view="surfaceView"]').addEventListener('change', (e) => { ui.surfaceView = e.target.value; ui.sceneDirty = true; schedule(); });
    for (const b of document.querySelectorAll('#heat-display button')) b.addEventListener('click', () => {
      ui.display = b.dataset.disp;
      for (const o of document.querySelectorAll('#heat-display button')) o.classList.toggle('on', o === b);
      drawHeat(); ui.sceneDirty = true; schedule();
    });
    document.querySelector('[data-control="sim.res"]').addEventListener('change', (e) => ui.setControl('sim.res', parseFloat(e.target.value)));
    document.querySelector('[data-control="sim.autoRes"]').addEventListener('change', (e) => ui.setControl('sim.autoRes', e.target.checked));
    document.getElementById('show-rays').addEventListener('change', (e) => { ui.showRays = e.target.checked; ui.sceneDirty = true; schedule(); });
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
      ui.loadScene(s, 'Restored the snapshot from ' + new Date(RF.State.snapshotTime()).toLocaleString() + '.');
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
    const rb = P.confirmButton('Reset', 'Reset everything?', () => { RF.State.clearLocal(); ui.loadScene(RF.State.defaultScene(), 'Scene reset to defaults.'); });
    rb.id = 'btn-reset'; reset.replaceWith(rb);
    const sel = document.getElementById('preset-select');
    sel.addEventListener('change', () => {
      const name = sel.value; if (!name) return;
      const bar = document.getElementById('preset-confirm') || P.el('div', { id: 'preset-confirm', class: 'btnrow' });
      bar.innerHTML = '';
      const ok = P.el('button', { type: 'button', class: 'on' }, 'Replace scene with “' + sel.options[sel.selectedIndex].text + '”');
      const no = P.el('button', { type: 'button' }, 'Cancel');
      ok.addEventListener('click', () => { const p = P.presetScene(name); bar.remove(); sel.value = ''; if (p) ui.loadScene(p.scene, 'Preset: ' + p.notes.join('; ') + '.'); });
      no.addEventListener('click', () => { bar.remove(); sel.value = ''; });
      bar.append(ok, no);
      document.querySelector('.side-top').append(bar);
    });
    root.addEventListener('resize', () => { ui.sceneDirty = true; drawHeat(); schedule(); });
  }

  function boot() {
    let scene = null, restored = false;
    try { scene = RF.State.loadLocal(); restored = !!scene; } catch (e) { scene = null; }
    if (!scene) scene = RF.State.defaultScene();
    ui.store = C.createStore(scene);
    P.buildSide(ui);
    wireTopbar(); wireScene(); wireHeat(); wireLeft();
    ui.loadScene(scene, restored ? 'Restored your last scene from this browser (localStorage).' : null, true);
    if (!scene.groups.A.surfaces.length && scene.mode === 'A') { C.regenerateA(ui.store); }
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
