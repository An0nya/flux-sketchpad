// Solver interface (headless): node tests/solvers.js — exits 1 on failure.
// 1. spoke via the registry is byte-identical to calling modeA directly  2. conformance for every
// registered solver  3. the host verifier catches bad output (negative controls: a checker that
// can't fail proves nothing)
const { load } = require('./load.js'); const RF = load(); const E = RF.Engine, C = RF.Controller, S = RF.Solvers;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const scenes = { test: RF.State.testScene(), default: RF.State.defaultScene() };

for (const [name, sc0] of Object.entries(scenes)) {
  const direct = RF.ModeA.generate(RF.U.deepCopy(sc0)).surfaces;
  const st = C.createStore(RF.U.deepCopy(sc0)); C.regenerateA(st);
  const via = st.scene.groups.A.surfaces, h = (s) => E.gridHash(E.runSync(E.prepare(st.scene, s.concat(RF.State.allSurfaces(st.scene).filter((x) => x.group !== 'A'))), 20000));
  ok(name + ' scene: spoke via registry = modeA directly (surfaces JSON + traced grid hash)', JSON.stringify(direct) === JSON.stringify(via) && h(direct) === h(via), via.length + ' surfaces');
}

for (const def of S.list()) {
  for (const [name, sc0] of Object.entries(scenes)) {
    if (!def.modes.includes('paint')) continue;
    const sc = RF.U.deepCopy(sc0); sc.solve = { id: def.id };
    const input = S.inputOf(sc), frozen = JSON.stringify(input), settings = S.settingsOf(sc, def.id);
    const a = def.solve(input, settings, { progress() {}, budget: {}, trace: (s, o) => S.trace(sc, s, o) });
    const b = def.solve(S.inputOf(sc), settings, { progress() {}, budget: {}, trace: (s, o) => S.trace(sc, s, o) });
    const f = S.verify(sc, a);
    ok(def.id + ' / ' + name + ': deterministic', JSON.stringify(a.surfaces) === JSON.stringify(b.surfaces) && JSON.stringify(a.intent) === JSON.stringify(b.intent));
    ok(def.id + ' / ' + name + ': valid, inside envelope + keep-out, intent well-formed', !f.errors.length && !f.violations.envelope.length && !f.violations.keepOut.length && !f.intentErrors.length,
      f.placed + ' placed' + (f.dropped !== null ? ', ' + f.dropped + ' unplaced intents' : '') + (f.errors[0] || f.violations.envelope.length ? ' · ' + (f.errors[0] || 'outside: ' + f.violations.envelope.slice(0, 3)) : ''));
    const mutated = JSON.stringify(input) !== frozen;
    ok(def.id + ' / ' + name + ': input copy is the solver\'s to mutate; the scene is untouched', JSON.stringify(sc.modeA.paint) === JSON.stringify(sc0.modeA.paint), mutated ? '(it mutated its copy — allowed)' : '');
  }
}

// metadata round-trip: what was solved is saved with the scene and re-solving reproduces it
{ const st = C.createStore(RF.State.testScene()); C.regenerateA(st);
  const saved = JSON.parse(JSON.stringify(st.scene)), st2 = C.createStore(saved); C.regenerateA(st2);
  ok('scene.solve round-trips and re-solving reproduces the geometry', JSON.stringify(saved.solve) === JSON.stringify(st2.scene.solve) && JSON.stringify(st.scene.groups.A.surfaces) === JSON.stringify(st2.scene.groups.A.surfaces), JSON.stringify(saved.solve)); }

// keep-out split: an old file (keep-out only) loads into the same geometry — clearance ≤ CLEAR_MAX + min distance
for (const k of [15, 3]) {
  const old = RF.State.defaultScene(); old.envelope.keepOut = k; delete old.modeA.minDistance; delete old.modeB.minDistance;
  const loaded = RF.State.deserialize(JSON.stringify(old)), a = RF.ModeA.generate(RF.U.deepCopy(old)).surfaces, b = RF.ModeA.generate(RF.U.deepCopy(loaded)).surfaces;
  ok('old keep-out ' + k + ' mm → clearance ' + loaded.envelope.keepOut + ' + min distance ' + loaded.modeA.minDistance + ': identical geometry', JSON.stringify(a) === JSON.stringify(b) && loaded.envelope.keepOut <= RF.State.CLEAR_MAX, a.length + ' facets');
}

// one solver environment: a fresh context loading ONLY js/solver-env.js's list (what the browser worker loads)
// has everything SOLVER_API.md promises; and the browser worker really does load that list
{ const vm = require('vm'), fs = require('fs'), path = require('path'), root = path.join(__dirname, '..'), ctx = vm.createContext({ console });
  const js = (f) => vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f });
  js('solver-env'); for (const f of ctx.RF_SOLVER_ENV) js(f);
  const R = ctx.RF, need = ['V', 'Geo', 'Source', 'Engine', 'Solver', 'ModeA', 'Photometry', 'Solvers'];
  const missing = need.filter((k) => !R[k]), worker = fs.readFileSync(path.join(root, 'js/solve-worker.js'), 'utf8');
  ok('solver environment has everything the API lists (incl. Photometry, the default solver, ModeA.plan/build)', !missing.length && !!R.Solvers.get('spoke') && typeof R.ModeA.plan === 'function' && typeof R.ModeA.build === 'function', missing.length ? 'missing ' + missing.join(', ') : ctx.RF_SOLVER_ENV.join(' → '));
  ok('the browser worker loads exactly that list', /importScripts\('solver-env\.js'\)/.test(worker) && /RF_SOLVER_ENV/.test(worker) && !/importScripts\('core\.js'/.test(worker)); }

