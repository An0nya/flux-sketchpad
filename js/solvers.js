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
  function settingsOf(scene, id) {
    const def = get(id);
    if (id === DEFAULT_ID) return sanitize(def, { budget: scene.modeA.budget, facetType: scene.modeA.facetType, reflectivity: scene.modeA.reflectivity });
    return sanitize(def, scene.solverSettings && scene.solverSettings[id]);
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
    const facts = { errors: [], violations: { envelope: [], keepOut: [] }, intentErrors: [], placed: 0, dropped: null };
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
    const env = scene.envelope, S = scene.source.pos, keep = env.keepOut || 0;
    for (let k = 0; k < G.n; k++) {
      let outE = false, outK = false;
      for (const poly of RF.Geo.outline(G, k)) {
        for (const p of poly) if (!RF.Geo.envInside(env, p, 1e-6 * Math.max(...env.half))) outE = true;   // box is convex: corners suffice for flat patches
        // the keep-out sphere is NOT convex from outside: a patch can dip into it between its edges, so test
        // interior points too.  Sample a fan of triangles from the centroid, then measure on the REAL surface:
        // a ray from the LED through the sample hits the patch at exactly the distance that matters (the
        // chord alone would sit closer than a concave mirror and raise false alarms).
        if (keep > 0) {
          const c = V.mul(poly.reduce((a, q) => V.add(a, q), [0, 0, 0]), 1 / poly.length), M = 4;
          for (let i = 0; i < poly.length && !outK; i++) {
            const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
            for (let a = 0; a <= M && !outK; a++) for (let b = 0; a + b <= M; b++) {
              const q = V.add(c, V.add(V.mul(V.sub(p1, c), a / M), V.mul(V.sub(p2, c), b / M))), dq = V.norm(V.sub(q, S));
              const t = RF.Geo.intersect(G.D, G.poly, k, S[0], S[1], S[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
              if ((t >= 0 ? t : V.dist(q, S)) < keep * (1 - 1e-6)) { outK = true; break; }
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
  function runSync(scene, id) {
    id = id || current(scene);
    const def = get(id); if (!def) throw new Error('no solver ' + id);
    const settings = settingsOf(scene, id), input = inputOf(scene), t0 = RF.U.now();
    const tools = { progress() {}, budget: { rays: Infinity, ms: Infinity }, trace: (surfaces, o) => trace(scene, surfaces, o) };
    const out = def.solve(input, settings, tools);
    if (out && typeof out.then === 'function') throw new Error(id + ' is asynchronous: use the worker host');
    const facts = verify(scene, out);
    return { output: out, facts, meta: { id, version: def.version, settings, seed: input.seed }, ms: RF.U.now() - t0 };
  }

  // tools.trace for solvers: the real engine at a chosen ray count, no paths; same seed ⇒ common random numbers
  function trace(scene, surfaces, o) {
    o = o || {};
    const sc = Object.assign({}, scene, { sim: Object.assign({}, scene.sim, { seed: o.seed !== undefined ? o.seed : scene.sim.seed }) });
    const P = RF.Engine.prepare(sc, surfaces); P.recordHits = !!o.attribution;
    const N = Math.max(1, Math.min(2e6, o.rays | 0 || 20000)), c = RF.Engine.runSync(P, N, 0);
    const grid = RF.Engine.gridTotal(c), st = RF.Engine.evaluate(c);
    const res = { grid: Array.from(grid), res: P.res, energy: Object.assign({}, c.E), raysPerCell: st.raysPerCell, noise: st.raysPerCell > 0 ? 1 / Math.sqrt(st.raysPerCell) : 1 };
    if (o.attribution) {
      const per = {}; for (let h = 0; h < c.nHits; h++) { const k = c.hitK[h]; if (!k) continue; const id = P.G.metas[k - 1].id; per[id] = (per[id] || 0) + c.hits[3 * h + 2]; }
      res.perFacet = per;
    }
    return res;
  }

  RF.Solvers = { register, get, list, defaults, sanitize, current, settingsOf, inputOf, verify, intentIndex, runSync, trace, DEFAULT_ID };
})(typeof globalThis !== 'undefined' ? globalThis : this);
