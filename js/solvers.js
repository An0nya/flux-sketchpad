/* solvers.js — the solver interface (DESIGN.md § "Solver interface — spec").
 *
 * A solver is one self-contained file that calls RF.Solvers.register({...}).  It receives the problem as
 * plain data and returns geometry.  Everything that could be gamed — what was placed, whether it fits the
 * envelope, how good the light is — is computed HERE (and in engine/photometry), never taken from the
 * solver's own report.
 *
 *   register({ id, name, version, modes: ['paint'|'stamps'], settings: [field…], solve(input, settings, tools) })
 *     field  = { key, label, type: 'number'|'range'|'select'|'checkbox', min, max, step, options, default, help }
 *     input  = { source, envelope, target, paint: { res, cells }, stamps, seed }   (deep copy; mutate freely)
 *     tools  = { trace(surfaces, { rays, seed, attribution }), progress(pct), budget: { rays, ms } }
 *     output = { surfaces, intent?: [{ facet: id|null, cells: [[paintCell, weight]…] }], notes?: [..], extras? }
 *   intent is optional, per facet, overlap allowed; facet: null = an intent the solver couldn't place.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const reg = new Map();
  const DEFAULT_ID = 'spoke';
  const TYPES = ['number', 'range', 'select', 'checkbox'];

  function register(def) {
    const bad = (m) => { throw new Error('RF.Solvers.register(' + (def && def.id) + '): ' + m); };
    if (!def || typeof def.id !== 'string' || !def.id) bad('needs a string id');
    if (typeof def.solve !== 'function') bad('needs solve(input, settings, tools)');
    if (!Array.isArray(def.modes) || !def.modes.length || def.modes.some((m) => m !== 'paint' && m !== 'stamps')) bad("modes must list 'paint' and/or 'stamps'");
    for (const f of def.settings || []) if (!f.key || !TYPES.includes(f.type) || f.default === undefined) bad('setting ' + (f.key || '?') + ' needs key, a type in ' + TYPES.join('/') + ' and a default');
    reg.set(def.id, Object.assign({ name: def.id, version: '0', settings: [] }, def));
    return def.id;
  }
  const get = (id) => reg.get(id) || null;
  const unregister = (id) => { if (id !== DEFAULT_ID) reg.delete(id); };
  const list = () => [...reg.values()];
  function defaults(def) { const o = {}; for (const f of def.settings) o[f.key] = f.default; return o; }
  // clamp / coerce a settings object to the schema (unknown keys dropped, missing → default)
  function sanitize(def, s) {
    const o = {};
    for (const f of def.settings) {
      let v = s && s[f.key] !== undefined ? s[f.key] : f.default;
      if (f.type === 'number' || f.type === 'range') { v = +v; if (!isFinite(v)) v = f.default; if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); }
      else if (f.type === 'checkbox') v = !!v;
      else if (f.type === 'select' && f.options && !f.options.some((op) => (op.value !== undefined ? op.value : op) === v)) v = f.default;
      o[f.key] = v;
    }
    return o;
  }

  // Which solver a scene uses, and its settings.  The default solver's settings live in scene.modeA
  // (its sidebar controls predate the registry); any other solver's in scene.solverSettings[id].
  function current(scene) { const id = (scene.solve && scene.solve.id) || DEFAULT_ID; return get(id) ? id : DEFAULT_ID; }
  // The required settings are SHARED: every solver reads them from the scene's Paint controls, so switching
  // solvers compares like with like.  A solver's other settings live in scene.solverSettings[id].
  const SHARED = ['budget', 'minDistance', 'reflectivity', 'facetType'];
  const sharedOf = (scene) => ({ budget: scene.modeA.budget, minDistance: scene.modeA.minDistance || 0, reflectivity: scene.modeA.reflectivity, facetType: scene.modeA.facetType });
  function settingsOf(scene, id) {
    const def = get(id), own = (scene.solverSettings && scene.solverSettings[id]) || {}, sh = sharedOf(scene), o = Object.assign({}, own);
    for (const k of SHARED) if (def.settings.some((f) => f.key === k)) o[k] = sh[k];
    return sanitize(def, o);
  }
  // the problem half of the scene: all a solver may see
  function inputOf(scene) {
    return RF.U.deepCopy({
      source: scene.source, envelope: scene.envelope, target: scene.target,
      paint: { res: scene.target.res, cells: scene.modeA.paint }, stamps: (scene.modeB && scene.modeB.stamps) || [], seed: scene.sim.seed | 0,
    });
  }

  // Host-owned facts about a solver's output.  errors = the output is unusable; violations = usable but
  // breaks a constraint (reported, never hidden).
  function verify(scene, out) {
    const facts = { errors: [], violations: { envelope: [], keepOut: [], budget: null }, intentErrors: [], placed: 0, dropped: null };
    if (!out || !Array.isArray(out.surfaces)) { facts.errors.push('output.surfaces is not an array'); return facts; }
    const ids = new Set();
    for (const s of out.surfaces) {
      if (!s || !['facet', 'plane', 'rev'].includes(s.type)) { facts.errors.push('surface of unknown type ' + (s && s.type)); continue; }
      if (typeof s.id !== 'string' || ids.has(s.id)) facts.errors.push('surface id missing or repeated: ' + (s && s.id));
      ids.add(s.id);
    }
    if (facts.errors.length) return facts;
    let G;
    try { G = RF.Geo.compile(out.surfaces); } catch (e) { facts.errors.push('surfaces do not compile: ' + e.message); return facts; }
    facts.placed = out.surfaces.length;
    const budget = scene.modeA && scene.modeA.budget;          // the user's facet budget: a limit, never the solver's to change
    if (budget > 0 && facts.placed > budget) facts.violations.budget = { placed: facts.placed, budget };
    const env = scene.envelope, S = scene.source.pos, keep = env.keepOut || 0;
    for (let k = 0; k < G.n; k++) {
      let outE = false, outK = false;
      for (const poly of RF.Geo.outline(G, k)) {
        for (const p of poly) if (!RF.Geo.envInside(env, p, 1e-6 * Math.max(...env.half))) outE = true;   // box is convex: corners suffice for flat patches
        // the keep-out sphere is NOT convex from outside: a patch can dip into it between its edges, so test
        // interior points too.  Sample a fan of triangles from the centroid, then measure on the REAL surface:
        // a ray from the LED through the sample hits the patch at exactly the distance that matters.  A ray
        // that MISSES has no mirror in that direction, so it is not a violation — the flat chord point itself
        // is not part of the mirror (counting it raised false alarms by ~0.01 mm on curved facets; found by
        // benchmark trial 1).  The outline points lie on the surface and are tested directly.
        if (keep > 0) {
          for (const p of poly) if (V.dist(p, S) < keep * (1 - 1e-6)) outK = true;
          const c = V.mul(poly.reduce((a, q) => V.add(a, q), [0, 0, 0]), 1 / poly.length), M = 4;
          for (let i = 0; i < poly.length && !outK; i++) {
            const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
            for (let a = 0; a <= M && !outK; a++) for (let b = 0; a + b <= M; b++) {
              const q = V.add(c, V.add(V.mul(V.sub(p1, c), a / M), V.mul(V.sub(p2, c), b / M))), dq = V.norm(V.sub(q, S));
              const t = RF.Geo.intersect(G.D, G.poly, k, S[0], S[1], S[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
              if (t >= 0 && t < keep * (1 - 1e-6)) { outK = true; break; }
            }
          }
        }
      }
      if (outE) facts.violations.envelope.push(G.metas[k].id);
      if (outK) facts.violations.keepOut.push(G.metas[k].id);
    }
    if (out.intent !== undefined) {
      const n = scene.target.res * scene.target.res;
      if (!Array.isArray(out.intent)) facts.intentErrors.push('intent is not an array');
      else {
        let dropped = 0;
        out.intent.forEach((it, i) => {
          if (!it || !(it.facet === null || ids.has(it.facet))) facts.intentErrors.push('intent ' + i + ': facet ' + (it && it.facet) + ' is not a placed surface (use null for unplaced)');
          if (it && it.facet === null) dropped++;
          if (!it || !Array.isArray(it.cells) || it.cells.some((c) => !Array.isArray(c) || !(c[0] >= 0 && c[0] < n && (c[0] | 0) === c[0]) || !(c[1] >= 0 && isFinite(c[1])))) facts.intentErrors.push('intent ' + i + ': cells must be [paintCell, weight ≥ 0] pairs');
        });
        facts.dropped = dropped;
      }
    }
    return facts;
  }

  // Cells → intents lookup for the inspector (overlap-capable): byCell[cell] = [intent index…]
  function intentIndex(intent, res) {
    const byCell = new Map();
    (intent || []).forEach((it, i) => { for (const [c, w] of it.cells) if (w > 0) { let a = byCell.get(c); if (!a) byCell.set(c, (a = [])); a.push(i); } });
    return { byCell, res };
  }

  // Synchronous run (headless tests, and solvers cheap enough for the main thread).  The UI's worker host
  // calls the same pieces.  Returns the scene-ready result; never mutates the scene.
  // the problem scene a solver's trace() runs against (plain data: crosses into a worker)
  const problemOf = (scene) => RF.U.deepCopy({ source: scene.source, target: scene.target, envelope: scene.envelope, sim: scene.sim });
  function prepareRun(scene, id) {
    id = id || current(scene);
    const def = get(id); if (!def) throw new Error('no solver ' + id);
    const settings = settingsOf(scene, id), input = inputOf(scene), problem = problemOf(scene);
    const tools = { progress() {}, budget: { rays: Infinity, ms: Infinity }, scene: problem, trace: (surfaces, o) => trace(problem, surfaces, o) };
    return { def, id, settings, input, tools, meta: { id, version: def.version, settings, seed: input.seed } };
  }
  // Synchronous run (built-in solvers, headless tests).  Never mutates the scene.
  function runSync(scene, id) {
    const r = prepareRun(scene, id), t0 = RF.U.now(), out = r.def.solve(r.input, r.settings, r.tools);
    if (out && typeof out.then === 'function') throw new Error(r.id + ' is asynchronous: use runAsync');
    return { output: out, facts: verify(scene, out), meta: r.meta, ms: RF.U.now() - t0 };
  }
  // Asynchronous run (loaded solvers: their solve() goes to the worker).  onProgress(pct) optional.
  async function runAsync(scene, id, onProgress) {
    const r = prepareRun(scene, id), t0 = RF.U.now();
    if (onProgress) r.tools.progress = onProgress;
    const out = await r.def.solve(r.input, r.settings, r.tools);
    return { output: out, facts: verify(scene, out), meta: r.meta, ms: RF.U.now() - t0 };
  }

  // tools.trace for solvers: the real engine at a chosen ray count, no paths; same seed ⇒ common random numbers.
  //   → { grid, res, energy, raysPerCell, noise, blocked, peakCd, peakNoise, ofCeiling, ofEnvelope, throwM, lmOnTarget,
  //       perFacet? (attribution), shadowed? (occlusion: one extra pass) }   — the same definitions the app scores with
  function trace(scene, surfaces, o) {
    o = o || {};
    const sc = Object.assign({}, scene, { sim: Object.assign({}, scene.sim, { seed: o.seed !== undefined ? o.seed : scene.sim.seed }) });
    const P = RF.Engine.prepare(sc, surfaces); P.recordHits = !!(o.attribution || o.occlusion);
    const N = Math.max(1, Math.min(2e6, o.rays | 0 || 20000)), c = RF.Engine.runSync(P, N, 0);
    const grid = RF.Engine.gridTotal(c), st = RF.Engine.evaluate(c);
    const res = { grid: Array.from(grid), res: P.res, energy: Object.assign({}, c.E), raysPerCell: st.raysPerCell, noise: st.raysPerCell > 0 ? 1 / Math.sqrt(st.raysPerCell) : 1,
      blocked: c.occ.out1 > 0 ? c.occ.blocked / c.occ.out1 : 0 };
    if (RF.Photometry) {
      const ph = RF.Photometry.fixture(sc, P, c);
      Object.assign(res, { peakCd: ph.peakCd, peakNoise: ph.peakNoise, ofCeiling: ph.ofDesign, ofEnvelope: ph.ofEnvelope, throwM: ph.throwM, lmOnTarget: ph.lmOnTarget });
    }
    if (o.occlusion) res.shadowed = RF.Engine.occlusion(P, c).shadowed;
    if (o.attribution) {
      const per = {}; for (let h = 0; h < c.nHits; h++) { const k = c.hitK[h]; if (!k) continue; const id = P.G.metas[k - 1].id; per[id] = (per[id] || 0) + c.hits[3 * h + 2]; }
      res.perFacet = per;
    }
    return res;
  }

  RF.Solvers = { register, unregister, get, list, defaults, sanitize, current, settingsOf, inputOf, verify, intentIndex, runSync, runAsync, trace, DEFAULT_ID, SHARED };
})(typeof globalThis !== 'undefined' ? globalThis : this);
