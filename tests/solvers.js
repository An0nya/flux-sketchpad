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
  ok('verifier rejects repeated ids and non-array surfaces', v3.errors.length > 0 && v5.errors.length > 0);
  ok('verifier rejects intent naming an unplaced facet or a bad cell; counts null-facet intents', v4.intentErrors.length === 2 && v4.dropped === 1, v4.intentErrors.join(' | '));
  // a solver that lies in its extras: the host's facts win
  S.register({ id: 'liar', name: 'liar', version: '0', modes: ['paint'], settings: [], solve: () => ({ surfaces: [far], extras: { placed: 999, dropped: 0 } }) });
  const st = C.createStore(RF.U.deepCopy(sc)); st.scene.solve = { id: 'liar' }; const rep = C.regenerateA(st);
  ok('host facts override a solver\'s own claims', rep.placed === 1 && rep.warnings.some((w) => /outside the envelope/.test(w)), 'placed ' + rep.placed + ' (claimed 999); warns: ' + rep.warnings.join(' | ').slice(0, 80));
  let threw = false; try { S.register({ id: 'x', modes: ['paint'], settings: [{ key: 'k', type: 'slider', default: 1 }], solve() {} }); } catch (e) { threw = true; }
  ok('register rejects a malformed settings schema', threw); }
process.exit(fails ? 1 : 0);
