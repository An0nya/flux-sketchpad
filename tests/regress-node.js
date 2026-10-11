// Regression checks for fixed QA groups (headless): node tests/regress-node.js — exits 1 on failure.
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
  process.exitCode = fails ? 1 : 0;
})();
