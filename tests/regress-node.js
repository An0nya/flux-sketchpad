// Regression checks for fixed QA groups (headless): node tests/regress-node.js — exits 1 on failure.
// G21 reads memory after a forced GC, so the file re-runs itself with --expose-gc when started without it
if (!global.gc) { const r = require('child_process').spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status); }
const { load } = require('./load.js'); const RF = load(); const C = RF.Controller;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };

// G21 runs first, before any store or trace exists: its arrayBuffers reading is process-wide
// G21: RF.Modes.geometry's cache must stay bounded over many distinct paintings (each entry is ~48 KB of typed arrays at res 100)
{ const R = 100, mb = () => { if (global.gc) global.gc(); return process.memoryUsage().arrayBuffers / 1048576; };
  const paint = (q) => { const p = new Array(R * R).fill(0); let s = q * 2654435761 + 1; for (let k = 0; k < p.length; k++) { s = (s * 1664525 + 1013904223) >>> 0; if (s / 4294967296 < 0.3) p[k] = 1; } return p; };
  for (let q = 0; q < 20; q++) RF.Modes.geometry(paint(q), R, 3);
  const a = mb(); for (let q = 20; q < 220; q++) RF.Modes.geometry(paint(q), R, 3); const b = mb();
  ok('G21 geometry cache stays flat over 200 more distinct paintings', b - a < 3, 'arrayBuffers ' + a.toFixed(1) + ' MB → ' + b.toFixed(1) + ' MB (unbounded would add ~9.6 MB)');
  const p0 = paint(1000), g1 = RF.Modes.geometry(p0, R, 3); ok('G21 the latest painting is still served from the cache', RF.Modes.geometry(p0, R, 3) === g1); }

