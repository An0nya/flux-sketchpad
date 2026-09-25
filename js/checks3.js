/* checks3.js — check 14 (controls are wired, through the controller path the DOM uses) and extra
 * relation checks: reorder / save-load / mirror / ray-doubling invariance, R = 0 and one-facet
 * limits, one surface built two ways, project-wide scan for the unseeded RNG, and the
 * performance measurement.                                                                    */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const { add } = RF.Checks;
  const { bare, prep } = RF.Checks.helpers;
  const C = RF.Controller;

  // ---------------------------------------------------------------- 14. controls wired
  const PAIRS = {
    rays: [2000, 3000], bounces: [1, 3], floor: [1, 95], seed: [1, 7],
    'src.w': [2, 3], 'src.h': [2, 3], 'src.radius': [1, 1.5], 'src.length': [4, 6], 'src.sigma': [20, 40], 'src.half': [30, 60],
    'src.az': [0, 25], 'src.el': [90, 70], 'src.roll': [0, 30], 'src.x': [0, -3], 'src.y': [0, 3], 'src.z': [0, 2], 'src.power': [1000, 2000],
    'env.keep': [12, 18], 'env.hx': [40, 30], 'env.hy': [45, 30], 'env.hz': [32.5, 25], 'env.cx': [-20, -15], 'env.cy': [0, 5], 'env.cz': [27.5, 5],
    'tgt.dist': [1000, 1500], 'tgt.size': [1000, 800], 'tgt.tiltX': [0, 15], 'tgt.tiltY': [0, 15], 'aim.x': [1000, 1200], 'aim.y': [0, 100], 'aim.z': [0, 100], 'tgt.res': [50, 40],
    'A.budget': [24, 12], 'A.refl': [0.9, 0.6], 'A.req': [0, 90], 'A.brush': [3, 8], 'A.strength': [1, 0.3],
    'B.scale': [160, 60], 'B.ap': [10, 16],
    'C.f': [12, 20], 'C.rim': [45, 30], 'C.depth': [30, 60], 'C.theta': [20, 35], 'C.a1': [2, 3], 'C.n': [40, 20], 'C.len': [60, 20], 'C.az': [0, 16],
    'C.refl': [0.9, 0.5], 'C.ior': [1.49, 1.8], 'C.T': [0.96, 0.8],
  };
  const MODE_OVERRIDE = { bounces: 'C' };
  // context so conditional controls are visible and meaningful
  function context(store, id) {
    const sc = store.scene, A = C.actions, set = (k, v) => C.setControl(store, k, v);
    if (id === 'src.sigma') set('src.dist', 'gaussian');
    if (id === 'src.az') set('src.el', 60);                    // azimuth is degenerate at el = 90°
    if (id === 'bounces') sc.modeC.preset.kind = 'cpc';         // multiple bounces matter in a CPC
    if (id === 'src.half') set('src.dist', 'cone');
    if (id === 'src.radius') { set('src.kind', 'planar'); set('src.shape', 'disc'); }
    if (id === 'src.length') { set('src.kind', 'volume'); set('src.shape', 'cylinder'); }
    if (id === 'env.axis') set('env.shape', 'cylinder');
    if (id.startsWith('aim.')) set('tgt.linked', false);
    if (sc.mode === 'B') { const st = A.addStamp(store, 100, 50); sc.modeB.selected = st.id; }
    if (sc.mode === 'C') {
      if (id === 'C.depth') sc.modeC.preset.kind = 'ellipse';
      if (id === 'C.theta' || id === 'C.a1') sc.modeC.preset.kind = 'cpc';
      A.applyPreset(store);
      if (id === 'C.len') set('C.sweep', 'extrude');
      if (id === 'C.ior' || id === 'C.T') { set('C.inter', 'refract'); A.setProfile(store, [[0, 30], [15, 30], [15, 33], [0, 40]]); }  // closed lens
    }
  }
  // what the control does after being set, on the UI path (brush → a stroke, link → a move)
  function after(store, id) {
    const A = C.actions;
    if (id === 'A.brush' || id === 'A.strength') A.paintAt(store, 300, 200);
    if (id === 'A.erase') A.paintAt(store, 0, 0);
    if (id === 'tgt.linked') C.setControl(store, 'tgt.dist', 1300);
    if (id === 'B.dir') {                          // manual keeps the current direction; the user then drags the picker
      store.commit();
      const st = C.selStamp(store);
      if (st && st.dirMode === 'manual') { st.th = st.th + 15; store.invalidate(['B']); }
    }
  }
  function valuesFor(c, store) {
    if (PAIRS[c.id]) return PAIRS[c.id];
    if (c.type === 'check') return [false, true];
    if (c.type === 'select') {
      const opts = c.options.map((o) => o[0]).filter((v) => !c.optionFilter || c.optionFilter(store, v));
      return [opts[0], opts[1]];
    }
    const v = c.get(store); return [v, v * 1.3 + 1];
  }
  function signature(store) {
    const r = C.simulate(store, store.scene.sim.rays);
    const f = RF.Feasibility.analyze(store.scene, { designReport: store.reports.A });
    const E = r.ctx.E;
    return { grid: r.hash, stats: [E.intercepted, E.escaped, E.absorbed, E.backface, E.truncated].map((x) => x.toFixed(9)).join('|'), report: f.items.map((i) => i.key + ':' + i.ratio.toFixed(6)).join('|') };
  }
  function baseStore(mode) {
    // each mode is tested with its own optics in view: for B and C the Mode A reflector is
    // switched off (it would otherwise shadow the directions they use)
    const sc = RF.State.testScene(); sc.mode = mode; sc.modeA.budget = 24;
    const st = C.createStore(sc); C.regenerateA(st);
    if (mode !== 'A') st.scene.groups.A.enabled = false;
    return st;
  }
  function wiringSweep(opts) {
    opts = opts || {};
    const bases = {};
    const results = [];
    for (const c of C.CONTROLS) {
      if (opts.only && !opts.only.includes(c.id)) continue;
      const mode = MODE_OVERRIDE[c.id] || c.modes[0];
      if (!bases[mode]) bases[mode] = RF.U.deepCopy(baseStore(mode).scene);
      const sig = [];
      const vals = valuesFor(c, (() => { const s = C.createStore(RF.U.deepCopy(bases[mode])); context(s, c.id); return s; })());
      for (const v of vals) {
        const store = C.createStore(RF.U.deepCopy(bases[mode]));
        context(store, c.id); store.commit({ forceA: c.groups.includes('A') });
        C.setControl(store, c.id, v);
        after(store, c.id);
        store.commit({ forceA: store.dirty.has('A') });
        sig.push(signature(store));
      }
      const gridDiff = sig[0].grid !== sig[1].grid, statDiff = sig[0].stats !== sig[1].stats, repDiff = sig[0].report !== sig[1].report;
      // Check 14: each mode's primary controls must change the GRID; every other control must change
      // some output (grid, energy tallies, or the feasibility report)
      const pass = c.primary ? gridDiff : (gridDiff || statDiff || repDiff);
      results.push({ id: c.id, mode, primary: !!c.primary, values: vals, pass, how: gridDiff ? 'grid hash' : statDiff ? 'energy tallies' : repDiff ? 'feasibility report' : 'NO CHANGE', h: [sig[0].grid, sig[1].grid] });
    }
    return results;
  }
  add(14, 'Controls are wired: every control, set to two values through the UI\'s own setter, changes the output', () => {
    const res = wiringSweep();
    const bad = res.filter((r) => !r.pass);
    const byMode = {}; for (const r of res) byMode[r.mode] = (byMode[r.mode] || 0) + 1;
    return {
      pass: bad.length === 0,
      detail: res.length + ' controls tested (' + Object.entries(byMode).map(([m, n]) => 'mode ' + m + ': ' + n).join(', ') + '). Primary per mode (must change the grid hash): ' + res.filter((r) => r.primary).map((r) => r.id + (r.pass ? ' ✓' : ' ✗')).join(', ') + '. All: ' + res.filter((r) => r.how === 'grid hash').length + ' change the grid hash, ' + res.filter((r) => r.how === 'energy tallies').length + ' only the energy tallies (' + res.filter((r) => r.how === 'energy tallies').map((r) => r.id).join(', ') + '), ' + res.filter((r) => r.how === 'feasibility report').length + ' only the feasibility report (' + res.filter((r) => r.how === 'feasibility report').map((r) => r.id).join(', ') + ').' + (bad.length ? ' FAILED: ' + bad.map((r) => r.id + ' ' + JSON.stringify(r.values) + ' → ' + r.how).join(', ') : ''),
      metrics: { results: res },
    };
  }, { slow: true });

  // ---------------------------------------------------------------- extras
  function designedStore() { const st = C.createStore(RF.State.testScene()); C.regenerateA(st); return st; }
  add(16, 'Invariance: reordering the surface list gives a byte-identical grid', () => {
    const st = designedStore(); const sc = st.scene;
    sc.lenses = [{ id: 'l1', kind: 'biconvex', params: Object.assign(RF.Lenses.defaults('biconvex'), { axisMode: 'z', f: 30, a: 8 }) }];
    sc.groups.L.surfaces = RF.Lenses.buildAll(sc).surfaces; sc.sim.bounces = 3;
    const h1 = RF.Engine.gridHash(RF.Engine.runSync(prep(sc), 20000));
    const h2 = RF.Engine.gridHash(RF.Engine.runSync(prep(RF.State.reorderScene(sc)), 20000));
    return { pass: h1 === h2, detail: 'original ' + h1 + ', reversed surface order ' + h2 + '.', metrics: {} };
  });
  add(17, 'Equivalence: save → load reproduces the grid exactly', () => {
    const st = designedStore();
    st.scene.modeB.stamps = [RF.ModeB.newStamp(st.scene, -200, 100, 120)]; st.invalidate(['B']); st.commit();
    const h1 = RF.Engine.gridHash(RF.Engine.runSync(prep(st.scene), 20000));
    const json = RF.State.serialize(st.scene);
    const back = RF.State.deserialize(json);
    const h2 = RF.Engine.gridHash(RF.Engine.runSync(prep(back), 20000));
    return { pass: h1 === h2, detail: 'before ' + h1 + ', after JSON round trip (' + (json.length / 1024).toFixed(0) + ' KB) ' + h2 + '.', metrics: {} };
  });
  add(18, 'Symmetry: mirroring the scene mirrors the pattern', () => {
    const st = designedStore(); const sc = st.scene;
    sc.groups.M.surfaces = [RF.Checks.helpers.plane('asym', [-15, 25, 30], [0.2, -1, -0.4], 8)];
    const N = 100000;
    const a = RF.Engine.runSync(prep(sc), N), b = RF.Engine.runSync(prep(RF.State.mirrorSceneY(sc)), N);
    const res = a.P.res, ga = RF.Engine.gridTotal(a), gb = RF.Engine.gridTotal(b);
    const bs = 5, nb = res / bs; let worst = 0, sa = 0, sb = 0;
    for (const x of ga) sa += x; for (const x of gb) sb += x;
    const e0 = sc.source.power / N;
    for (let J = 0; J < nb; J++) for (let I = 0; I < nb; I++) {
      let pa = 0, pb = 0;
      for (let j = J * bs; j < J * bs + bs; j++) for (let i = I * bs; i < I * bs + bs; i++) { pa += ga[j * res + i]; pb += gb[j * res + (res - 1 - i)]; }
      const na = pa / e0, nbb = pb / e0, se = Math.sqrt(Math.max(1, na + nbb));          // Poisson
      worst = Math.max(worst, Math.abs(na - nbb) / se);
    }
    const ma = RF.Checks.helpers.moments(ga, res, a.P.T.half), mb = RF.Checks.helpers.moments(gb, res, a.P.T.half);
    return { pass: worst < 4.5, detail: 'u-centroid ' + ma.mu.toFixed(2) + ' mm vs mirrored ' + mb.mu.toFixed(2) + ' mm (v ' + ma.mv.toFixed(2) + ' / ' + mb.mv.toFixed(2) + '); worst 5×5-block difference after flipping u = ' + worst.toFixed(2) + ' σ (tol 4.5 σ over 100 blocks). Pattern includes a deliberately asymmetric extra mirror.', metrics: { worst } };
  });
  add(19, 'Invariance: doubling the ray count changes noise, not the distribution', () => {
    const st = designedStore(); const sc = st.scene;
    const a = RF.Engine.runSync(prep(sc), 40000), b = RF.Engine.runSync(prep(sc), 80000);
    const res = a.P.res, ga = RF.Engine.gridTotal(a), gb = RF.Engine.gridTotal(b);
    const ea = sc.source.power / 40000, eb = sc.source.power / 80000, bs = 5, nb = res / bs; let worst = 0;
    for (let J = 0; J < nb; J++) for (let I = 0; I < nb; I++) {
      let pa = 0, pb = 0;
      for (let j = J * bs; j < J * bs + bs; j++) for (let i = I * bs; i < I * bs + bs; i++) { pa += ga[j * res + i]; pb += gb[j * res + i]; }
      // rays in block: ka of 40k, kb of 80k; the first 40k of run b ARE run a (counter-based), so
      // compare run a with the independent second half of run b
      const ka = pa / ea, kb = pb / eb - ka;
      const se = Math.sqrt(Math.max(1, ka + kb));
      worst = Math.max(worst, Math.abs(ka - kb) / se);
    }
    return { pass: worst < 4.5, detail: 'Normalised 5×5-block distributions of 40k rays vs the other 40k of an 80k run: worst block differs by ' + worst.toFixed(2) + ' σ (tol 4.5 σ over 100 blocks). Note the first 40k rays of the 80k run are identical to the 40k run (counter-based streams).', metrics: { worst } };
  });
  add(20, 'Limit: reflectivity 0 ⇒ no reflected light', () => {
    const st = C.createStore(RF.State.testScene());
    C.setControl(st, 'A.refl', 0); st.commit({ forceA: true });
    const r = C.simulate(st, 20000);
    const g = r.ctx.gridR.reduce((a, b) => a + b, 0);
    return { pass: r.ctx.E.reflected === 0 && g === 0 && r.ctx.E.intercepted > 0, detail: 'Intercepted ' + RF.U.fmt(r.ctx.E.intercepted) + ', reflected onto target ' + r.ctx.E.reflected + ', reflected grid sum ' + g + '.', metrics: {} };
  });
  add(21, 'Limit: one facet ⇒ one tile', () => {
    const st = C.createStore(RF.State.testScene());
    st.scene.source.kind = 'point';
    C.setControl(st, 'A.budget', 1); st.commit({ forceA: true });
    const r = C.simulate(st, 50000);
    const res = r.P.res, mask = Array.from(r.ctx.gridR, (x) => (x > 0 ? 1 : 0));
    // 8-connected components of lit cells
    const lab = new Int32Array(res * res).fill(-1); let comps = 0;
    for (let k = 0; k < res * res; k++) {
      if (!mask[k] || lab[k] >= 0) continue; comps++; const q = [k]; lab[k] = comps;
      while (q.length) { const c = q.pop(), i = c % res, j = (c / res) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= res || b >= res) continue; const n = b * res + a; if (mask[n] && lab[n] < 0) { lab[n] = comps; q.push(n); } } }
    }
    return { pass: st.scene.groups.A.surfaces.length === 1 && comps === 1, detail: st.scene.groups.A.surfaces.length + ' facet; its reflected light forms ' + comps + ' connected tile (' + mask.reduce((a, b) => a + b, 0) + ' cells).', metrics: {} };
  });
  add(22, 'Equivalence: the same flat disc built two ways (Mode C revolve vs plane facet) behaves identically', () => {
    const st = C.createStore(bare()); const sc = st.scene; sc.mode = 'C';
    sc.modeC.axisMode = 'x'; sc.modeC.preset = { kind: 'flat', f: 10, rim: 30, n: 1 };
    C.actions.applyPreset(st); st.commit();
    const h1 = RF.Engine.gridHash(RF.Engine.runSync(prep(sc), 50000));
    const alt = RF.U.deepCopy(sc);
    alt.groups.C.surfaces = [{ type: 'plane', id: 'disc', P: [-10, 0, 0], n: [1, 0, 0], clip: { kind: 'disc', r: 30 }, optics: RF.U.deepCopy(sc.groups.C.surfaces[0].optics) }];
    const h2 = RF.Engine.gridHash(RF.Engine.runSync(prep(alt), 50000));
    return { pass: h1 === h2, detail: 'revolved annulus ' + h1 + ' vs plane disc ' + h2 + ' (' + sc.groups.C.surfaces.length + ' revolved surface).', metrics: {} };
  });
  add(23, 'Integrity: the unseeded platform RNG appears nowhere in the project', () => {
    const needle = ['Math', 'random'].join('.');
    if (!RF.nodeEnv) return { pass: null, detail: 'Source scan needs file access — run headless (node tests/headless.js). The in-page engine uses only the seeded counter-based stream.', metrics: {} };
    const { fs, path, root: rootDir } = RF.nodeEnv;
    const hits = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { if (f.startsWith('.')) continue; const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else if (/\.(js|html|css|md|json)$/.test(f) && fs.readFileSync(p, 'utf8').includes(needle)) hits.push(path.relative(rootDir, p)); } };
    walk(rootDir);
    return { pass: hits.length === 0, detail: hits.length ? 'Found in: ' + hits.join(', ') : 'Scanned every .js/.html/.css/.md/.json file: 0 occurrences.', metrics: {} };
  }, { headlessOnly: true });
  add(24, 'Performance: 10,000 rays × ≥200 surfaces × 3 bounces with occlusion (< 500 ms, target 200 ms)', () => {
    const st = C.createStore(RF.State.testScene());
    st.scene.modeA.budget = 190; C.regenerateA(st);
    st.scene.lenses = [{ id: 'l1', kind: 'fresnel', params: Object.assign(RF.Lenses.defaults('fresnel'), { axisMode: 'z', f: 25, a: 12, rings: 12 }) }];
    st.scene.groups.L.surfaces = RF.Lenses.buildAll(st.scene).surfaces;
    st.scene.sim.bounces = 3;
    const P = prep(st.scene);
    RF.Engine.runSync(P, 5000);                                  // warm-up (JIT)
    const times = []; for (let i = 0; i < 5; i++) times.push(RF.Engine.runSync(P, 10000).elapsed);
    times.sort((a, b) => a - b);
    const t100 = RF.Engine.runSync(P, 100000).elapsed;
    const med = times[2];
    return { pass: P.G.n >= 200 && med < 500, detail: P.G.n + ' surfaces, bounce cap ' + P.cap + ': 10k rays median ' + med.toFixed(1) + ' ms (min ' + times[0].toFixed(1) + ', max ' + times[4].toFixed(1) + '); 100k rays ' + t100.toFixed(0) + ' ms. Measured on this machine, this run.', metrics: { med, t100, n: P.G.n } };
  });

  RF.Checks.wiringSweep = wiringSweep;
})(typeof globalThis !== 'undefined' ? globalThis : this);
