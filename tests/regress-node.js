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
  process.exitCode = fails ? 1 : 0;
})();