// trace() reports the app's own definitions: blocked = stats.occlusion.blocked, shadowed = the occlusion pass, peak = photometry
{ const st = C.createStore(RF.State.testScene()); C.regenerateA(st); const sc = st.scene, surfs = sc.groups.A.surfaces;
  const problem = { source: sc.source, target: sc.target, envelope: sc.envelope, sim: sc.sim }, t = S.trace(problem, surfs, { rays: 50000, occlusion: true });
  const P = E.prepare(problem, surfs); P.recordHits = true; const c = E.runSync(P, 50000, 0), o = E.stats(c).occlusion, ph = RF.Photometry.fixture(problem, P, c);
  ok('trace(): blocked, shadowed, peak cd and % of ceiling match the app\'s scoring', t.blocked === o.blocked && t.shadowed === o.shadowed && t.peakCd === ph.peakCd && t.ofCeiling === ph.ofDesign,
    'blocked ' + (100 * t.blocked).toFixed(2) + '%, shadowed ' + (100 * t.shadowed).toFixed(2) + '%, peak ' + Math.round(t.peakCd) + ' cd, ' + (100 * t.ofCeiling).toFixed(1) + '% of ceiling'); }

// RF.ModeA unsealed: build(plan(scene)) = generate(scene); and a solver may edit the plan before building
{ const sc = RF.State.defaultScene(), g = RF.ModeA.generate(RF.U.deepCopy(sc)), b = RF.ModeA.build(RF.ModeA.plan(RF.U.deepCopy(sc)));
  ok('ModeA.build(ModeA.plan(scene)) is identical to ModeA.generate(scene)', JSON.stringify([g.surfaces, g.intent, g.report]) === JSON.stringify([b.surfaces, b.intent, b.report]));
  const p = RF.ModeA.plan(RF.U.deepCopy(sc)); for (const z of p.zones) if (z && !z.empty) z.aim = [z.aim[0] * 0.8, z.aim[1] * 0.8];   // pull every aim 20% toward the centre
  const e = RF.ModeA.build(p), f = S.verify(sc, { surfaces: e.surfaces, intent: e.intent });
  ok('an edited plan builds into valid geometry', !f.errors.length && !f.violations.envelope.length && !f.violations.keepOut.length && JSON.stringify(e.surfaces) !== JSON.stringify(g.surfaces), f.placed + ' placed from the edited plan'); }

// limits are the user's: input.limits carries them; the default solver doesn't declare them; a solver that does
// is recorded (declaresLimits) and its value forced to the limit
{ const sc = RF.State.defaultScene(); sc.modeA.budget = 37; sc.modeA.reflectivity = 0.8; const inp = S.inputOf(sc);
  S.register({ id: 'probe-legacy', name: 'p', version: '0', modes: ['paint'], settings: [{ key: 'budget', type: 'number', default: 5 }, { key: 'minDistance', type: 'number', default: 0 }], solve: () => ({ surfaces: [] }) });
  const lg = S.get('probe-legacy'), st = S.settingsOf(sc, 'probe-legacy'); S.unregister('probe-legacy');
  ok('input.limits = the user\'s cap + reflectivity; spoke declares neither; a declared limit is recorded and forced', inp.limits.maxFacets === 37 && inp.limits.reflectivity === 0.8 && !S.get('spoke').settings.some((f) => S.LIMIT_KEYS.includes(f.key)) && lg.declaresLimits.join() === 'budget' && st.budget === 37, JSON.stringify(inp.limits)); }

// shared settings: a non-default solver reads budget / minDistance / reflectivity from the Paint controls
{ S.register({ id: 'probe-shared', name: 'p', version: '0', modes: ['paint'], settings: [{ key: 'budget', type: 'number', default: 100 }, { key: 'minDistance', type: 'number', default: 0 }, { key: 'reflectivity', type: 'number', default: 0.9 }, { key: 'own', type: 'number', default: 7 }], solve: () => ({ surfaces: [] }) });
  const sc = RF.State.defaultScene(); sc.modeA.budget = 400; sc.modeA.minDistance = 12; sc.modeA.reflectivity = 0.8; sc.solverSettings = { 'probe-shared': { budget: 100, own: 9 } };
  const st = S.settingsOf(sc, 'probe-shared'); S.unregister('probe-shared');
  ok('a loaded solver\'s required settings come from the Paint controls (like-for-like); its own settings stay its own', st.budget === 400 && st.minDistance === 12 && st.reflectivity === 0.8 && st.own === 9, JSON.stringify(st)); }