(async () => {
  // F1: the per-device ray cap is one pure function; fake limits (not any real phone's), loaded the way the page loads the file
  {
    require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'gpu-trace.js'), 'utf8'), { filename: 'gpu-trace.js' });
    const cap = RF.GpuTrace.rayCap, MiB = 1048576;
    const phone = cap({ gpu: true, mobile: true, deviceMemory: 4, limits: { maxBufferSize: 256 * MiB, maxStorageBufferBindingSize: 128 * MiB } });
    const desk = cap({ gpu: true, mobile: false, deviceMemory: 8, limits: { maxBufferSize: 4096 * MiB, maxStorageBufferBindingSize: 2048 * MiB } });
    const none = cap({ gpu: false, mobile: false }), noneMobile = cap({ gpu: false, mobile: true }), low = cap({ gpu: true, mobile: true, deviceMemory: 2, limits: { maxBufferSize: 256 * MiB, maxStorageBufferBindingSize: 128 * MiB } });
    ok('F1 phone-like (touch, 4 GB, 128 MiB buffers): capped well under 500k, small batches', phone.cap === 150000 && phone.batch <= 262144, JSON.stringify(phone));
    ok('F1 desktop-like (8 GB, GiB buffers): no cap, 8 M batch', desk.cap === Infinity && desk.batch === 8e6, JSON.stringify(desk));
    ok('F1 no WebGPU, desktop: no cap (CPU path unchanged); touch device without WebGPU still capped', none.cap === Infinity && noneMobile.cap === 150000, JSON.stringify([none, noneMobile]));
    ok('F1 a signal can only lower the cap (2 GB phone < 4 GB phone); empty env is uncapped', low.cap === 100000 && cap().cap === Infinity && cap({}).batch === 8e6, JSON.stringify(low));
    ok('F1 batch stays within bounds for absurd limits', cap({ gpu: true, limits: { maxStorageBufferBindingSize: 1000 } }).batch === 65536);
    ok('F1 no localStorage in Node: pref() is off without WebGPU (CPU), userChoice() null', RF.GpuTrace.pref() === false && RF.GpuTrace.userChoice() === null);
    ok('F1 capRays passes a small request through and clamps nothing without a cap', RF.GpuTrace.capRays(500000) === 500000);
  }
  // G06: a solve whose scene changed while it ran must be dropped, and the design stays marked out of date
  {
    const st = C.createStore(RF.State.testScene()); C.regenerateA(st);
    const real = RF.Solvers.runAsync; let release; const sync = RF.Solvers.runSync(st.scene);
    RF.Solvers.runAsync = () => new Promise((res) => { release = () => res(sync); });
    try {
      const p1 = C.regenerateAAsync(st); st.dirty.add('A'); C.setControl(st, 'A.budget', 123); release();
      ok('G06 solve finished after an edit is dropped', (await p1) === null);
      ok('G06 design stays marked out of date after the dropped result', st.dirty.has('A'));
      st.dirty.add('A'); const p2 = C.regenerateAAsync(st); release();
      ok('G06 solve with no edit meanwhile is applied', (await p2) !== null && !st.dirty.has('A'));
    } finally { RF.Solvers.runAsync = real; }
  }
  // G09: hb4 -> measured (no rows yet) must give a coherent planar emitter, not the bulb's shape / volts / lumens
  {
    const st = C.createStore(RF.State.testScene()), src = st.scene.source;
    C.actions.applySourcePreset(st, 'hb4'); const bulbPower = src.power;
    C.actions.applySourcePreset(st, 'measured');
    ok('G09 planar source has a planar shape (got ' + src.shape + ')', ['rect', 'disc'].includes(src.shape));
    ok('G09 bulb voltage is dropped (volts ' + src.volts + ')', src.volts === undefined);
    ok('G09 bulb lumens are not inherited (power ' + src.power + ' vs bulb ' + bulbPower + ')', src.power !== bulbPower);
    ok('G09 filament emission mode is dropped (' + src.emission + ')', src.emission === undefined);
  }
  // G04 (state.js half): a scene that fails the schema must throw in deserialize (so loadLocal falls back to defaults and
  // an upload never reaches loadScene); a good scene, and the app's own scenes, must still round-trip untouched
  {
    const S = RF.State, throws = (v) => { try { S.deserialize(typeof v === 'string' ? v : JSON.stringify(v)); return false; } catch (e) { return true; } };
    const bads = [['mode Z', { mode: 'Z' }], ['stamps null', { modeB: { stamps: null } }], ['lenses obj', { lenses: {} }], ['envelope.half null', { envelope: { half: null } }],
      ['res string', { target: { res: 'abc' } }], ['source.pos short', { source: { pos: [1] } }], ['rays string', { sim: { rays: 'lots' } }], ['array', [1, 2]], ['null', 'null'], ['garbage', 'not json'], ['surfaces not a list', { groups: { A: { surfaces: {} } } }]];
    for (const [n, v] of bads) ok('G04 rejects ' + n, throws(v));
    ok('G04 target.res 0 is clamped to 10, not rejected', S.deserialize({ target: { res: 0 } }).target.res === 10);
    const j = S.deserialize({ groups: { A: { surfaces: [{ type: 'facet' }] } } });
    ok('G04 malformed surface is dropped', j.groups.A.surfaces.length === 0);
    for (const [n, mk] of [['defaultScene', S.defaultScene], ['testScene', S.testScene]]) {
      const sc = mk(), st = C.createStore(sc); C.regenerateA(st);
      const once = S.serialize(S.deserialize(S.serialize(sc)));   // idempotent, and nothing the scene had is dropped or clamped
      ok('G04 round-trips ' + n + ' (incl. solved surfaces)', S.serialize(S.deserialize(once)) === once && S.deserialize(once).groups.A.surfaces.length === sc.groups.A.surfaces.length && S.deserialize(once).sim.rays === sc.sim.rays);
    }
    for (const id of Object.keys(RF.SourcePresets.PRESETS)) { const sc = S.testScene(); RF.SourcePresets.apply(sc.source, id, id === 'measured' ? undefined : undefined); try { S.deserialize(S.serialize(sc)); } catch (e) { ok('G04 round-trips preset ' + id + ' (' + e.message + ')', false); } }
  }
  // G05: every number control has finite bounds and the action layer clamps to them; no input can freeze or NaN the scene
  {
    const fresh = () => { const st = C.createStore(RF.State.defaultScene()); C.regenerateA(st); return st; };
    const unbounded = C.CONTROLS.filter((c) => c.type === 'number' && !(isFinite(c.min) && isFinite(c.max))).map((c) => c.id);
    ok('G05 every number control has a finite min and max (unbounded: ' + unbounded.join(' ') + ')', unbounded.length === 0);
    let bad = [];
    for (const c of C.CONTROLS.filter((c) => c.type === 'number')) {
      for (const v of [1e300, -1e300, 1e10]) { const st = fresh(); try { C.setControl(st, c.id, v); const g = c.get(st); if (!(isFinite(g) && g >= c.min - 1e-9 && g <= c.max + 1e-9)) bad.push(c.id + '=' + v + '->' + g); } catch (e) { bad.push(c.id + ' threw ' + e.message); } }
      const st = fresh(), before = c.get(st); for (const v of [NaN, Infinity, 'x', undefined]) { try { C.setControl(st, c.id, v); } catch (e) { /* a throw is also a rejection */ } } if (!Object.is(c.get(st), before)) bad.push(c.id + ' changed by a non-number: ' + before + ' -> ' + c.get(st));
    }
    ok('G05 typed extremes stay inside each control\'s range; NaN / Infinity / text are rejected (' + bad.slice(0, 4).join('; ') + (bad.length > 4 ? ' …' + bad.length : '') + ')', bad.length === 0);
    { const st = C.createStore(RF.State.testScene()), t = st.scene.target, en = st.scene.envelope;   // testScene: the envelope reaches x = +20
      C.actions.setTargetDistance(st, 1e-6); ok('G05 target cannot be dragged into the optic (distance ' + t.distance + ', envelope front ' + (en.center[0] + en.half[0]) + ')', t.distance > en.center[0] + en.half[0]);
      C.actions.setTargetDistance(st, 1e12); ok('G05 target distance has a ceiling (' + t.distance + ')', t.distance <= 1e6);
      C.actions.setTargetDistance(st, NaN); ok('G05 target distance ignores NaN', isFinite(t.distance)); }
    { const st = fresh(); const s1 = C.actions.addStamp(st, 0, 0) || st.scene.modeB.stamps[0]; const id = st.scene.modeB.stamps[0].id, half = RF.Engine.designFrame(st.scene.target).half;
      C.actions.moveStamp(st, id, 1e6, -1e6); const m = st.scene.modeB.stamps[0]; ok('G05 a stamp cannot be moved off the target (u ' + m.u + ', v ' + m.v + ', half ' + half + ')', Math.abs(m.u) <= half && Math.abs(m.v) <= half);
      C.actions.moveStamp(st, id, NaN, 5); ok('G05 a stamp ignores a NaN move', isFinite(m.u) && isFinite(m.v)); }
    { const st = fresh(); st.scene.source.kind = 'planar'; C.setControl(st, 'src.domeR', 3); C.setControl(st, 'src.domeZ', 2.85); C.setControl(st, 'src.domeR', 0.5); const d = st.scene.source.dome;
      ok('G05 shrinking the dome keeps its centre in range (r ' + d.r + ', z ' + d.z + ')', Math.abs(d.z) <= 0.95 * d.r + 1e-12); }
    // lenses: out-of-range or non-finite values are clamped / ignored, and no lens kind builds NaN geometry at the clamp limits
    { const nonFinite = (o) => { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') return Object.values(o).some(nonFinite); return false; };
      const keys = { planoconvex: ['f', 'a', 'edge'], biconvex: ['f', 'a', 'edge'], asphere: ['f', 'a', 'edge'], tir: ['A', 'rc', 'hc', 'thMax'], fresnel: ['f', 'a', 'rings', 'tb'] }, probs = [];
      for (const kind of Object.keys(keys)) for (const k of keys[kind].concat(['ior', 'fresnelT', 'd'])) for (const v of [0, -10, 1e6, NaN, Infinity]) {
        const st = fresh(), L = C.actions.addLens(st, kind); if (k === 'd') C.actions.updateLens(st, L.id, 'auto', false); const t0 = Date.now();
        C.actions.updateLens(st, L.id, k, v); try { st.commit(); } catch (e) { probs.push(kind + '.' + k + '=' + v + ' threw ' + e.message); continue; }
        if (!isFinite(L.params[k]) || nonFinite(st.scene.groups.L.surfaces)) probs.push(kind + '.' + k + '=' + v + ' -> ' + L.params[k] + (nonFinite(st.scene.groups.L.surfaces) ? ' NaN surfaces' : ''));
        if (Date.now() - t0 > 3000) probs.push(kind + '.' + k + '=' + v + ' slow');
      }
      ok('G05 lens fields at 0 / -10 / 1e6 / NaN / Infinity: stored finite, no NaN surfaces, no stall (' + probs.slice(0, 4).join('; ') + (probs.length > 4 ? ' …' + probs.length : '') + ')', probs.length === 0); }
    // boxBlur: a kernel far wider than the grid must cost O(R^2), and equal the plain loop for ordinary widths
    {
      const R = 60, g = new Float64Array(R * R).map((_, k) => (k * 7919) % 13), ref = (src, w) => { const h = w / 2, pass = (a, ax) => { const o = new Float64Array(R * R); for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const c0 = ax ? i : j, a0 = c0 + 0.5 - h, b0 = c0 + 0.5 + h; let q0 = 0; for (let q = Math.floor(a0); q < Math.ceil(b0); q++) { if (q < 0 || q >= R) continue; q0 += (Math.min(b0, q + 1) - Math.max(a0, q)) * (ax ? a[j * R + q] : a[q * R + i]); } o[j * R + i] = q0 / w; } return o; }; return pass(pass(src, true), false); };
      const a = RF.Photometry.boxBlur(g, R, 3.5), b = ref(g, 3.5); let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k]));
      ok('G05 boxBlur unchanged for an ordinary width (max diff ' + d + ')', d < 1e-12);
      const t0 = Date.now(); RF.Photometry.boxBlur(new Float64Array(200 * 200).fill(1), 200, 1e7); const ms = Date.now() - t0;
      ok('G05 boxBlur with a kernel 1e7 cells wide on a 200x200 grid is instant (' + ms + ' ms)', ms < 500);
    }
  }
  // G07 / G08: derived and lazily created fields are not intent; undo keeps the solved reflector until the re-solve replaces it
  {
    const H = RF.History, st = C.createStore(RF.State.defaultScene()); C.regenerateA(st);
    const h = H.create(100); h.reset(H.intent(st.scene)); delete st.scene.solve;   // the state right after a load: no solve key yet
    h.reset(H.intent(st.scene));
    C.regenerateA(st); st.scene.solve.id = 'auto';   // headless has no worker solver: stand in for Auto's meta, as the page writes it
    ok('G07 the first solve after load is not an edit (solve ' + JSON.stringify(st.scene.solve && st.scene.solve.id) + ')', !h.checkpoint(H.intent(st.scene), 1e4));
    st.scene.modeD.road = RF.Road.defaults(); ok('G07 a lazily created default road is not an edit', !h.checkpoint(H.intent(st.scene), 2e4));
    st.scene.modeD.road.spacing = 2; ok('G07 a real road edit still is', !!h.checkpoint(H.intent(st.scene), 3e4));
    st.scene.solverSettings = {}; ok('G07 an empty solverSettings is not an edit', !h.checkpoint(H.intent(st.scene), 4e4));
    // the undo loop: restore a snapshot with no solve key, re-solve (writes solve), checkpoint again, repeatedly
    h.reset(H.intent(st.scene)); delete st.scene.solve; h.reset(H.intent(st.scene));   // a scene that has not been solved yet
    for (let i = 0; i < 4; i++) { C.setControl(st, 'A.budget', 50 + i * 10); h.checkpoint(H.intent(st.scene), 5e4 + i * 1e4); }
    const n0 = h.past.length; let loops = 0;
    for (let i = 0; i < 4; i++) {
      const e = h.undo(H.intent(st.scene)); H.apply(st.scene, e.it);
      st.invalidate(['A', 'B', 'C', 'L']); st.commit({ forceA: true }); C.regenerateA(st); st.scene.solve.id = 'auto';
      if (h.checkpoint(H.intent(st.scene), 2e5 + i * 1e4)) loops++;
    }
    ok('G07 four Undos walk back four edits and push nothing (past ' + n0 + ' -> ' + h.past.length + ', pushed ' + loops + ')', loops === 0 && h.past.length === n0 - 4);
    const picked = H.intent(Object.assign(JSON.parse(JSON.stringify(st.scene)), { solve: { id: 'fill' } }));
    ok('G07 choosing a different solver is still an edit', H.key(picked) !== H.key(H.intent(st.scene)));
    // G08: apply() must not blank the solved reflector (group A) while a worker solve is pending
    const st2 = C.createStore(RF.State.defaultScene()); C.regenerateA(st2); const n = st2.scene.groups.A.surfaces.length;
    H.apply(st2.scene, H.intent(st2.scene));
    ok('G08 undo keeps the current reflector until the re-solve lands (' + st2.scene.groups.A.surfaces.length + ' of ' + n + ' surfaces)', n > 0 && st2.scene.groups.A.surfaces.length === n);
    ok('G08 the derived groups that rebuild synchronously are still reset', st2.scene.groups.B.surfaces.length === 0);
  }
  // G17: Measure at "target" is a link (modeD.distance = -1), resolved against the live target distance; numbers are untouched
  {
    const sc = RF.State.testScene(); sc.mode = 'D'; sc.modeD = Object.assign({}, RF.Spec.defaults ? RF.Spec.defaults() : {}, sc.modeD);
    sc.modeD.distance = -1; sc.target.distance = 7000;
    ok('G17 gridOpts at "target" reads the live target distance', RF.Spec.gridOpts(sc).distance === 7000, 'got ' + RF.Spec.gridOpts(sc).distance);
    sc.target.distance = 5000;
    ok('G17 gridOpts follows the target when it moves', RF.Spec.gridOpts(sc).distance === 5000 && RF.Spec.solverSpec(sc).measure.distance === 5000, 'got ' + RF.Spec.gridOpts(sc).distance + ' / ' + RF.Spec.solverSpec(sc).measure.distance);
    sc.modeD.distance = 18300; ok('G17 a numeric distance (FMVSS 18.3 m) is unchanged', RF.Spec.gridOpts(sc).distance === 18300);
    sc.modeD.distance = 0; ok('G17 distance 0 is still the far field', RF.Spec.gridOpts(sc).distance === Infinity);
  }
  // G18: the cut-off position (ev.aim.cutV) is found whatever the Aim mode, so the Road's "Manual inclination" can use it
  {
  function fakeG(fn, win, step) {
    const h0 = win[0], v0 = win[2], nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step), n = nh * nv, E = new Float64Array(n), E2 = new Float64Array(n), Om = new Float64Array(n), eRay = 1e-6;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const m = j * nh + i, om = RF.FarField.binOmega(h0 + i * step, h0 + (i + 1) * step, v0 + j * step, v0 + (j + 1) * step, 'A'); Om[m] = om; E[m] = fn(h0 + (i + 0.5) * step, v0 + (j + 0.5) * step) * om; E2[m] = E[m] * eRay; }
    // build() is the only producer of sat; reuse its helper by building a G-shaped object the same way
    const sat = (a) => { const W = nh + 1, S = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } } return S; };
    return { E, E2, Om, nh, nv, h0, v0, step, h1: h0 + nh * step, v1: v0 + nv * step, conv: 'A', distance: Infinity, eRay, rays: 1e9, sat: { E: sat(E), E2: sat(E2), Om: sat(Om) } };
  }
    const lamp = fakeG((h, v) => (v < 0.3 ? 10000 : 100), [-12, 12, -6, 6], 0.05), noCut = fakeG(() => 0, [-12, 12, -6, 6], 0.05);
    const md0 = { traffic: 'RHT', conv: 'A', kernel: 0.1, aimLine: -0.57, aimBox: null, items: [{ id: 'g', kind: 'gradient', name: 'G', h: -2.5, v0: -1.5, v1: 0.5, scan: 0.05, dv: 0.1, min: 0.13, max: 0.40, on: true }] };
    for (const mode of ['cutoff', 'design', 'peak', 'manual']) {
      const ev = RF.Spec.evaluate(lamp, Object.assign({}, md0, { aimMode: mode, aimManual: { h: 0, v: 0.2 } }));
      ok('G18 aim=' + mode + ': cut-off position found at 0.3 deg', isFinite(ev.aim.cutV) && Math.abs(ev.aim.cutV - 0.3) <= 0.05, 'cutV ' + ev.aim.cutV);
    }
    const evd = RF.Spec.evaluate(lamp, Object.assign({}, md0, { aimMode: 'design' })), evc = RF.Spec.evaluate(lamp, Object.assign({}, md0, { aimMode: 'cutoff' }));
    ok('G18 finding the cut-off does not move a design-aimed judgement', evd.shift[0] === 0 && evd.shift[1] === 0, JSON.stringify(evd.shift));
    ok('G18 a beam with no light reports no cut-off (design aim)', RF.Spec.evaluate(noCut, Object.assign({}, md0, { aimMode: 'design' })).aim.cutV === undefined);
    const sh = RF.Road.aimShift({ aim: 'manual', aimPct: -1 }, evd);
    ok('G18 Road manual -1 % puts the found cut-off at 0.573 deg D under design aim', Math.abs((evd.aim.cutV - sh[1]) + RF.Road.PCT) < 1e-9, 'cut-off on the road at ' + (evd.aim.cutV - sh[1]).toFixed(4));
  }
  // D-S13: the IIHS 5 lx markers say they are IIHS points (source check: the canvas text is only drawn in the browser)
  { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'spec-ui.js'), 'utf8');
    ok('D-S13 no marker is labelled as a road "edge"', !/'[RL] edge 5 lx: '/.test(src));
    ok('D-S13 markers are labelled IIHS points, legend names the 6.6 m IIHS road', /'IIHS R point: 5 lx to '/.test(src) && /'IIHS L point: 5 lx to '/.test(src) && /not the drawn road edges/.test(src)); }
  // G10 / owner decision: Clear on the Mode A reflector empties it AND stops auto-solve for it, undoably (the flag is intent), until a solve (Rebuild)
  {
    const st = C.createStore(RF.State.testScene()); C.regenerateA(st);
    const n0 = st.scene.groups.A.surfaces.length, h = RF.History;
    const before = h.intent(st.scene);
    ok('G10 setup: the test scene has a solved reflector', n0 > 0, n0 + ' surfaces');
    C.actions.clearGroup(st, 'A');
    ok('G10 clear empties the reflector', st.scene.groups.A.surfaces.length === 0);
    ok('G10 clear is a history-visible change (one entry)', h.key(h.intent(st.scene)) !== h.key(before));
    st.invalidate(['A']); st.commit({ deferA: false });                                    // e.g. a source nudge with auto-solve on
    ok('G10 a later edit does not bring the reflector back', st.scene.groups.A.surfaces.length === 0 && !st.dirty.has('A'));
    ok('G10 auto-solve reads as off while cleared', st.autoA === false);
    const intentCleared = h.intent(st.scene);
    const sc2 = JSON.parse(JSON.stringify(st.scene)); h.apply(sc2, before);
    ok('G10 undo (restoring the old intent) lifts the cleared state', !sc2.modeA.cleared);
    C.regenerateA(st);
    ok('G10 a solve (Rebuild) puts the reflector back and auto-solve returns', st.scene.groups.A.surfaces.length > 0 && st.autoA === true && !st.scene.modeA.cleared);
    h.apply(st.scene, intentCleared); st.invalidate(['A']); st.commit({ forceA: true });
    ok('G10 redo (cleared intent) leaves the reflector cleared', st.scene.groups.A.surfaces.length === 0 && !st.dirty.has('A'));
  }
  // G40: the row handed to the goal metrics carries capturable, so the hot zone's "of the most this light could give it" is a number, not NaN
  {
    const st = C.createStore(RF.State.testScene()), input = RF.Solvers.inputOf(st.scene), M = RF.Modes, R = input.paint.res;
    const ctx = M.context(input, 1e5), grid = new Float64Array(R * R).fill(1), tr = { grid, res: R, energy: { emitted: 1e5 }, fidelity: { fidelity: 0.5, onPaint: 0.5, spill: 0.1 }, peakCd: 1 };
    const run = M.runFromTrace(input, tr, ctx), m = M.hotspot(run);
    ok('G40 the metrics row has a capturable share (' + run.row.capturable + ')', run.row.capturable > 0 && run.row.capturable <= 1);
    ok('G40 hotspot ofPossible is a finite number (got ' + m.ofPossible + ')', isFinite(m.ofPossible) && m.ofPossible >= 0);
  }
  // D-E08: a source outside the envelope is allowed (a valid design) but the limits panel warns while it is outside
  {
    const sc = RF.State.testScene(), F = RF.Feasibility, env = sc.envelope;
    ok('D-E08 no warning while the source is inside the envelope', !F.analyze(sc).items.some((i) => i.key === 'srcOutside'));
    sc.source.pos = [env.center[0] + env.half[0] + 10, env.center[1], env.center[2]];
    const a = F.analyze(sc), it = a.items.find((i) => i.key === 'srcOutside');
    ok('D-E08 a source outside the envelope gets a warning item', !!it && it.warn === true && /outside/i.test(it.text), it && it.text);
    ok('D-E08 the warning never becomes the binding physical limit', F.analyze(sc).binding !== 'srcOutside');
    ok('D-E08 the source position is not clamped', sc.source.pos[0] === env.center[0] + env.half[0] + 10);
  }
  // D-C14: switching LED presets opens the new LED at its own default drive current and flux model, not the previous emitter's
  {
    const SP = RF.SourcePresets, ids = Object.keys(SP.PRESETS).filter((k) => SP.PRESETS[k].drive && !SP.PRESETS[k].custom);
    let bad = [], n = 0;
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const pb = SP.PRESETS[b], mb = pb.drive.models[pb.drive.model];
      const ref = {}; SP.apply(ref, b); const src = {}; SP.apply(src, a, { amps: SP.PRESETS[a].drive.models[SP.PRESETS[a].drive.model].maxA }); const keepA = src.driveA; SP.apply(src, b); n++;
      if (src.driveA !== ref.driveA || src.fluxModel !== ref.fluxModel || src.power !== ref.power) bad.push(a + '→' + b + ' amps ' + src.driveA + ' vs ' + ref.driveA + ', model ' + src.fluxModel + ' vs ' + ref.fluxModel);
    }
    ok('D-C14 every LED preset opens the same from any previous LED as from a fresh source (' + n + ' pairs)', bad.length === 0, bad.slice(0, 3).join(' | '));
    const a0 = ids[0], s2 = {}; SP.apply(s2, a0); SP.apply(s2, a0, { amps: 0.5 }); SP.apply(s2, a0);
    ok('D-C14 re-applying the SAME preset (model/current edits) still keeps the chosen current', s2.driveA === 0.5, 'driveA ' + s2.driveA);
  }
  // D-E17: brush mode. raise (default, today's Math.max) / set (exactly the level) / lower (Math.min, only darkens); stored with the brush, validated like other enums
  {
    const SS = RF.State, st = C.createStore(SS.testScene()), sc = st.scene, p = sc.modeA.paint, res = sc.target.res;
    const paintOnce = (level, mode, erase) => { sc.modeA.brush.strength = level; if (mode !== undefined) C.setControl(st, 'A.brushMode', mode); return C.actions.paintAt(st, 0, 0, erase); };
    const cell = () => { let mx = 0, mn = 2; for (let k = 0; k < p.length; k++) if (p[k] > 0) { mx = Math.max(mx, p[k]); mn = Math.min(mn, p[k]); } return [mn, mx]; };
    ok('D-E17 default brush mode is raise', sc.modeA.brush.mode === 'raise' && SS.defaultScene().modeA.brush.mode === 'raise', String(sc.modeA.brush.mode));
    C.actions.clearPaint(st); paintOnce(0.8); paintOnce(0.3);
    ok('D-E17 raise: a lower level does not darken (max of 0.8, 0.3 = 0.8)', cell()[1] === 0.8 && cell()[0] === 0.8, JSON.stringify(cell()));
    paintOnce(0.3, 'set');
    ok('D-E17 set: the cell becomes exactly the level (0.3)', cell()[1] === 0.3 && cell()[0] === 0.3, JSON.stringify(cell()));
    paintOnce(0.9, 'set');
    ok('D-E17 set: can also brighten (0.9)', cell()[1] === 0.9 && cell()[0] === 0.9, JSON.stringify(cell()));
    paintOnce(0.5, 'lower');
    ok('D-E17 lower: only darkens (min of 0.9, 0.5 = 0.5)', cell()[1] === 0.5 && cell()[0] === 0.5, JSON.stringify(cell()));
    paintOnce(0.8, 'lower');
    ok('D-E17 lower: a higher level does not brighten, and it does not paint empty cells', cell()[1] === 0.5, JSON.stringify(cell()));
    C.actions.clearPaint(st); paintOnce(0.7, 'lower');
    ok('D-E17 lower on an empty grid paints nothing', p.filter((x) => x > 0).length === 0);
    paintOnce(0.7, 'set'); ok('D-E17 erase still zeroes in every mode', (paintOnce(0.7, 'lower', true), cell()[1] === 0) , JSON.stringify(cell()));
    ok('D-E17 an unknown mode is refused by the control', (() => { try { C.setControl(st, 'A.brushMode', 'blend'); } catch (e) { /* ok either way */ } return sc.modeA.brush.mode === 'lower'; })(), sc.modeA.brush.mode);
    const round = SS.deserialize(SS.serialize(sc)); ok('D-E17 the mode survives save / load', round.modeA.brush.mode === 'lower', round.modeA.brush.mode);
    const old = JSON.parse(SS.serialize(sc)); delete old.modeA.brush.mode; ok('D-E17 an older file without the field loads as raise', SS.deserialize(old).modeA.brush.mode === 'raise');
    const badScene = JSON.parse(SS.serialize(sc)); badScene.modeA.brush.mode = 'blend'; let threw = false; try { SS.deserialize(badScene); } catch (e) { threw = /brush\.mode/.test(e.message); }
    ok('D-E17 a scene with an unknown brush mode is rejected by the schema check', threw);
  }
  // G38: an unreadable autosave is kept aside under "<key>.bad" (and reported), not silently overwritten
  {
    const SS = RF.State, KEY = 'faceted-reflector-demo/scene/v1', store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    try {
      store[KEY] = '{garbage';
      const r = SS.loadLocal();
      ok('G38 an unparseable autosave still loads as "nothing" (caller starts from defaults)', r === null);
      ok('G38 the bad text is kept under the .bad key', store[KEY + '.bad'] === '{garbage', String(store[KEY + '.bad']));
      ok('G38 the failure is reported to the caller', !!(SS.loadError && SS.loadError() && /garbage|JSON|position/i.test(SS.loadError().message) && SS.loadError().kept === true), JSON.stringify(SS.loadError && SS.loadError()));
      SS.saveLocal(SS.defaultScene());
      ok('G38 a later autosave does not touch the .bad copy', store[KEY + '.bad'] === '{garbage');
      ok('G38 a good autosave loads and clears the report', SS.loadLocal() !== null && !(SS.loadError && SS.loadError()));
      delete store[KEY]; delete store[KEY + '.bad'];
      ok('G38 nothing saved is not an error', SS.loadLocal() === null && !(SS.loadError && SS.loadError()) && !((KEY + '.bad') in store));
      store[KEY] = JSON.stringify({ mode: 'Z' });
      ok('G38 a schema failure is kept aside too', SS.loadLocal() === null && store[KEY + '.bad'] === store[KEY] && /mode/.test(String(SS.loadError && SS.loadError() && SS.loadError().message)));
    } finally { delete globalThis.localStorage; }
  }
  // B12: one source for the road-side numbers. The 5 lx reach / IIHS points / beam quality / goals must not move with "Measure at", and the UI's
  // Spec update, tools.trace's res.road and the preview worker's grids must agree for the same trace (same rays -> same numbers, so EXACT equality)
  {
    const fs = require('fs'), vm = require('vm'), path = require('path');
    RF.Panels = RF.Panels || { el: () => ({}) }; RF.Render = RF.Render || {};
    if (!RF.SpecUI) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'spec-ui.js'), 'utf8'), { filename: 'spec-ui.js' });
    const sc0 = RF.State.defaultScene(); sc0.mode = 'D'; sc0.target.distance = 10000; sc0.target.size = RF.Spec.fitTargetSize(sc0); sc0.modeA.paint = RF.Spec.seedPaint(sc0);
    const inp = RF.Solvers.inputOf(sc0), ss = RF.Spec.solveScene(sc0);
    const surf = RF.ModeA.generate(RF.U.deepCopy(Object.assign({}, ss, { mode: 'A', modeA: Object.assign({}, ss.modeA, { paint: inp.paint.cells }) }))).surfaces;
    const mk = (d) => { const p = Object.assign(RF.U.deepCopy({ source: sc0.source, envelope: sc0.envelope, sim: sc0.sim, modeD: sc0.modeD, mode: 'D' }), { target: Object.assign({}, inp.target, { distance: 15000 }), modeA: { paint: inp.paint.cells } }); p.modeD.distance = d; return p; };
    const RAYS = 150000, J = JSON.stringify, rows = {};
    for (const [label, d] of [['inf', 0], ['25m', 25000], ['10m', 10000], ['target', -1]]) {
      const scn = mk(d);
      // (a) the UI: the run's streams as the page sets them, then SpecUI.update + roadModel
      const sca = Object.assign({}, scn, { sim: Object.assign({}, scn.sim) }), P = RF.Engine.prepare(sca, surf); P.ffStreams = RF.SpecUI.streams(scn);
      const c = RF.Engine.runSync(P, RAYS, 0), ui = { run: { ctx: c }, store: { scene: mk(d) }, spec: null, requestRun() {} };
      const s = RF.SpecUI.update(ui, true), rd = RF.SpecUI.roadModel(ui);
      // (b) a solver's tools.trace
      const t = RF.Solvers.trace(mk(d), surf, { rays: RAYS, spec: true, guided: false, road: true, quality: true, ideal: true });
      // (c) the preview worker: the same two grids ui.js sends (fine, wide), traced the way js/preview-worker.js does
      const ff = RF.SpecUI.previewFF(scn), Pw = RF.Engine.prepare(sca, surf); Pw.ffStreams = [ff.fine, ff.wide];
      const cw = RF.Engine.runSync(Pw, RAYS, 0), Gp = RF.FarField.build(cw, ff.fine), Gpw = RF.FarField.build(cw, ff.wide);
      rows[label] = { lab: s.ev.shift, road: t.road, ui: { iihs: rd.iihs, quality: rd.quality, ideal: rd.ideal }, same: { fine: J(Array.from(Gp.E)) === J(Array.from(s.G.E)), wide: J(Array.from(Gpw.E)) === J(Array.from(s.Gw.E)) } };
    }
    const L = Object.keys(rows), ref = rows.inf;
    ok('B12 test is not vacuous: the report\'s own judge aims differently at different Measure at', new Set(L.map((k) => J(rows[k].lab))).size > 1, L.map((k) => k + ' ' + J(rows[k].lab)).join(' | '));
    for (const k of L) {
      const r = rows[k];
      ok('B12 [' + k + '] tools.trace res.road equals the UI road model (5 lx reach, IIHS, quality, goals)', J([r.road.right, r.road.left, r.road.farRight, r.road.farLeft, r.road.glareMax]) === J([r.ui.iihs.right, r.ui.iihs.left, r.ui.iihs.farRight, r.ui.iihs.farLeft, r.ui.iihs.glareMax]) && J(r.road.quality) === J(r.ui.quality) && J(r.road.ideal) === J(r.ui.ideal),
        J({ trace: [r.road.right, r.road.left], ui: [r.ui.iihs.right, r.ui.iihs.left] }));
      ok('B12 [' + k + '] the road-side numbers equal those at Measure at = infinity', J(r.ui.iihs) === J(ref.ui.iihs) && J(r.ui.quality) === J(ref.ui.quality) && J(r.ui.ideal) === J(ref.ui.ideal) && J(r.road) === J(ref.road), J({ reach: [r.ui.iihs.right, r.ui.iihs.left], ref: [ref.ui.iihs.right, ref.ui.iihs.left] }));
      ok('B12 [' + k + '] the preview worker\'s grids are the report\'s grids (fine and wide)', r.same.fine && r.same.wide);
    }
  }
  // F2: the animated Drive view (js/drive-anim.js) — its CPU side, without a GPU. The still view must not change; the layered picture must equal the whole one.
  {
    const DA = RF.DriveAnim, D = RF.Drive, lut = D.lutFrom((h, v) => 30000 * Math.exp(-((h / 12) ** 2 + ((v + 1.5) / 3) ** 2)));
    const base = { w: 160, h: 90, hfov: 60, eye: DA.EYE, lamps: [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut, conv: 'A', lane: 3.5, look: { RL: 0.2 } };
    const flags = { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true };
    const src = DA.source('road', 3.5, false, flags), luma = (a, q) => 0.2126 * a[3 * q] + 0.7152 * a[3 * q + 1] + 0.0722 * a[3 * q + 2];
    // F2a: Drive.render without `layer` is what it always was: no cov/rows/rgba in the result, depth and mat present
    const still = D.render(Object.assign({ scene: { objects: src.objects, markings: src.markings, verge: src.verge } }, base));
    ok('F2a the whole-picture render is unchanged in shape (depth, mat, no layer fields)', !!still.depth && !!still.mat && still.cov === undefined && still.rows === undefined && still.rgba === undefined);
    // F2b: scenery repeats every PERIOD m and stays in [dist − 6, dist − 6 + PERIOD) ahead; one copy of every object
    { let bad = 0, n = 0; for (const dist of [0, 37.3, 299.9, 300, 1234.5]) { const o = DA.place(src, dist, null); n += o.length; if (o.length !== src.objects.length) bad++; for (const ob of o) if (ob.x < -6 - 1e-9 || ob.x >= DA.PERIOD - 6 + 1e-9) bad++; }
      ok('F2b place(): every object once, ahead of the car within one period, at 5 distances', bad === 0, n + ' objects placed'); }
    // F2c: the same object at dist and dist + PERIOD is at the same spot (the scenery repeats exactly)
    { const a = DA.place(src, 12.5, null), b = DA.place(src, 12.5 + DA.PERIOD, null); let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y)); ok('F2c place(dist) = place(dist + PERIOD)', worst < 1e-9, 'worst ' + worst); }
    // F2d: layered = whole. Ground + (objects layer) composed as the shader does, against the whole picture of the displaced world; outside the objects' tiles it matches to float rounding
    const srcUS = DA.source('road', 3.5, true, flags);      // US markings: nothing patterned, so the ground has no moving part at all
    ok('F2d the US road has no patterned marking (ground = one layer), the EU road has the dashes', !srcUS.markings.some((m) => m.pat) && src.markings.some((m) => m.pat) && DA.ground(Object.assign({ A: null, src: srcUS }, base)).B === null);
    for (const [S, tag, name, A, dist] of [[src, 'EU', 'straight', null, 0], [src, 'EU', 'straight', null, 37.3], [src, 'EU', '250R bend', RF.Road.arc(250, 'right'), 37.3], [src, 'EU', '150L bend', RF.Road.arc(150, 'left'), 111.7], [srcUS, 'US', 'straight', null, 37.3], [srcUS, 'US', '250R bend', RF.Road.arc(250, 'right'), 111.7]]) {
      const src = S, p = Object.assign({ A, src }, base), g = DA.ground(p), rgba = new Float32Array(4 * 160 * 90); DA.objects(p, dist, rgba, 2);
      const comp = DA.composeCPU(p, g, rgba, dist), shift = (m) => m.pat ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { s0: m.pat.s0 - dist, s1: m.pat.s1 - dist }) }) : m;
      const scene = { objects: DA.place(src, dist, A), markings: src.markings.map(shift), verge: src.verge }, cam = Object.assign({ arc: A, scene }, base);
      const ref2 = D.render(cam), ref1 = D.render(Object.assign({}, cam, { ss: 1 }));
      let gMax = 0, fRel = [], eRel = [], nG = 0;
      for (let q = 0; q < 160 * 90; q++) {
        const c = rgba[4 * q + 3], rel = Math.abs(luma(comp, q) - luma(ref2.rgb, q)) / Math.max(luma(ref2.rgb, q), 0.02);
        if (c >= 0.999) { fRel.push(rel); continue; } if (c > 0) { eRel.push(rel); continue; }
        if (ref2.rgb[3 * q] === ref1.rgb[3 * q] && ref2.rgb[3 * q + 1] === ref1.rgb[3 * q + 1] && ref2.rgb[3 * q + 2] === ref1.rgb[3 * q + 2]) { nG++; gMax = Math.max(gMax, Math.abs(luma(comp, q) - luma(ref2.rgb, q))); }
      }
      const q50 = (a) => a.sort((x, y) => x - y)[a.length >> 1] || 0, qMax = (a) => a.length ? Math.max(...a) : 0;
      ok('F2d layered = whole, ' + tag + ' ' + name + ' at ' + dist + ' m: ground outside the object tiles', nG > 5000 && gMax < 1e-3, nG + ' px, worst abs ' + gMax.toExponential(1) + ' cd/m²');
      ok('F2d layered = whole, ' + tag + ' ' + name + ' at ' + dist + ' m: pixels an object covers fully', fRel.length > 5 && qMax(fRel) < 1e-4, fRel.length + ' px, worst relative ' + qMax(fRel).toExponential(1));
      ok('F2d layered = whole, ' + tag + ' ' + name + ' at ' + dist + ' m: edge pixels (the ground behind them is 1 sample here, 2×2 there)', eRel.length > 5 && q50(eRel) < 0.05, eRel.length + ' px, median relative ' + (100 * q50(eRel)).toFixed(2) + ' %');
    }
    // F2e: a class switched off takes only that class away; the rest of the scene is exactly where it was (the random stream is not touched)
    { const all = D.buildScene('road', { Lw: 3.5, A: null, us: false, seed: 7 }, {}).objects, key = (ob) => JSON.stringify([ob.k, ob.x, ob.y, ob.z, ob.z0, ob.z1]);
      for (const [flag, cls] of [['posts', 'post'], ['veg', 'veg']]) {
        const off = D.buildScene('road', { Lw: 3.5, A: null, us: false, seed: 7 }, { [flag]: false }).objects, want = all.filter((ob) => ob.cls !== cls).map(key), got = off.map(key);
        ok('F2e ' + flag + ' off removes exactly the ' + cls + ' objects (' + (all.length - off.length) + ' of ' + all.length + '), the rest unchanged', all.some((ob) => ob.cls === cls) && JSON.stringify(want) === JSON.stringify(got)); }
      const withCrates = D.buildScene('road', { Lw: 3.5, A: null, us: false, seed: 7 }, { obstacle: true }).objects;
      ok('F2e crates are added after the scene (the old objects keep their order and place), default is none', withCrates.length > all.length && JSON.stringify(withCrates.slice(0, all.length).map(key)) === JSON.stringify(all.map(key)) && !all.some((ob) => ob.cls === 'obstacle')); }
    // F2f: the object layer's `tight` tiles change nothing but the pixels traced: same picture as sphere tiles wherever an object is
    { const sc = { objects: DA.place(src, 37.3, null), markings: [], verge: src.verge }, a = new Float32Array(4 * 160 * 90), b = new Float32Array(4 * 160 * 90);
      D.render(Object.assign({ scene: sc, layer: 'objects', rgba: a }, base)); D.render(Object.assign({ scene: sc, layer: 'objects', rgba: b, tight: true }, base)); let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
      ok('F2f tight tiles give the same object layer as sphere tiles', d < 1e-6, 'worst ' + d); }
  }
  // F3: sealed-beam solver (solvers/sealed-beam-v1.js) — the flutes steer the beam where their parameters say, and every variant stays inside the envelope
  {
    const lab = require('../tools/sealed-beam/lab.js');
    const bad = [];
    for (const lamp of ['7', '5.75']) for (const beam of ['low', 'high']) for (const lens of ['fluted', 'plain', 'none']) {
      const sc = lab.makeScene(lamp, beam), r = await lab.solve(sc, { lens, tune: false });
      if (r.facts.errors.length || r.facts.violations.envelope.length || r.facts.violations.keepOut.length || r.facts.violations.budget) bad.push(lamp + '/' + beam + '/' + lens + ' ' + JSON.stringify(r.facts.errors.concat(r.facts.violations)));
    }
    ok('F3 sealed-beam: 2 lamps x 2 beams x 3 lenses verify clean (no errors, envelope, keep-out or budget violations)', bad.length === 0, bad.join(' | ') || '12 variants');
    for (const lamp of ['7', '5.75']) {            // aggressive flutes (steep prisms) must still fit the envelope: the lens thickness is capped by the envelope, steep cells are aimed less far
      const sc = lab.makeScene(lamp, 'low'), r = await lab.solve(sc, { lens: 'fluted', tune: false, hSpread: 30, vSpread: 15, spillR: 0.4, spillAngle: 30 });
      ok('F3 sealed-beam: ' + lamp + '" with extreme flute angles still verifies clean', !r.facts.errors.length && !r.facts.violations.envelope.length && !r.facts.violations.keepOut.length, JSON.stringify(r.facts.violations) + ' ' + r.out.notes[r.out.notes.length - 1].slice(0, 160));
    }
    // end to end: a ~point filament at the focus, every flute aimed at one spot → the far-field peak lands there (checks the cell-normal solve, Snell at both faces, the angle convention)
    const peak = async (lens, over) => {
      const sc = lab.makeScene('7', 'high'); Object.assign(sc.source, { length: 0.2, radius: 0.05 });
      const r = await lab.solve(sc, Object.assign({ lens, tune: false, shield: false }, over)), j = lab.judge(sc, r.out.surfaces, 400000, ['fmvss-ub2']);
      return j.peakAt;
    };
    const near = (a, h, v, tol) => Math.abs(a[0] - h) <= tol && Math.abs(a[1] - v) <= tol;
    const A = await peak('fluted', { hotR: 5, hotH: 3, hotV: -2, hotSpread: 0 }), B = await peak('fluted', { hotR: 5, hotH: -4, hotV: 1, hotSpread: 0 }), P = await peak('plain', {});
    ok('F3 sealed-beam: flutes aimed at (3 R, 2 D) put the peak there', near(A, 3, -2, 0.6), 'peak at ' + JSON.stringify(A));
    ok('F3 sealed-beam: flutes aimed at (4 L, 1 U) put the peak there', near(B, -4, 1, 0.6), 'peak at ' + JSON.stringify(B));
    ok('F3 sealed-beam: plain cover glass keeps the paraboloid\'s beam on the axis (0, 0)', near(P, 0, 0, 0.6), 'peak at ' + JSON.stringify(P));
  }
  // F4: curve objects (js/profile.js).  A profile is a chain of quadratic-Bézier segments; the engine still reads modeC.profile.
  {
    const P = RF.Profile, J = JSON.stringify, near = (a, b) => Math.abs(a - b) < 1e-9;
    const old = [[0, 10], [5, 10.5], [9, 12], [12, 15]];
    ok('F4 a point profile converts to a curve and flattens back to exactly the same points (lossless)', J(P.curveFlatten(P.curveFromPoints(old))) === J(old));
    const cv = { nodes: [[0, 10], [8, 14]], bulge: [0.2] }, g = P.segGeom(cv.nodes[0], cv.nodes[1], 0.2), fl = P.curveFlatten(cv), mid = fl[fl.length >> 1];
    ok('F4 the bend handle sits on the curve: the Bézier at t=1/2 is chord middle + bulge x chord along the left normal', near(mid[0], g.mid[0]) && near(mid[1], g.mid[1]) && near(P.kFromMid(cv.nodes[0], cv.nodes[1], g.mid), 0.2), J(mid));
    ok('F4 the ends of a flattened curve are the nodes exactly', J(fl[0]) === J(cv.nodes[0]) && J(fl[fl.length - 1]) === J(cv.nodes[1]));
    const sp = P.curveSplit(cv, 0), spl = P.curveFlatten(sp), onCurve = (p) => { let d = 1e9; for (let i = 0; i <= 4000; i++) { const t = i / 4000, u = 1 - t; d = Math.min(d, Math.hypot(u * u * 0 + 2 * u * t * g.ctrl[0] + t * t * 8 - p[0], u * u * 10 + 2 * u * t * g.ctrl[1] + t * t * 14 - p[1])); } return d; };
    ok('F4 splitting a bent segment keeps its shape to within 0.05 mm on a 9 mm chord (each half is re-fitted as a symmetric arc, so not exact; 3 nodes, 2 bulges)', sp.nodes.length === 3 && sp.bulge.length === 2 && Math.max(...spl.map(onCurve)) < 0.05, 'max dev ' + Math.max(...spl.map(onCurve)).toExponential(2));
    const dn = P.curveDeleteNode({ nodes: [[0, 0], [1, 1], [2, 0], [3, 1]], bulge: [0.1, 0.2, 0.3] }, 1);
    ok('F4 deleting an interior node leaves one straight segment in its place', dn.nodes.length === 3 && J(dn.bulge) === J([0, 0.3]), J(dn));
    // old scenes: no modeC.curve appears on load or serialize, and the sweep + trace is bit-identical
    const st = C.createStore(RF.State.testScene()); st.scene.modeC.profile = RF.Profile.presetProfile(st.scene.modeC.preset, st.scene); st.scene.mode = 'C';
    const wire = RF.State.serialize(st.scene), back = RF.State.deserialize(wire);
    ok('F4 an old scene (profile points only) loads with no curve object and the same points', back.modeC.curve === undefined && J(back.modeC.profile) === J(st.scene.modeC.profile) && !/"curve"/.test(wire));
    const trace = (sc) => { const surf = RF.Profile.build(sc).surfaces, Pp = RF.Engine.prepare(Object.assign({}, sc, { sim: Object.assign({}, sc.sim) }), surf), c = RF.Engine.runSync(Pp, 4000, 0); return J(surf).length + ':' + J(Array.from(c.grid || c.E || [])).length + ':' + J(surf); };
    ok('F4 that old scene builds the same surfaces before and after the save/load round trip', trace(st.scene) === trace(back));
    // a stored curve: valid while it still flattens to the profile, retired when the profile is rewritten, dropped if malformed, scaled with the scene
    C.actions.setCurve(st, cv);
    ok('F4 setCurve writes curve + flattened profile; curveLive trusts it', J(st.scene.modeC.profile) === J(P.curveFlatten(cv)) && !!P.curveLive(st.scene.modeC));
    const sc2 = RF.State.deserialize(RF.State.serialize(st.scene));
    ok('F4 a curve scene round-trips', J(sc2.modeC.curve) === J(cv) && !!P.curveLive(sc2.modeC));
    const bad = JSON.parse(RF.State.serialize(st.scene)); bad.modeC.curve = { nodes: [[0, 0]], bulge: [] };
    ok('F4 a malformed curve is dropped on load, the profile points stay', RF.State.deserialize(bad).modeC.curve === undefined && RF.State.deserialize(bad).modeC.profile.length === st.scene.modeC.profile.length);
    const big = RF.State.scaleScene(st.scene, 2);
    ok('F4 scaling the scene scales curve nodes and leaves the (dimensionless) bulge alone', J(big.modeC.curve.nodes) === J(cv.nodes.map(([r, z]) => [r * 2, z * 2])) && J(big.modeC.curve.bulge) === J(cv.bulge) && !!P.curveLive(big.modeC), J(big.modeC.curve));
    C.actions.setProfile(st, old);
    ok('F4 a point edit (setProfile) retires the curve', st.scene.modeC.curve === undefined && !P.curveLive(st.scene.modeC));
    st.scene.modeC.curve = cv; ok('F4 a stale curve (profile no longer matches) is not trusted', !P.curveLive(st.scene.modeC));
  }
  // D1a: the ground is anti-aliased across its material edges (asphalt / gravel / grass), not only along the paint: a 160x90 ground (1 sample) against the same view at 640x360 box-filtered down
  {
    const D = RF.Drive, lut = D.lutFrom(() => 3000), mean = (A) => {
      const go = (w) => D.render({ w, h: w * 9 / 16, hfov: 45, eye: [-2, 0.37, 1.2], lamps: [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut, conv: 'A', lane: 3.5, arc: A, ss: 1, look: { RL: 0.2 }, scene: { objects: [], markings: D.laneMarkings(3.5, { us: true }), verge: ['gravel', 1.5, 'grass'] } }).rgb;
      const lo = go(160), hi = go(640); let e = 0, n = 0;
      for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) { let a = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const q = 3 * ((y * 4 + j) * 640 + x * 4 + i); a += (0.2126 * hi[q] + 0.7152 * hi[q + 1] + 0.0722 * hi[q + 2]) / 16; } const q = 3 * (y * 160 + x), b = 0.2126 * lo[q] + 0.7152 * lo[q + 1] + 0.0722 * lo[q + 2]; if (a > 1e-3) { e += Math.abs(a - b) / a; n++; } }
      return e / n;
    };
    const bend = mean(RF.Road.arc(150, 'left')), straight = mean(null);
    ok('D1a ground edges are anti-aliased (mean relative error vs a 4x render; before: 0.054 bend / 0.042 straight)', bend < 0.03 && straight < 0.03, 'bend ' + bend.toFixed(4) + ', straight ' + straight.toFixed(4));
  }
  // D1b-e: the animated view's random scenery, moving walkers and deer, pavement markers, the US broken centre line (CPU side)
  {
    const DA = RF.DriveAnim, D = RF.Drive, flags = { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: false, rpm: true }, J = JSON.stringify;
    const mk = (seed, dn, us, cl) => DA.source('road', 3.5, !!us, flags, { wild: true, seed, density: dn === undefined ? 1.5 : dn, cline: cl });
    const a = mk(7), b = mk(7), c = mk(8);
    ok('D1b same seed, same road (chunks 0..4 identical); another seed differs', [0, 1, 2, 3, 4].every((k) => J(a.chunk(k)) === J(b.chunk(k))) && J(a.chunk(2)) !== J(c.chunk(2)));
    ok('D1b chunks differ from each other: no 300 m repeat (statics of chunk 1 are not chunk 0 shifted, 5 chunks pairwise different)', [0, 1, 2, 3, 4].every((k) => [0, 1, 2, 3, 4].every((q) => q <= k || J(a.chunk(k).objects.map((o) => [o.k, +o.y.toFixed(3), +o.x.toFixed(3)])) !== J(a.chunk(q).objects.map((o) => [o.k, +o.y.toFixed(3), +o.x.toFixed(3)])))));
    { const p1 = DA.place(a, 12.5, null), p2 = DA.place(a, 12.5 + DA.PERIOD, null), key = (L) => J(L.map((o) => [o.k, +o.y.toFixed(3), +o.x.toFixed(3)]).sort());
      ok('D1b place(): a lap (300 m later) does not show the same scenery; the original scenery (no opts) still repeats exactly', key(p1) !== key(p2) && key(DA.place(DA.source('road', 3.5, false, flags), 12.5, null)) === key(DA.place(DA.source('road', 3.5, false, flags), 12.5 + DA.PERIOD, null))); }
    { const cnt = (dn) => { let n = 0; for (let k = 0; k < 6; k++) n += mk(7, dn).chunk(k).objects.length; return n / 6; }, c1 = cnt(1), c15 = cnt(1.5), c3 = cnt(3), still = DA.source('road', 3.5, false, flags).objects.length;
      ok('D1b density: more scenery per chunk at higher density, denser than the original fixed scene at the default (' + c15.toFixed(0) + ' vs ' + still + ')', c1 < c15 && c15 < c3 && c15 > still, [c1, c15, c3].map((x) => x.toFixed(0)).join(' / ')); }
    // moving people and deer: they start where the chunk put them, walk at plausible speeds, stop where their track ends
    { const ch = a.chunk(1), act = ch.actors, dist = 300 + 40; let bad = [];
      const at = (tau) => DA.place(a, dist, null, () => tau);
      const p0 = at(0), p5 = at(5), p200 = at(200), p400 = at(400);
      ok('D1c walkers and deer exist in a chunk, and place() with no clock leaves them at their start', act.some((x) => x.kind === 'person') && ch.actors.length >= 1 && p0.length > 0 && J(DA.place(a, dist, null)) === J(p0));
      ok('D1c they move: scenery differs between 0 s and 5 s; and stops moving once every track is done (200 s = 400 s)', J(p0) !== J(p5) && J(p200) === J(p400));
      for (const x of act) { const sp = x.spd; if (x.kind === 'person' && !(sp >= 0.8 && sp <= 1.7)) bad.push(x.id + ' ' + sp); if (x.kind === 'deer' && !(sp >= 0.9 && sp <= 1.6)) bad.push(x.id + ' ' + sp); }
      let tot = 0, n = 0; for (let k = 0; k < 20; k++) for (const x of a.chunk(k).actors) { tot++; if (x.kind === 'deer' && x.mode === 'step') { const edge = x.doff < 0 ? 5.25 : -1.75, towardRoad = Math.sign(edge - x.off0) === Math.sign(x.doff) || Math.abs(x.len) < 1e-6; if (!towardRoad) bad.push('deer ' + x.id + ' walks away from the road'); n++; } }
      ok('D1c speeds are walking speeds (people 0.8-1.7 m/s, deer 0.9-1.6 m/s) and stepping deer head toward the road (' + n + ' of ' + tot + ' actors checked)', bad.length === 0 && n > 3, bad.join('; ')); }
    { const pose = (x, t) => { const run = Math.max(0, t - (x.delay || 0)), d = Math.min(x.spd * run, x.len); return [x.s0 + x.ds * d, x.off0 + x.doff * d]; };
      const deer = a.chunk(3).actors.concat(a.chunk(4).actors, a.chunk(5).actors, a.chunk(6).actors).find((x) => x.kind === 'deer' && x.mode === 'step'), e0 = deer ? pose(deer, 0)[1] : 0, e9 = deer ? pose(deer, 99)[1] : 0, road = (o) => o >= -1.75 && o <= 5.25;
      ok('D1c a stepping deer ends nearer the road than it started (or on it)', !!deer && Math.abs(e9 - (deer.side > 0 ? 5.25 : -1.75)) < Math.abs(e0 - (deer.side > 0 ? 5.25 : -1.75)), deer ? 'off ' + e0.toFixed(2) + ' → ' + e9.toFixed(2) : 'no deer found'); }
    // pavement markers: lit by the beam like any retroreflector, add light, hide nothing
    { const lut = D.lutFrom(() => 30000), base = { w: 160, h: 90, hfov: 60, eye: DA.EYE, lamps: [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut, conv: 'A', lane: 3.5, look: { RL: 0.2 } };
      const rpms = a.chunk(0).objects.filter((o) => o.cls === 'rpm');
      ok('D1d the road has pavement markers on the centre line and both edges (' + rpms.length + ' per chunk), they glow (add light, no coverage)', rpms.length >= 45 && rpms.every((o) => o.glow && o.k === 'disc'));
      const r = D.render(Object.assign({ ss: 2, layer: 'objects', tight: true, scene: { objects: DA.place(a, 0, null).filter((o) => o.cls === 'rpm' && o.x > 8 && o.x < 40), markings: [], verge: a.verge } }, base));
      let lit = 0, covered = 0; for (let q = 0; q < 160 * 90; q++) { if (r.rgb[3 * q] > 0) lit++; if (r.cov[q] > 0) covered++; }
      ok('D1d traced alone, markers 8-40 m ahead light pixels and cover none', lit > 3 && covered === 0, lit + ' lit, ' + covered + ' covered'); }
    // D1f: foliage the beam cannot reach is left out of the trace; the picture does not change (black either way), and the trace has less to do
    { const lut = D.lutFrom((h, v) => 30000 * Math.exp(-((h / 10) ** 2 + ((v + 1.5) / 2.5) ** 2))), w = 200, h = 112, p = { w, h, hfov: 60, lamps: [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut, conv: 'A', A: null, lane: 3.5, look: { RL: 0.2 }, src: a };
      let nAll = 0, nKept = 0, worst = 0; const dim = DA.dimFoliage(p);
      for (const dist of [0, 55, 130, 210]) {
        const L1 = DA.place(a, dist, null, () => 0), L2 = DA.place(a, dist, null, () => 0, dim); nAll += L1.filter((o) => o.cls === 'veg').length; nKept += L2.filter((o) => o.cls === 'veg').length;
        const rgba1 = new Float32Array(4 * w * h), rgba2 = new Float32Array(4 * w * h), cam = Object.assign({ ss: 1, layer: 'objects', tight: true }, { w, h, hfov: 60, eye: DA.EYE, lamps: p.lamps, lut, conv: 'A', lane: 3.5, look: p.look });
        D.render(Object.assign({ rgba: rgba1, scene: { objects: L1, markings: [], verge: a.verge } }, cam)); D.render(Object.assign({ rgba: rgba2, scene: { objects: L2, markings: [], verge: a.verge } }, cam));
        for (let q = 0; q < w * h; q++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(rgba1[4 * q + c] - rgba2[4 * q + c]));
      }
      ok('D1f leaving out unlit foliage changes no pixel by more than 1e-3 cd/m² (' + nKept + ' of ' + nAll + ' foliage pieces traced)', worst < 1e-3 && nKept < nAll, 'worst ' + worst.toExponential(1)); }
    { const eu = mk(7, 1.5, false), us = mk(7, 1.5, true), usb = mk(7, 1.5, true, 'broken');
      ok('D1e US: double solid yellow by default; the broken-line option has ONE patterned yellow line (3 m on, 12 m cycle); the EU road keeps its dashed white line', !us.markings.some((m) => m.pat) && usb.markings.filter((m) => m.pat).length === 1 && usb.markings.find((m) => m.pat).mat === 'yellow-paint' && usb.markings.find((m) => m.pat).pat.on === 3 && eu.markings.find((m) => m.pat).mat === 'white-paint' && eu.markings.find((m) => m.pat).pat.on === 4);
      const g = DA.ground({ w: 160, h: 90, hfov: 60, A: null, lanes: 0, lamps: [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut: D.lutFrom(() => 3000), conv: 'A', lane: 3.5, look: { RL: 0.2 }, src: usb });
      ok('D1e broken centre line gives the ground a moving stripe layer on the US preset (pattern period 12)', !!g.B && g.pat && g.pat.period === 12);
      const gap = (m) => m.pat.s0 + m.pat.on + (m.pat.period - m.pat.on) / 2, cl = usb.chunk(0).objects.filter((o) => o.cls === 'rpm' && Math.abs(o.y - 1.75) < 1e-9), pm = usb.markings.find((m) => m.pat), per = pm.pat.period;
      ok('D1e markers on a broken centre line sit in the middle of the gaps', cl.length > 10 && cl.every((o) => { const u = ((o.x + 0.0 - gap(pm)) % per + per) % per; return Math.min(u, per - u) < 0.06 + 0.05; }), cl.length + ' markers'); }
  }
  // F5: facet shell (js/profile.js shellBuild).  modeC.shell = ring x sector cells cut from one conic; absent = every old scene.
  {
    const P = RF.Profile, J = JSON.stringify, fs = require('fs'), crypto = require('crypto'), sha = (x) => crypto.createHash('sha1').update(x).digest('hex');
    // old scenes trace identically: hashes taken at base commit 1a9aee1 (git archive, before any F5 code): sha1 of the built surfaces : the grid hash of a 20 000-ray run
    const BASE = {
      'sealed-beam-5.75in-high.json': '6d61062e34d2a9774d8bb00e0d69879f747a5b9d:c6c97f18129ea874',
      'sealed-beam-5.75in-low.json': '67669068f7a76e069ce4b10f46040c222875105b:a512eaf7e9e683e0',
      'sealed-beam-7in-high.json': 'a2c781a36d19e5c1da7279f28d79179429136078:372b137722b3739b',
      'sealed-beam-7in-low.json': '39ca8f5cdfd7d2d25be1e7912b31db42112537a2:0f1cd18a0e5ebdfc',
      'modeC-parabola': 'f5aad0d366fb3560f6855f074fdf6916535e37da:abe73f26ee405bc9',
      'modeC-ellipse': '76d5d808760763e1533fb253f0173657f42275ad:8702ae3cbd0cfb77',
      'modeC-sphere': 'a7fc03e3863d4bd3973723e7a9fdc0481f061d1c:e35920f4b25a2648',
      'modeC-cpc': '1c489facc28a6c531c8090abef8104a02b3f4a2a:606cad64ef6ea944'
    };
    const trace = (sc) => { const st = C.createStore(sc); st.dirty.add('B'); st.dirty.add('C'); st.dirty.add('L'); st.commit({ deferA: true }); const surf = RF.State.allSurfaces(st.scene), Pp = RF.Engine.prepare(Object.assign({}, st.scene, { sim: Object.assign({}, st.scene.sim) }), surf), c = RF.Engine.runSync(Pp, 20000, 0); return sha(J(surf)) + ':' + RF.Engine.gridHash(c); };
    const old = {}, exDir = require('path').join(__dirname, '..', 'examples');
    for (const f of fs.readdirSync(exDir).filter((x) => x.endsWith('.json'))) { const sc = RF.State.deserialize(fs.readFileSync(require('path').join(exDir, f), 'utf8')); old[f] = sc.modeC.shell !== undefined ? 'HAS SHELL' : trace(sc); }
    for (const kind of ['parabola', 'ellipse', 'sphere', 'cpc']) { const sc = RF.State.testScene(); sc.mode = 'C'; sc.modeC.preset.kind = kind; sc.modeC.profile = P.presetProfile(sc.modeC.preset, sc); const wire = RF.State.serialize(sc); old['modeC-' + kind] = /shell/.test(wire) ? 'WIRE HAS SHELL' : trace(RF.State.deserialize(wire)); }
    ok('F5 old scenes (' + Object.keys(BASE).length + ': the example JSONs + Mode C parabola / ellipse / sphere / CPC) build and trace exactly as at the base commit', Object.keys(BASE).every((k) => old[k] === BASE[k]), Object.keys(BASE).filter((k) => old[k] !== BASE[k]).join(', ') || 'all ' + Object.keys(BASE).length + ' hashes equal');
    // a shell that is switched off, or inactive (extrude, refract, mirror, flip), builds the plain profile byte for byte
    { const sc = RF.State.testScene(); sc.mode = 'C'; sc.modeC.profile = P.presetProfile(sc.modeC.preset, sc); const plain = J(P.build(sc).surfaces);
      sc.modeC.shell = Object.assign({ on: false, nRad: 12, nAng: 24, cells: { '3:4': { dv: 5 } } }, P.shellFromPreset(sc.modeC.preset));
      const offB = J(P.build(sc).surfaces); sc.modeC.shell.on = true; const live = P.build(sc);
      ok('F5 a shell switched off builds exactly the plain profile; switched on it builds nRad x nAng cells', offB === plain && live.surfaces.length === 288 && live.surfaces.every((s) => s.type === 'quad'), live.surfaces.length + ' cells');
      const gate = (set) => { const s2 = RF.U.deepCopy(sc); set(s2.modeC); return P.shellOn(s2.modeC) === false && !P.build(s2).report.shell; };
      ok('F5 the shell is inactive (plain profile traced) for extrude / refract / mirror / flip facing', [(m) => { m.sweep = 'extrude'; }, (m) => { m.interaction = 'refract'; }, (m) => { m.mirror = true; }, (m) => { m.flipFacing = true; }].every(gate));
    }
    // default cells = the plain shell: the same quadric, compared with one exact `rev` conic zone, same rays and seed
    const mk = (cells, nr, na) => { const sc = RF.State.testScene(); sc.mode = 'C'; sc.modeC.profile = P.presetProfile(sc.modeC.preset, sc); sc.sim.bounces = 1; sc.sim.seed = 7; sc.source.kind = 'point'; sc.source.dist = 'isotropic';
      sc.modeC.shell = Object.assign({ on: true, nRad: nr || 12, nAng: na || 24, cells: cells || {} }, P.shellFromPreset(sc.modeC.preset)); return sc; };
    const N = 200000, runS = (sc, surf) => { const Pp = RF.Engine.prepare(Object.assign({}, sc, { sim: Object.assign({}, sc.sim) }), surf); Pp.recordHits = true; return { P: Pp, c: RF.Engine.runSync(Pp, N, 0) }; };
    const sc0 = mk(), sh0 = sc0.modeC.shell, fr = P.axisFrame(sc0, 'aim');
    const plainConic = [{ type: 'rev', id: 'P', group: 'C', O: fr.O, W: fr.W, ref: fr.e1, seg: { kind: 'conic', zv: sh0.zv, R: sh0.R, k: sh0.k, r0: 0, r1: sh0.r1 }, front: -1, optics: { interaction: 'reflect', reflectivity: 0.9, ior: 1.49, fresnelT: 0.96, twoSided: false } }];
    const ref = runS(sc0, plainConic), land = (r) => { const m = new Map(); for (let h = 0; h < r.c.nHits; h++) m.set(r.c.hitI[h], [r.c.hits[3 * h], r.c.hits[3 * h + 1]]); return m; };
    const cmp = (a, b) => { const A = land(a), B = land(b); let same = 0, moved = 0, lost = 0, gained = 0; for (const [i, x] of A) { const y = B.get(i); if (!y) lost++; else if (Math.hypot(x[0] - y[0], x[1] - y[1]) < 1e-2) same++; else moved++; } for (const i of B.keys()) if (!A.has(i)) gained++; return { same, moved, lost, gained, n: A.size }; };
    const shellRun = (cells, nr, na) => { const sc = mk(cells, nr, na); return runS(sc, P.build(sc).surfaces); };
    const d0 = shellRun(), cd = cmp(ref, d0), eb = (r) => r.c.E;
    ok('F5 default cells vs the exact conic zone (parabola, 12 x 24 = 288 cells, 200k rays): >= 99.99% of rays land identically, none move', cd.same / cd.n >= 0.9999 && cd.moved === 0 && cd.gained === 0, J(cd));
    ok('F5 ...and the energy bins agree to 0.05% (reflected / absorbed / escaped / intercepted)', ['reflected', 'absorbed', 'escaped', 'intercepted'].every((k) => Math.abs(eb(d0)[k] - eb(ref)[k]) <= 5e-4 * eb(ref).emitted), ['reflected', 'absorbed', 'escaped', 'intercepted'].map((k) => k + ' ' + eb(ref)[k].toFixed(2) + ' vs ' + eb(d0)[k].toFixed(2)).join('; '));
    for (const [nr, na] of [[5, 7], [3, 6], [32, 72]]) { const fine = cmp(ref, shellRun({}, nr, na)); ok('F5 default cells also match with other counts (' + nr + ' rings x ' + na + ' sectors = ' + nr * na + ' cells)', fine.same / fine.n >= 0.9999 && fine.moved === 0 && fine.gained / fine.n <= 1e-4, J(fine)); }
    const t1 = cmp(ref, shellRun({ '5:3': { dTheta: 2 } })), v1 = cmp(ref, shellRun({ '5:3': { dv: 5 } }));
    ok('F5 negative control: ONE cell tilted 2 deg fails the same comparison (rays move)', t1.moved > 300, J(t1));
    ok('F5 negative control: ONE cell with focus 5 per m fails it too', v1.moved > 300, J(v1));
    // dv sign and size: for rays through one cell, outgoing direction vs offset across the cell has slope -dv/1000 in the sagittal direction, x cos(incidence) in the tangential one
    {
      const slopeOf = (cells) => { const sc = mk(cells), b = P.build(sc), r = runS(sc, b.surfaces), k = b.surfaces.findIndex((s) => s.id === 'S5_3') + 1, s = b.surfaces[k - 1], ey = RF.V.cross(s.n, s.ref); let n = 0; const sx = [0, 0], sy = [0, 0], sxx = [0, 0], sxy = [0, 0];
        for (let i = 0; i < N; i++) if (r.c.rayK[i] === k) { const p = RF.Engine.retrace(r.P, i); if (p.length < 9) continue; const d = RF.V.norm([p[6] - p[3], p[7] - p[4], p[8] - p[5]]), o = [p[3] - s.P[0], p[4] - s.P[1], p[5] - s.P[2]]; n++;
          [s.ref, ey].forEach((ax, q) => { const x = RF.V.dot(o, ax), y = RF.V.dot(d, ax); sx[q] += x; sy[q] += y; sxx[q] += x * x; sxy[q] += x * y; }); }
        const sl = (q) => (n * sxy[q] - sx[q] * sy[q]) / (n * sxx[q] - sx[q] * sx[q]); return { tan: sl(0), sag: sl(1), n, s }; };
      const z = slopeOf({}), pos = slopeOf({ '5:3': { dv: 40 } }), neg = slopeOf({ '5:3': { dv: -40 } });
      const cosI = -RF.V.dot(RF.V.norm(z.s.P), z.s.n);
      ok('F5 focus: +40 per m converges (sagittal slope -0.040 +- 10%), -40 diverges (+0.040); the default cell has no slope', Math.abs(z.sag) < 1e-3 && Math.abs(pos.sag - z.sag + 0.04) < 0.004 && Math.abs(neg.sag - z.sag - 0.04) < 0.004, 'sagittal slopes ' + [z.sag, pos.sag, neg.sag].map((x) => x.toFixed(4)).join(' / ') + ', rays ' + [z.n, pos.n, neg.n].join('/'));
      ok('F5 focus: the tangential slope is the sagittal one times cos(incidence)^2 (Coddington: one cos for the foreshortened beam, one for the direction measured along the surface), here ' + (cosI * cosI).toFixed(3), Math.abs(pos.tan / pos.sag - cosI * cosI) < 0.1 * cosI * cosI, 'ratio ' + (pos.tan / pos.sag).toFixed(3));
    }
    // aim: +dTheta turns the cell's reflected beam outward from the axis; dPhi turns it toward increasing azimuth
    {
      const dirOf = (cells) => { const sc = mk(cells), b = P.build(sc), r = runS(sc, b.surfaces), k = b.surfaces.findIndex((s) => s.id === 'S5_3') + 1; let sum = [0, 0, 0];
        for (let i = 0; i < N; i++) if (r.c.rayK[i] === k) { const p = RF.Engine.retrace(r.P, i); if (p.length < 9) continue; sum = RF.V.add(sum, RF.V.norm([p[6] - p[3], p[7] - p[4], p[8] - p[5]])); } return RF.V.norm(sum); };
      const z = dirOf({}), a = dirOf({ '5:3': { dTheta: 2 } }), b2 = dirOf({ '5:3': { dPhi: 2 } });
      const ang = (u, v) => Math.acos(Math.min(1, RF.V.dot(u, v))) * 180 / Math.PI, fr0 = P.axisFrame(mk(), 'aim'), pm = 2 * Math.PI * 3.5 / 24, rad = RF.V.add(RF.V.mul(fr0.e1, Math.cos(pm)), RF.V.mul(fr0.e2, Math.sin(pm))), azi = RF.V.add(RF.V.mul(fr0.e1, -Math.sin(pm)), RF.V.mul(fr0.e2, Math.cos(pm)));
      ok('F5 aim: dTheta = +2 turns the cell\'s mean reflected direction by 2.0 deg, outward from the axis', Math.abs(ang(z, a) - 2) < 0.1 && RF.V.dot(RF.V.sub(a, z), rad) > 0, ang(z, a).toFixed(3) + ' deg, outward component ' + RF.V.dot(RF.V.sub(a, z), rad).toExponential(2));
      ok('F5 aim: dPhi = +2 turns it by 2.0 deg toward increasing azimuth', Math.abs(ang(z, b2) - 2) < 0.1 && RF.V.dot(RF.V.sub(b2, z), azi) > 0, ang(z, b2).toFixed(3) + ' deg, azimuthal component ' + RF.V.dot(RF.V.sub(b2, z), azi).toExponential(2));
    }
    // other conics: an ellipse and a sphere shell are the same sheet as their rev conic zone too (no foci needed)
    for (const kind of ['ellipse', 'sphere']) {
      const sc = mk(); sc.modeC.preset.kind = kind; const c = P.shellFromPreset(sc.modeC.preset); Object.assign(sc.modeC.shell, c); sc.modeC.profile = P.presetProfile(sc.modeC.preset, sc);
      const rv = [Object.assign({}, plainConic[0], { seg: { kind: 'conic', zv: c.zv, R: c.R, k: c.k, r0: 0, r1: c.r1 } })], a1 = runS(sc, rv), b1 = runS(sc, P.build(sc).surfaces), q = cmp(a1, b1);
      ok('F5 default cells = exact conic zone for the ' + kind + ' preset too', q.same / q.n >= 0.9995 && q.moved === 0 && q.gained === 0, J(q));
    }
    // several bounces: coincident (overlapping) default cells must not make a ray hit its own sheet again — truncated / re-hit tallies and landings stay those of the plain conic
    for (const kind of ['parabola', 'ellipse', 'sphere']) {
      const sc = mk(); sc.modeC.preset.kind = kind; const c = P.shellFromPreset(sc.modeC.preset); Object.assign(sc.modeC.shell, c); sc.modeC.profile = P.presetProfile(sc.modeC.preset, sc); sc.sim.bounces = 4;
      const rv = [Object.assign({}, plainConic[0], { seg: { kind: 'conic', zv: c.zv, R: c.R, k: c.k, r0: 0, r1: c.r1 } })], a1 = runS(sc, rv), b1 = runS(sc, P.build(sc).surfaces), q = cmp(a1, b1), Ea = a1.c.E, Eb = b1.c.E;
      ok('F5 ' + kind + ' shell with 4 bounces: landings and the re-hit / truncated tallies match the plain conic', q.same / q.n >= 0.9995 && q.moved === 0 && q.gained === 0 && Math.abs(Eb.reHit - Ea.reHit) <= 1e-3 * Ea.emitted && Math.abs(Eb.truncated - Ea.truncated) <= 1e-3 * Ea.emitted, J(q) + ' reHit ' + Ea.reHit.toFixed(2) + ' vs ' + Eb.reHit.toFixed(2) + ', truncated ' + Ea.truncated.toFixed(2) + ' vs ' + Eb.truncated.toFixed(2));
    }
    // scale and mirror, by tracing: an edited shell scaled 2x has the cells' quadrics scaled 1/2 (and the same normals), and a y-mirrored scene's cell 5:(N-1-3) reflects like the original 5:3 mirrored
    {
      const base = mk({ '5:3': { dv: 20, dTheta: 3, dPhi: 4 }, '2:10': { dv: -10 } }), bs = P.build(base).surfaces, big = RF.State.scaleScene(base, 2), gs = P.build(big).surfaces;
      let worstA = 0, worstN = 0, worstP = 0;
      bs.forEach((a, i) => { const b = gs[i]; a.quadric.A.forEach((x, j) => { worstA = Math.max(worstA, Math.abs(b.quadric.A[j] - x / 2) / (Math.abs(x) + 1e-9 * 2)); }); worstN = Math.max(worstN, RF.V.dist(a.n, b.n)); worstP = Math.max(worstP, RF.V.dist(RF.V.mul(a.P, 2), b.P)); });
      ok('F5 scene scaled 2x with an edited cell: every cell\'s quadric curvatures halve (incl. the focus edit), normals and centres (x2) agree', bs.length === gs.length && worstA < 1e-9 && worstN < 1e-12 && worstP < 1e-9, 'worst relative curvature error ' + worstA.toExponential(1) + ', normal ' + worstN.toExponential(1) + ', centre ' + worstP.toExponential(1));
      const mir = RF.State.mirrorSceneY(base), ms = P.build(mir).surfaces, M = (v) => [v[0], -v[1], v[2]];
      const meanOut = (sc, surfaces, id) => { const r = runS(sc, surfaces), k = surfaces.findIndex((s) => s.id === id) + 1; let sum = [0, 0, 0], n = 0; for (let i = 0; i < N; i++) if (r.c.rayK[i] === k) { const p = RF.Engine.retrace(r.P, i); if (p.length < 9) continue; sum = RF.V.add(sum, RF.V.norm([p[6] - p[3], p[7] - p[4], p[8] - p[5]])); n++; } return { d: RF.V.norm(sum), n }; };
      const o = meanOut(base, bs, 'S5_3'), m = meanOut(mir, ms, 'S5_20'), wrong = meanOut(mir, ms, 'S5_3'), ang = (u, v) => Math.acos(Math.min(1, RF.V.dot(u, v))) * 180 / Math.PI;
      const cP = RF.V.dist(M(bs.find((s) => s.id === 'S5_3').P), ms.find((s) => s.id === 'S5_20').P);
      ok('F5 mirrored scene: cell 5:20 sits where 5:3 did, mirrored (centre error ' + cP.toExponential(1) + ' mm) and its mean reflected direction is the mirror image of the original\'s (within 0.3 deg), the un-remapped cell 5:3 is not', cP < 1e-9 && ang(M(o.d), m.d) < 0.3 && ang(M(o.d), wrong.d) > 3, ang(M(o.d), m.d).toFixed(3) + ' deg (rays ' + o.n + '/' + m.n + '); un-remapped ' + ang(M(o.d), wrong.d).toFixed(2) + ' deg');
    }
    // size: the most cells the controls allow still saves in well under the browser's autosave quota (each cell is a saved surface)
    { const sc = mk({}, 32, 72), st = C.createStore(sc); st.dirty.add('C'); st.commit({ deferA: true }); const kb = RF.State.serialize(st.scene).length / 1024;
      const bigc = JSON.parse(RF.State.serialize(st.scene)); bigc.modeC.shell.nRad = 64; bigc.modeC.shell.nAng = 128;
      ok('F5 at the largest allowed counts (32 x 72 = 2304 cells) the saved scene is under 2.5 MB; larger counts in a file are clamped on load', kb < 2500 && RF.State.deserialize(JSON.stringify(bigc)).modeC.shell.nRad === 32 && RF.State.deserialize(JSON.stringify(bigc)).modeC.shell.nAng === 72, kb.toFixed(0) + ' KB'); }
    // scene format: round trip, validation, scale, mirror, history label
    {
      const st = C.createStore(mk({ '5:3': { dv: 5, dTheta: 1 }, '0:0': { dPhi: -2 } })), wire = RF.State.serialize(st.scene), back = RF.State.deserialize(wire);
      ok('F5 shell + cells survive save / load exactly', J(back.modeC.shell) === J(st.scene.modeC.shell), J(back.modeC.shell.cells));
      const bad = JSON.parse(wire); bad.modeC.shell.cells['99:1'] = { dv: 1 }; bad.modeC.shell.cells['2:2'] = { dv: 'x', dTheta: 99 }; bad.modeC.shell.cells.x = {};
      const v = RF.State.deserialize(J(bad)).modeC.shell;
      ok('F5 validation drops cells outside the grid and bad numbers, clamps aim to 30 deg', !v.cells['99:1'] && !v.cells.x && J(v.cells['2:2']) === J({ dTheta: 30 }) && Object.keys(v.cells).length === 3, J(v.cells));
      const bad2 = JSON.parse(wire); bad2.modeC.shell.R = -3; ok('F5 a malformed shell is dropped on load, the profile stays', RF.State.deserialize(J(bad2)).modeC.shell === undefined && RF.State.deserialize(J(bad2)).modeC.profile.length === st.scene.modeC.profile.length);
      const big = RF.State.scaleScene(st.scene, 2).modeC.shell;
      ok('F5 scaling the scene scales R, zv, rim and (inversely) focus; angles stay', big.R === 2 * st.scene.modeC.shell.R && big.r1 === 2 * st.scene.modeC.shell.r1 && big.cells['5:3'].dv === 2.5 && big.cells['5:3'].dTheta === 1, J(big.cells));
      const mir = RF.State.mirrorSceneY(st.scene).modeC.shell;
      ok('F5 mirroring the scene reverses the sector numbering and the sign of the sideways aim', mir.cells['5:20'] && mir.cells['0:23'] && mir.cells['0:23'].dPhi === 2 && mir.cells['5:20'].dv === 5, J(mir.cells));
      const a = RF.History.intent(st.scene), st2 = RF.U.deepCopy(st.scene); st2.modeC.shell.cells['1:1'] = { dv: 1 };
      ok('F5 history sees a cell edit and labels it', RF.History.key(a) !== RF.History.key(RF.History.intent(st2)) && /facet shell cell edit/i.test(RF.History.describe(a, RF.History.intent(st2)).text), RF.History.describe(a, RF.History.intent(st2)).text);
    }
    // controller: switch on from the preset, per-cell controls through setControl, counts clear the cells, a hand edit of the profile retires the shell
    {
      const st = C.createStore(RF.State.testScene()); st.scene.mode = 'C'; C.setControl(st, 'C.shell', true);
      ok('F5 ticking Facet shell seeds the conic from the parabola preset (R 2f, k -1, zv -f) and resamples the profile onto it', st.scene.modeC.shell.on && st.scene.modeC.shell.R === 24 && st.scene.modeC.shell.k === -1 && st.scene.modeC.shell.zv === -12 && st.scene.modeC.profile.length === 41 && Math.abs(st.scene.modeC.profile[40][1] - (-12 + 45 * 45 / 48)) < 1e-9, J(st.scene.modeC.shell));
      C.actions.shellSelect(st, 3, 4); C.setControl(st, 'C.cth', 2); C.setControl(st, 'C.cdv', 5); C.setControl(st, 'C.cph', 0);
      ok('F5 per-cell controls write a sparse entry for the selected cell only', J(st.scene.modeC.shell.cells) === J({ '3:4': { dTheta: 2, dv: 5 } }), J(st.scene.modeC.shell.cells));
      C.setControl(st, 'C.cdv', 0); C.setControl(st, 'C.cth', 0);
      ok('F5 setting a cell back to 0 removes it (the sparse field stays sparse)', J(st.scene.modeC.shell.cells) === '{}');
      C.setControl(st, 'C.cth', 2); C.actions.shellCells(st, 'ring');
      ok('F5 Apply to ring copies the cell to its whole ring (24 cells); Reset all clears', Object.keys(st.scene.modeC.shell.cells).length === 24 && (C.actions.shellCells(st, 'reset-all'), Object.keys(st.scene.modeC.shell.cells).length === 0));
      C.setControl(st, 'C.cth', 1); C.setControl(st, 'C.shNa', 16);
      ok('F5 changing the sector count clears the cell edits and says so', J(st.scene.modeC.shell.cells) === '{}' && st.scene.modeC.shell.nAng === 16 && st.notices.some((x) => /count changed/.test(x.msg)));
      C.actions.setProfile(st, [[0, 1], [5, 2]]);
      ok('F5 editing the profile by hand turns the shell off (cells kept) and says so', st.scene.modeC.shell.on === false && st.notices.some((x) => /turned off/.test(x.msg)));
      const st3 = C.createStore(RF.State.testScene()); st3.scene.modeC.preset.kind = 'cpc'; C.setControl(st3, 'C.shell', true);
      ok('F5 a preset that is not a conic cannot start a shell (notice, nothing written)', st3.scene.modeC.shell === undefined && st3.notices.length === 1);
      const st4 = C.createStore(RF.State.testScene()); C.setControl(st4, 'C.shell', true); C.setControl(st4, 'C.f', 20);
      ok('F5 the preset controls drive a live shell (focal length 20: R 40, zv -20)', st4.scene.modeC.shell.R === 40 && st4.scene.modeC.shell.zv === -20);
    }
  }

  // D2: the object trace (drive.js render, drive-anim.js tracer) — exact culling, the worker's jobs, the ground's pattern layers, forest + city in the animation
  {
    const DA = RF.DriveAnim, D = RF.Drive, lut = D.lutFrom((h, v) => 30000 * Math.exp(-((h / 12) ** 2 + ((v + 1.5) / 3) ** 2))), lamps = [[0, 0.7, 0.7], [0, -0.7, 0.7]];
    const flags = { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true };
    const camOf = (w, h, A) => ({ w, h, hfov: 60, eye: DA.EYE, lamps, lut, conv: 'A', arc: A, lane: 3.5, look: { RL: 0.2 } });
    const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    // D2a: front-to-back early-out and the walk over non-empty tiles change no value (the objects layer AND the whole picture), on every animated scene, straight and bent, 1 and 2 samples
    { let n = 0, bad = [];
      for (const [name, opts] of [['road', { wild: true, seed: 3, density: 1.5 }], ['forest', {}], ['city', {}]]) for (const A of [null, RF.Road.arc(150, 'left')]) for (const ss of [1, 2]) for (const dist of [0, 37.3, 111.7, 250]) {
        const src = DA.source(name, 3.5, false, flags, opts), w = 120, h = 68, cam = camOf(w, h, A), objs = DA.place(src, dist, A, () => 0), r = [];
        for (const sort of [false, true]) { const rgba = new Float32Array(4 * w * h); D.render(Object.assign({ ss, layer: 'objects', tight: true, rgba, sort, scene: { objects: objs, markings: [], verge: src.verge } }, cam)); const wh = D.render(Object.assign({ ss, sort, scene: { objects: objs, markings: src.markings, verge: src.verge } }, cam)); r.push([rgba, wh.rgb, wh.depth]); }
        n++; if (!same(r[0][0], r[1][0]) || !same(r[0][1], r[1][1]) || !same(r[0][2], r[1][2])) bad.push(name + ' ss' + ss + ' d' + dist + (A ? ' bend' : ''));
      }
      ok('D2a sorted early-out = original order, bit for bit (objects layer, whole picture, depth): ' + n + ' cases over road, forest, city', bad.length === 0, bad.slice(0, 3).join('; ')); }
    // D2b: the tracer's jobs (what a worker computes) put together are the page's own objects layer, bit for bit, whatever K
    { const w = 160, h = 90, A = RF.Road.arc(250, 'right'); let bad = [], n = 0;
      for (const [name, opts] of [['road', { wild: true, seed: 5, density: 1.5 }], ['forest', {}], ['city', {}]]) for (const dist of [0, 60.5, 140]) for (const K of [1, 5, 11]) {
        const src = DA.source(name, 3.5, false, flags, opts), act = new Map(), t = dist / 13.9;
        const p = { w, h, hfov: 60, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2 }, A, src }, T = DA.tracer();
        DA.activate(src, dist, t, act);
        T.cfg({ id: 1, p: { w, h, hfov: 60, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2 } }, arc: { R: A.R, dir: A.dir }, src: [name, 3.5, false, flags, opts] });
        const ref = new Float32Array(4 * w * h), tauOf = (id) => (act.has(id) ? t - act.get(id) : 0); DA.objects(p, dist, ref, 1, null, null, DA.place(src, dist, A, tauOf, DA.dimFoliage(p)));
        const got = new Float32Array(4 * w * h);
        for (let c = 0; c < K; c++) { const r = T.job({ seq: 1, dist, t, ss: 1, act: [...act], c, K, ret: null, wid: 0 }), f = new Float32Array(r.buf, 0, r.len); let off = 0; for (const ty of r.trows) { const a = ty * 16, e = Math.min(h, a + 16), m = (e - a) * w * 4; got.set(f.subarray(off, off + m), a * w * 4); off += m; } }
        n++; if (!same(ref, got)) bad.push(name + ' d' + dist + ' K' + K);
      }
      ok('D2b the worker\'s jobs, assembled, equal the objects layer traced in one go (' + n + ' cases on a bend, K = 1, 5, 11)', bad.length === 0, bad.slice(0, 3).join('; ')); }
    // D2c: forest and city are in the animation; the intersection is not; the single-occurrence stripes (crossing, stop line) come round every lap
    { ok('D2c forest and city are animated, the intersection is not', DA.ANIM_SCENES.forest && DA.ANIM_SCENES.city && !DA.ANIM_SCENES.intersection && DA.ANIM_SCENES.road);
      const city = DA.source('city', 3.5, false, flags, {}), g = DA.ground({ w: 120, h: 68, hfov: 60, A: null, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2 }, src: city });
      ok('D2c city: three moving layers (centre dash 12 m, crossing and stop line every 300 m), the crossing\'s bars are one layer', g.layers.length === 3 && g.layers.map((L) => L.pat.period).join() === '12,300,300' && g.layers[1].pat.on === 3.5 && g.layers[2].pat.on === 0.4, JSON.stringify(g.layers.map((L) => L.pat)));
      ok('D2c the still scene is untouched: its crossing is still a single-occurrence stripe', D.buildScene('city', { Lw: 3.5, A: null, us: false, seed: 7 }, {}).markings.filter((m) => m.pat && m.pat.period >= 1e5).length === 8);
      const forest = DA.source('forest', 3.5, false, flags, {}), gf = DA.ground({ w: 120, h: 68, hfov: 60, A: null, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2 }, src: forest });
      ok('D2c forest: the dash is the one moving layer', gf.layers.length === 1 && gf.layers[0].pat.period === 12); }
    // D2d: the city's ground layers = the still picture (pixel differences), at three distances, with the crossing and stop line approaching
    { const w = 320, h = 180, src = DA.source('city', 3.5, false, flags, {}), p = { w, h, hfov: 60, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src }, g = DA.ground(p), luma = (a, q) => 0.2126 * a[3 * q] + 0.7152 * a[3 * q + 1] + 0.0722 * a[3 * q + 2];
      for (const dist of [0, 20, 33]) {
        const shift = (m) => m.pat ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { s0: m.pat.s0 - dist, s1: m.pat.s1 - dist }) }) : m;
        const ref = D.render(Object.assign({ ss: 1, scene: { objects: [], markings: src.markings.map(shift), verge: src.verge } }, camOf(w, h, null))), comp = DA.composeCPU(p, g, null, dist);
        let worst = 0; const rels = []; for (let q = 0; q < w * h; q++) { const a = luma(comp, q), b = luma(ref.rgb, q), d = Math.abs(a - b); worst = Math.max(worst, d); if (b > 0.05) rels.push(d / b); }
        rels.sort((x, y) => x - y); const q99 = rels[Math.floor(rels.length * 0.99)] || 0, bad = rels.filter((r) => r > 1e-3).length, mx = rels[rels.length - 1];
        // (where two paints overlap — a crossing bar over the edge or centre line — the still view adds both and drops the leftover asphalt weight when it goes negative; the layers sum linearly: ≤ ~1 % there)
        ok('D2d city ground layers vs the still picture at ' + dist + ' m: ≥ 99 % of lit pixels within 0.1 %, none beyond 3 %', rels.length > 1000 && bad / rels.length < 0.01 && mx < 0.03, rels.length + ' lit px, ' + bad + ' beyond 0.1 %, p99 relative ' + q99.toExponential(1) + ', worst relative ' + mx.toExponential(1) + ', worst absolute ' + worst.toExponential(1) + ' cd/m²'); } }
    // D2e: forest foliage the beam cannot reach is left out (the same bound as D1f, now on the fixed scenes too): the picture does not change beyond 1e-3 cd/m²
    { const w = 200, h = 112, src = DA.source('forest', 3.5, false, flags, {}), p = { w, h, hfov: 60, lamps, lut, conv: 'A', A: null, lane: 3.5, look: { RL: 0.2 }, src }; let nAll = 0, nKept = 0, worst = 0; const dim = DA.dimFoliage(p);
      for (const dist of [0, 55, 130, 210]) {
        const L1 = DA.place(src, dist, null, () => 0), L2 = DA.place(src, dist, null, () => 0, dim); nAll += L1.length; nKept += L2.length;
        const a1 = new Float32Array(4 * w * h), a2 = new Float32Array(4 * w * h), cam = Object.assign({ ss: 1, layer: 'objects', tight: true }, camOf(w, h, null));
        D.render(Object.assign({ rgba: a1, scene: { objects: L1, markings: [], verge: src.verge } }, cam)); D.render(Object.assign({ rgba: a2, scene: { objects: L2, markings: [], verge: src.verge } }, cam));
        for (let q = 0; q < w * h; q++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a1[4 * q + c] - a2[4 * q + c]));
      }
      ok('D2e forest: leaving out unlit foliage changes no pixel by more than 1e-3 cd/m² (' + nKept + ' of ' + nAll + ' objects traced)', worst < 1e-3 && nKept < nAll, 'worst ' + worst.toExponential(1)); }
  }
  // W3b: solver parallelism (opt-in).  tools.pool results are in argument order whatever the worker count, so a pooled solve = the serial one;
  // the sealed-beam tuner's new options leave the default untouched (tuneGpu on the CPU = the same traces), and `frozen` judges at a held aim.
  {
    const fsx = require('fs'), vmx = require('vm'), pth = require('path'), ROOTX = pth.join(__dirname, '..');
    for (const f of ['sonnet55-2026-09-28-dish-fit.js', 'sealed-beam-v1.js']) vmx.runInThisContext(fsx.readFileSync(pth.join(ROOTX, 'solvers', f), 'utf8'), { filename: f });
    vmx.runInThisContext(fsx.readFileSync(pth.join(ROOTX, 'js', 'solver-pool.js'), 'utf8'), { filename: 'solver-pool.js' });
    const hashOf = (o) => require('crypto').createHash('sha1').update(JSON.stringify(o.surfaces)).digest('hex').slice(0, 12);
    const problemOf = (sc, input) => Object.assign(RF.U.deepCopy({ source: sc.source, emitters: sc.emitters || [], envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: sc.mode }), { target: input.target, modeA: { paint: input.paint.cells } });
    const run = async (sc, id, set, poolN, srcFile) => {
      const def = RF.Solvers.get(id), input = RF.Solvers.inputOf(sc), problem = problemOf(sc, input), settings = RF.Solvers.sanitize(def, Object.assign(RF.Solvers.settingsOf(sc, id), set));
      const tools = { progress() {}, preview() {}, budget: { rays: 5e7, ms: 1e9 }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
      if (poolN !== null) tools.pool = RF.SolverPool.create({ size: poolN, spawn: require('../tools/pool-worker-node.js').spawner(), id, srcs: [fsx.readFileSync(pth.join(ROOTX, 'solvers', srcFile), 'utf8')], scene: problem, input, run: (n, a) => def.tasks[n](input, a, { trace: tools.trace }) });
      try { return await def.solve(input, settings, tools); } finally { if (tools.pool) tools.pool.close(); }
    };
    const sc = RF.State.defaultScene(); sc.modeA.budget = 30; const small = { rays: 60000, trials: 8 };
    const h0 = hashOf(await run(sc, 'dish-fit-auto', small, null, 'sonnet55-2026-09-28-dish-fit.js')), h1 = hashOf(await run(sc, 'dish-fit-auto', small, 0, 'sonnet55-2026-09-28-dish-fit.js')),
      h2 = hashOf(await run(sc, 'dish-fit-auto', small, 2, 'sonnet55-2026-09-28-dish-fit.js')), h3 = hashOf(await run(sc, 'dish-fit-auto', small, 3, 'sonnet55-2026-09-28-dish-fit.js'));
    ok('W3b dish-fit-auto: no pool = pool of 0 = 2 workers = 3 workers (same design)', h0 === h1 && h1 === h2 && h2 === h3, [h0, h1, h2, h3].join(' '));
    const sb = RF.State.deserialize(fsx.readFileSync(pth.join(ROOTX, 'examples', 'sealed-beam-7in-low.json'), 'utf8')), tuneSet = { tune: true, tuneEvals: 6, tuneRays: 20000, tuneSeconds: 0 };
    const b0 = await run(sb, 'sealed-beam-v1', tuneSet, null), b1 = await run(sb, 'sealed-beam-v1', Object.assign({ tuneGpu: true }, tuneSet), null), b2 = await run(sb, 'sealed-beam-v1', Object.assign({ tuneAim: 'frozen' }, tuneSet), null);
    ok('W3b sealed-beam tuner: tuneGpu without a GPU = the default tuner (same surfaces)', hashOf(b0) === hashOf(b1), hashOf(b0) + ' vs ' + hashOf(b1));
    ok('W3b sealed-beam tuner: tuneAim frozen runs and reports its traces', b2.notes.some((n) => /^tuner: \d+ traces/.test(n)) && b2.surfaces.length > 0, b2.notes[0].slice(0, 100));
  }
  // D3: deterministic moving traffic, rigid cars, the existing lighting path and once-per-driver glare count.
  {
    const DA = RF.DriveAnim, D = RF.Drive, flags = { posts: false, veg: false, people: false, animals: false, signs: false, rpm: false };
    const opts = { wild: true, seed: 7, density: 0.5, trafficDensity: 2, oncoming: true, preceding: true, onKcd: 30 };
    const src = DA.source('road', 3.5, false, flags, opts), cars = DA.trafficCars(src, 0, 0), J = JSON.stringify;
    const off = DA.source('road', 3.5, false, flags, Object.assign({}, opts, { oncoming: false, preceding: false }));
    ok('D3a both lanes spawn deterministically; seed changes the traffic, toggles leave scenery unchanged', cars.some((c) => c.kind === 'oncoming') && cars.some((c) => c.kind === 'preceding') && J(cars) === J(DA.trafficCars(DA.source('road', 3.5, false, flags, opts), 0, 0)) && J(cars) !== J(DA.trafficCars(DA.source('road', 3.5, false, flags, Object.assign({}, opts, { seed: 8 })), 0, 0)) && J(src.chunk(0)) === J(off.chunk(0)) && !DA.trafficCars(off, 0, 0).length, J(cars));
    let motion = true;
    for (const c of cars) {
      const next = DA.trafficCars(src, 10, 1).find((n) => n.id === c.id);
      if (!next) continue;
      const delta = -10 + (c.kind === 'oncoming' ? -50 : 40) / 3.6;
      motion = motion && Math.abs(next.rel - c.rel - delta) < 1e-12 && next.off === (c.kind === 'oncoming' ? 3.5 : 0);
    }
    ok('D3b oncoming closing speed = ours + theirs; preceding = relative speed, each in its lane', motion);
    let low = 0, high = 0, bounded = true;
    for (const density of [0, 0.5, 3]) {
      const s = DA.source('road', 3.5, false, flags, Object.assign({}, opts, { trafficDensity: density })); let n = 0;
      for (let i = 0; i < 100; i++) { const cs = DA.trafficCars(s, i * 137.3, i * 3); n += cs.length; bounded = bounded && cs.length <= 6 && cs.every((c) => c.rel >= -6 && c.rel <= 230); }
      if (!density) ok('D3c zero density suppresses both lanes', n === 0);
      if (density === 0.5) low = n; if (density === 3) high = n;
    }
    ok('D3c higher density yields more cars; generation stays bounded far along the road', high > low && bounded && DA.trafficCars(src, 1e8, 1e7).length <= 6, 'cars across 100 samples: ' + low + ' / ' + high);
    const A = RF.Road.arc(150, 'left'), sample = [{ id: 'oncoming:0', kind: 'oncoming', rel: 55, off: 3.5 }], a = DA.trafficObjects(src, sample, null), b = DA.trafficObjects(src, sample, A);
    let rigid = true; for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) rigid = rigid && Math.abs(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) - Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y)) < 1e-12;
    ok('D3d car bodies, lamps and plates stay rigid on a bend; headlamps face the driver', rigid && b.filter((o) => o.emit).length === 2 && b.filter((o) => o.emit).every((o) => Math.abs(o.nx + Math.cos(55 / 150)) < 1e-12));
    const lamps = [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut = D.lutFrom(() => 30000), p = { w: 160, h: 90, hfov: 60, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src };
    // Compare to Road.model.lux on the same tabulated beam; this independently checks angle conventions, inverse-square loss and incidence on bends.
    let worst = 0;
    for (const conv of ['A', 'B', 'S']) for (const arc of [null, A, RF.Road.arc(250, 'right')]) for (const rel of [15, 50, 100]) {
      const car = { rel, off: 3.5 }, q = arc ? arc.at(rel, 3.5) : { p: [rel, 3.5], t: [1, 0] };
      const mdl = RF.Road.model({ road: { mountH: 0.7, spacing: 1.4, two: true }, conv, I: (h, v) => D.lutAt(lut, h, v) });
      const ref = mdl.lux([q.p[0], q.p[1], 1.1], [q.t[0], q.t[1], 0]), got = DA.eyeLux(Object.assign({}, p, { A: arc, conv }), car); worst = Math.max(worst, Math.abs(ref - got));
    }
    ok('D3e eye lux matches the road model at 1.1 m (27 cases: A/B/S, straight/left/right)', worst < 1e-10, 'worst absolute lux difference ' + worst);
    const flashBeam = Object.assign({}, p, { lut: D.lutFrom(() => 1000) }), flash = DA.flashState(), near = cars.find((c) => c.kind === 'oncoming'), d = near.rel - 30;
    const dark = Object.assign({}, p, { lut: D.lutFrom(() => 0) }); DA.countFlashes(flash, dark, d, 0);
    ok('D3f unlit eye does not count; a lit eye counts only once across repeated frames', flash.n === 0 && DA.countFlashes(flash, flashBeam, d, 0) === 1 && DA.countFlashes(flash, flashBeam, d, 0) === 1);
    const next = DA.trafficCars(src, d + 150, 0).find((c) => c.kind === 'oncoming'); DA.countFlashes(flash, flashBeam, d + 150 + next.rel - 30, 0);
    ok('D3f another driver increments the count; passed IDs are pruned; reset starts at zero', flash.n === 2 && flash.seen.size <= 2 && DA.flashState().n === 0);
    // Read actual rendered pixels, with and without emitters and our beam (no proxy score).
    for (const kind of ['oncoming', 'preceding']) {
      const objs = DA.trafficObjects(src, [{ id: kind + ':sample', kind, rel: 35, off: kind === 'oncoming' ? 3.5 : 0 }], null);
      const image = (obs, beam) => D.render({ w: 320, h: 180, ss: 2, hfov: 60, eye: DA.EYE, lamps, lut: beam, lane: 3.5, scene: { objects: obs, markings: [] } }).rgb;
      const lit = image(objs, dark.lut), unlit = image(objs.map((o) => Object.assign({}, o, { emit: [0, 0, 0] })), dark.lut), body = image(objs.map((o) => Object.assign({}, o, { emit: [0, 0, 0] })), lut);
      let emission = 0, reflected = 0, r = 0, g = 0; for (let i = 0; i < lit.length; i++) { emission += lit[i] - unlit[i]; reflected += body[i] - unlit[i]; if (i % 3 === 0) r += lit[i]; if (i % 3 === 1) g += lit[i]; }
      ok('D3g ' + kind + ': visible emitters and body lit by our beam' + (kind === 'preceding' ? '; tail light pixels are red' : ''), emission > 0 && reflected > 0 && (kind !== 'preceding' || r > 10 * g), 'emitted RGB sum ' + emission.toFixed(3) + ', beam-lit RGB sum ' + reflected.toFixed(3));
    }
    // Assemble real tracer jobs across successive moving frames. This is the worker entry point, including nonzero t and both lamp types.
    let parity = true, n = 0;
    for (const name of ['road', 'forest', 'city']) {
      const sc = DA.source(name, 3.5, false, flags, opts), pp = Object.assign({}, p, { src: sc, A }), T = DA.tracer();
      T.cfg({ id: 3, p: { w: p.w, h: p.h, hfov: p.hfov, lamps, lut, conv: 'A', lane: 3.5, look: p.look }, arc: { R: A.R, dir: A.dir }, src: [name, 3.5, false, flags, opts] });
      for (const [seq, dist, t] of [[1, 0, 0], [2, 50, 2], [3, 95, 5]]) {
        const ref = new Float32Array(4 * p.w * p.h), got = new Float32Array(ref.length); DA.objects(pp, dist, ref, 1, null, null, null, t);
        for (let c = 0; c < 5; c++) { const job = T.job({ seq, dist, t, ss: 1, act: [], c, K: 5, wid: 0 }), f = new Float32Array(job.buf, 0, job.len); let off = 0; for (const ty of job.trows) { const y = ty * 16, len = (Math.min(p.h, y + 16) - y) * p.w * 4; got.set(f.subarray(off, off + len), y * p.w * 4); off += len; } }
        for (let i = 0; i < ref.length; i++) if (ref[i] !== got[i]) parity = false; n++;
      }
    }
    ok('D3h both traffic lanes through worker jobs = page trace bit for bit across moving frames in road, forest, city', parity, n + ' frames');
  }
  // D4: route geometry, moving markings/lights, traffic gap, and full-frame worker rows.
  {
    const A = RF.DriveAnim, D = RF.Drive, flags = { posts: false, veg: false, signs: false, people: true, animals: true, rpm: false }, J = JSON.stringify;
    const opts = { tiles: true, seed: 7, wild: true, density: 0.5, oncoming: true, preceding: true, trafficDensity: 2, streetLamps: 'sodium' };
    const recipe = (seed) => Array.from({ length: 160 }, (_, k) => A.roadTile(seed, k));
    const kinds = new Set(recipe(7).map((t) => t.kind));
    ok('D4a seed repeats every tile recipe and changes the route; all eight tile types occur', J(recipe(7)) === J(recipe(7)) && J(recipe(7)) !== J(recipe(8)) && A.TILE_KINDS.every((k) => kinds.has(k)), [...kinds].join(', '));
    let worst = 0, seam = 0;
    for (const dist of [0, 49.999, 50, 150, 199.999, 200, 250, 350, 400, 1e8]) {
      const r = A.tileRoute(7, dist);
      for (let s = -5; s < 230; s += 11) for (const o of [-2, 0, 4]) { const q = r.at(s, o), f = r.frame(...q.p); worst = Math.max(worst, Math.abs(f.s - s), Math.abs(f.off - o)); }
      const q = r.at(0, 0); worst = Math.max(worst, Math.hypot(...q.p), Math.abs(q.t[0] - 1), Math.abs(q.t[1]));
    }
    for (let k = 0; k < 30; k++) for (const u of [0, 50, 150, 200]) {
      const s = k * 200 + u, r = A.tileRoute(7, s - 70), a = r.at(70 - 1e-6, 0), b = r.at(70 + 1e-6, 0);
      seam = Math.max(seam, Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]), Math.hypot(a.t[0] - b.t[0], a.t[1] - b.t[1]));
    }
    // When the route window advances, its camera basis changes continuously, rather than resetting the global heading.
    const before = A.tileRoute(7, 199.999), after = A.tileRoute(7, 200.001), centre = before.at(0.002, 0), q = before.at(100.002, 3), ref = after.at(100, 3);
    const dx = q.p[0] - centre.p[0], dy = q.p[1] - centre.p[1];
    const drift = Math.hypot(dx * centre.t[0] + dy * centre.t[1] - ref.p[0], -dx * centre.t[1] + dy * centre.t[0] - ref.p[1]);
    ok('D4b route inverse, camera origin and all bend/tile joins are continuous, including window changes and long routes', worst < 1e-7 && seam < 2.1e-6 && drift < 1e-7, J({ worst, seam, drift }));
    const p = { w: 128, h: 72, hfov: 60, lamps: [[0, 0.7, 0.7], [0, -0.7, 0.7]], lut: D.lutFrom(() => 30000), conv: 'A', lane: 3.5, look: { RL: 0.2, ambient: 0 }, A: null };
    const make = (name, extra) => Object.assign({}, p, { src: A.source(name, 3.5, false, flags, Object.assign({}, opts, extra)) });
    const find = (kind) => recipe(7).find((t) => t.kind === kind);
    for (const kind of ['intersection', 't-junction']) {
      const tile = find(kind), dist = tile.s0 + 40, clock = (50 - tile.phase) % 50, pp = make('road'), red = A.tileWorld(pp, dist, clock), green = A.tileWorld(pp, dist, clock + 30), amber = A.tileWorld(pp, dist, clock + 48);
      const c = red.crossings.find((c) => c.s0 > 40 && c.s0 < 70), light = (w) => w.objects.filter((o) => o.cls === 'signal' && o.emit && o.emit.some((v) => v > 0));
      ok('D4c ' + kind + ': ground openings, moving crossing/stop paint, lane gaps, and one lit signal head per junction', !!c && red.markings.filter((m) => m.pat && m.pat.period === 1e9).length >= 15 && red.markings.some((m) => m.skip && m.skip.length) && light(red).some((o) => o.emit[0] > 1e4) && light(green).some((o) => o.emit[1] === 8000) && light(amber).some((o) => o.emit[1] === 5000) && (kind !== 't-junction' || (c.o0 === -1.75 || c.o1 === 5.25)));
      const redActor = red.objects.filter((o) => o.tile === tile.k && o.cls === 'person'), greenActor = green.objects.filter((o) => o.tile === tile.k && o.cls === 'person');
      const offActor = A.tileWorld(Object.assign({}, p, { src: A.source('road', 3.5, false, Object.assign({}, flags, { people: false }), opts) }), dist, clock).objects.filter((o) => o.tile === tile.k && o.cls === 'person');
      ok('D4d ' + kind + ': red spawns a crossing person, green and people-off remove them; pause is deterministic', redActor.length > 0 && !greenActor.length && !offActor.length && J(redActor) === J(A.tileWorld(pp, dist, clock).objects.filter((o) => o.tile === tile.k && o.cls === 'person')));
      const moved = A.tileWorld(pp, dist + 1, clock).crossings.find((n) => Math.abs(n.s0 - (c.s0 - 1)) < 1e-8);
      ok('D4d ' + kind + ': markings move one metre with one metre of travel', !!moved);
    }
    const urban = find('urban'), sd = urban.s0 + 15, warm = A.tileWorld(make('road'), sd, 0), cool = A.tileWorld(make('road', { streetLamps: 'led' }), sd, 0), off = A.tileWorld(make('road', { streetLamps: 'off' }), sd, 0);
    const positions = warm.lights.map((L) => warm.A.frame(L.x, L.y).s).filter((s) => s >= 0 && s < 190).sort((a,b) => a-b);
    ok('D4e urban lights every 50 m; warm/LED colours differ, off removes both light and poles', positions.length >= 3 && positions.slice(1).every((s,i) => Math.abs(s - positions[i] - 50) < 1e-7) && warm.lights[0].rgb[2] < cool.lights[0].rgb[2] && !off.lights.length && !off.objects.some((o) => o.cls === 'street-lamp'), J(positions));
    // Read actual side-road surface pixels, including the T's closed side; a recipe alone cannot verify the ground renderer.
    const tj = find('t-junction'), tw = A.tileWorld(make('road', { streetLamps: 'off', tex: false }), tj.s0 + 40, 0);
    const surfaceAt = (off) => {
      const q = tw.A.at(60, off), eye = [q.p[0] - 1.2 / Math.tan(Math.PI / 6), q.p[1], 1.2];
      const r = D.render({ w: 1, h: 2, hfov: 60, eye, lamps: p.lamps, lut: p.lut, lane: 3.5, arc: tw.A, crossings: tw.crossings, scene: { objects: [], markings: [], verge: ['gravel',1.6,'grass'] } });
      return r.keys[r.mat[1]];
    };
    ok('D4e actual T-junction ground pixels show asphalt on its open side and grass on its closed side', surfaceAt(tj.side * 15) === 'asphalt' && surfaceAt(-tj.side * 15) === 'grass', J([surfaceAt(tj.side * 15), surfaceAt(-tj.side * 15)]));
    // Existing D1 actors must still move in the new route, including bends (not just agree between two stationary traces).
    const moving = make('road');
    for (const kind of ['person','deer']) {
      let found;
      for (let k=0;k<20 && !found;k++) { const a=moving.src.chunk(k).actors.find((a)=>a.kind===kind && a.mode!=='graze'); if(a) found={k,a}; }
      const d=found.k*300+found.a.s0-50, id=found.k+':'+found.a.id;
      const at=(tau)=>A.tileWorld(moving,d,0,(key)=>key===id?tau:0).objects.filter((o)=>o.cls===kind).map((o)=>[o.x,o.y,o.z,o.z0,o.z1]);
      ok('D4e D1 '+kind+' continues moving while placed on tiles', J(at(0))!==J(at(5)), J(found.a));
    }
    // Independent diffuse point-light check on an actual ground pixel. The zero beam excludes all headlamp contributions.
    const light = { x: 4, y: 0, z: 7, cd: 900, rgb: [1, 0.43, 0.1] }, black = D.lutFrom(() => 0);
    const common = { w: 1, h: 2, ss: 1, hfov: 60, eye: A.EYE, lamps: p.lamps, lut: black, lane: 100, mats: { asphalt: { rho: [0.1, 0.1, 0.1], id: 0 } }, scene: { objects: [], markings: [] } };
    const img = D.render(Object.assign({}, common, { pointLights: [light] })), px = A.EYE[0] + A.EYE[2] / Math.tan(Math.PI / 6), py = A.EYE[1], r2 = (px - 4) ** 2 + py ** 2 + 49, expected = 0.1 / Math.PI * 900 * 7 / r2 ** 1.5;
    ok('D4f actual ground RGB equals inverse-square point-light diffuse shading with cosine incidence', Math.abs(img.rgb[3] / expected - 1) < 1e-6 && Math.abs(img.rgb[5] / img.rgb[3] - 0.1) < 1e-6, J({ rgb: Array.from(img.rgb.slice(3)), expected }));
    const K = D.kit({ Lw: 3.5, A: null, rand: () => 0.5 }); K.person(10, 0, 'light');
    const objectImg = (lit) => D.render({ w: 128, h: 72, ss: 1, hfov: 60, eye: A.EYE, lamps: p.lamps, lut: black, lane: 3.5, layer: 'objects', scene: { objects: K.O, markings: [] }, pointLights: lit ? [{ x: 6, y: 0, z: 7, cd: 900, rgb: [1,1,1] }] : [] }).rgb;
    const lit = objectImg(true), unlit = objectImg(false); let diff = 0; for (let i=0;i<lit.length;i++) diff += lit[i] - unlit[i];
    ok('D4f street light illuminates actual object pixels with the headlamp beam off', diff > 0 && unlit.every((v) => v === 0), 'summed added object RGB ' + diff);
    const safe = make('road'), legacy = make('road', { safeGap: false }); let guarded = true, caught = false;
    for (const speed of [5, 50, 130]) { safe.src.traffic.speed = speed; for (let t = 0; t < 2000; t += 3.7) {
      const d = t * speed / 3.6, min = Math.max(25, 2 * speed / 3.6);
      guarded = guarded && A.trafficCars(safe.src, d, t).every((c) => c.kind !== 'preceding' || c.rel >= min);
      caught = caught || A.trafficCars(legacy.src, d, t).some((c) => c.kind === 'preceding' && c.rel < 5);
    } }
    ok('D4g default gap guard prevents driving through slower cars at 5/50/130 km/h; off restores legacy close passes', guarded && caught);
    // Real worker entry point: every row once, partial last row, actors and both lanes, successive positions and a live speed change.
    let parity = true, frames = 0;
    for (const name of ['road', 'forest', 'city', 'intersection']) {
      const pp = make(name), T = A.tracer(); T.cfg({ id: 4, p, arc: null, src: [name, 3.5, false, flags, opts] });
      for (const [seq, dist, t, speed] of [[1, 40, 0, 50], [2, 1060, 13, 130], [3, 1860, 30, 5]]) {
        const act = new Map(); A.activate(pp.src, dist, t, act); const tau = (id) => act.has(id) ? t - act.get(id) : 0;
        pp.src.traffic.speed = speed; const ref = new Float32Array(4*p.w*p.h), got = new Float32Array(ref.length); A.objects(pp, dist, ref, 1, tau, null, null, t);
        for (let c=0;c<4;c++) { const job=T.job({seq,dist,t,speed,ss:1,act:[...act],c,K:4,wid:0}), f=new Float32Array(job.buf,0,job.len); let off=0;
          for (const ty of job.trows) { const y=ty*16, len=(Math.min(p.h,y+16)-y)*p.w*4; got.set(f.subarray(off,off+len),y*p.w*4); off+=len; }
        }
        parity = parity && ref.every((v,i) => Number.isFinite(v) && v===got[i]) && got.every((v,i) => i%4!==3 || v===1); frames++;
      }
    }
    ok('D4h complete worker frames = main-thread pixels bit for bit across all four scenes, moving tiles, lamps, signals, traffic and actors', parity, frames + ' frames');
    // Compare actual old code, rather than two paths through the new implementation. No browser, timing or generated baseline values.
    const vm = require('vm'), cp = require('child_process'), ctx = vm.createContext({ performance });
    for (const f of ['core','road','drive','drive-scenes','drive-anim']) vm.runInContext(cp.execFileSync('git', ['show', '4bae491:js/'+f+'.js'], { encoding: 'utf8' }), ctx);
    const old=ctx.RF.DriveAnim, oldD=ctx.RF.Drive; let identical=true, compared=0;
    for (const name of ['road','forest','city']) for (const bend of [null, RF.Road.arc(250,'right')]) for (const dist of [0,37.3,111.7]) for (const traffic of [false,true]) {
      const o={wild:true,seed:7,density:0.5,safeGap:false,tiles:false,oncoming:traffic,preceding:traffic}, now=Object.assign({},p,{w:96,h:54,A:bend,src:A.source(name,3.5,false,flags,o)}), then=Object.assign({},now,{src:old.source(name,3.5,false,flags,o)});
      const g=A.ground(now), h=old.ground(then), r=new Float32Array(4*96*54), s=new Float32Array(r.length); A.objects(now,dist,r,1); old.objects(then,dist,s,1);
      const a=A.composeCPU(now,g,r,dist), b=old.composeCPU(then,h,s,dist); identical=identical && a.every((v,i)=>v===b[i]); compared++;
      const scene=D.buildScene(name,{Lw:3.5,A:bend,us:false,seed:7},flags), base=oldD.buildScene(name,{Lw:3.5,A:bend,us:false,seed:7},flags), cam={w:96,h:54,hfov:60,eye:A.EYE,lamps:p.lamps,lut:p.lut,lane:3.5,arc:bend,look:p.look,ss:1};
      const u=D.render(Object.assign({},cam,{scene})).rgb,v=oldD.render(Object.assign({},cam,{scene:base})).rgb; identical=identical&&u.every((x,i)=>x===v[i]);
    }
    ok('D4i tiles OFF is pixel-identical to base 4bae491: cached animation and still renderer, road/forest/city, straight/bend', identical, compared+' displaced worlds');
  }
  process.exitCode = fails ? 1 : 0;
})();