// negative controls: a lying / sloppy solver
{ const sc = RF.State.testScene(), good = RF.ModeA.generate(RF.U.deepCopy(sc)), f0 = good.surfaces[0];
  const far = RF.U.deepCopy(f0); far.id = 'far'; far.P = [far.P[0] + 5 * sc.envelope.half[0], far.P[1], far.P[2]]; far.clip.pts3 = far.clip.pts3.map((p) => [p[0] + 5 * sc.envelope.half[0], p[1], p[2]]);
  const near = RF.U.deepCopy(f0); near.id = 'near'; const d = RF.V.sub(near.P, sc.source.pos), sh = RF.V.mul(d, -0.999);
  near.P = RF.V.add(near.P, sh); near.clip.pts3 = near.clip.pts3.map((p) => RF.V.add(p, sh));
  const scK = RF.U.deepCopy(sc); scK.envelope.keepOut = 5;
  const v1 = S.verify(sc, { surfaces: [far] }), v2 = S.verify(scK, { surfaces: [near] });
  const v3 = S.verify(sc, { surfaces: [f0, RF.U.deepCopy(f0)] }), v4 = S.verify(sc, { surfaces: [f0], intent: [{ facet: 'ghost', cells: [[0, 1]] }, { facet: null, cells: [[-3, 1]] }] });
  const v5 = S.verify(sc, { surfaces: 'lots' });
  ok('verifier flags a surface outside the envelope', v1.violations.envelope.includes('far'));
  ok('verifier flags a surface inside the keep-out', v2.violations.keepOut.includes('near'));
  // bracket: clearance just under the closest REAL surface point must pass, just over it must flag
  { const sd = RF.State.defaultScene(); sd.modeA.minDistance = 0; const gd = RF.ModeA.generate(RF.U.deepCopy(sd)), G = RF.Geo.compile(gd.surfaces), Sp = sd.source.pos;
    let dmin = Infinity;
    for (let k = 0; k < G.n; k++) for (const poly of RF.Geo.outline(G, k)) {
      for (const q of poly) dmin = Math.min(dmin, RF.V.dist(q, Sp));
      const c = RF.V.mul(poly.reduce((a, q) => RF.V.add(a, q), [0, 0, 0]), 1 / poly.length);
      for (let i = 0; i < poly.length; i++) for (let a = 0; a <= 8; a++) for (let b = 0; a + b <= 8; b++) {
        const q = RF.V.add(c, RF.V.add(RF.V.mul(RF.V.sub(poly[i], c), a / 8), RF.V.mul(RF.V.sub(poly[(i + 1) % poly.length], c), b / 8))), d = RF.V.norm(RF.V.sub(q, Sp));
        const t = RF.Geo.intersect(G.D, G.poly, k, Sp[0], Sp[1], Sp[2], d[0], d[1], d[2], 1e-9, Infinity); if (t >= 0) dmin = Math.min(dmin, t); } }
    const at = (f) => { const x = RF.U.deepCopy(sd); x.envelope.keepOut = dmin * f; return S.verify(x, { surfaces: gd.surfaces }).violations.keepOut.length; };
    ok('keep-out bracket: no false alarm just under the closest real surface point, a flag just over it', at(1 - 1e-4) === 0 && at(1.002) > 0, 'closest real surface ' + dmin.toFixed(4) + ' mm: at −0.01% ' + at(1 - 1e-4) + ' flagged, at +0.2% ' + at(1.002) + ' flagged'); }
  { const sb = RF.U.deepCopy(sc); sb.modeA.budget = 3; const vb = S.verify(sb, { surfaces: good.surfaces.slice(0, 5) }), vok = S.verify(sb, { surfaces: good.surfaces.slice(0, 3) });
    ok('verifier flags more facets than the budget (and not exactly the budget)', vb.violations.budget && vb.violations.budget.placed === 5 && !vok.violations.budget); }
  ok('verifier rejects repeated ids and non-array surfaces', v3.errors.length > 0 && v5.errors.length > 0);
  ok('verifier rejects intent naming an unplaced facet or a bad cell; counts null-facet intents', v4.intentErrors.length === 2 && v4.dropped === 1, v4.intentErrors.join(' | '));
  // a solver that lies in its extras: the host's facts win
  S.register({ id: 'liar', name: 'liar', version: '0', modes: ['paint'], settings: [], solve: () => ({ surfaces: [far], extras: { placed: 999, dropped: 0 } }) });
  const st = C.createStore(RF.U.deepCopy(sc)); st.scene.solve = { id: 'liar' }; const rep = C.regenerateA(st);
  ok('host facts override a solver\'s own claims', rep.placed === 1 && rep.warnings.some((w) => /outside the envelope/.test(w)), 'placed ' + rep.placed + ' (claimed 999); warns: ' + rep.warnings.join(' | ').slice(0, 80));
  let threw = false; try { S.register({ id: 'x', modes: ['paint'], settings: [{ key: 'k', type: 'slider', default: 1 }], solve() {} }); } catch (e) { threw = true; }
  ok('register rejects a malformed settings schema', threw); }
process.exit(fails ? 1 : 0);
