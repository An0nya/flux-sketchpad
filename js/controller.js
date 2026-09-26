/* controller.js — the action layer between UI and state (no DOM here).
 *
 * Every user-facing control is one row of CONTROLS: how to read it, how to write it, which modes it
 * applies to, whether it lives under Advanced, and which surface groups its change invalidates.
 * The DOM (ui.js) is generated from this table and calls exactly these setters, and verification
 * check #14 drives the same setters — so "the UI's own path" is literally the same code path.
 *
 * Groups are functions of intent: A = generate(paint, budget, …) · B = stamps · C = profile ·
 * L = lenses.  commit() rebuilds invalidated groups (A only on demand/idle — it is the expensive one).
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;

  function createStore(scene) {
    const store = {
      scene, reports: { A: null, B: [], C: null, L: {}, feas: null }, version: 0,
      dirty: new Set(), listeners: [], notices: [],
      autoA: true,
    };
    store.on = (fn) => store.listeners.push(fn);
    store.notify = (what) => { store.version++; for (const fn of store.listeners) fn(what); };
    store.notice = (msg) => { store.notices.unshift({ t: Date.now(), msg }); store.notices.length = Math.min(store.notices.length, 8); };
    store.invalidate = (groups) => { for (const g of groups || []) store.dirty.add(g); };
    // Rebuild invalidated groups.  A is regenerated only when forceA (button / idle) or auto.
    store.commit = (opts) => {
      opts = opts || {};
      const sc = store.scene;
      if (store.dirty.has('B')) { const b = RF.ModeB.build(sc); sc.groups.B.surfaces = b.surfaces; store.reports.B = b.reports; store.dirty.delete('B'); }
      if (store.dirty.has('C')) { const c = RF.Profile.build(sc); sc.groups.C.surfaces = c.surfaces; store.reports.C = c.report; store.dirty.delete('C'); }
      if (store.dirty.has('L')) { const l = RF.Lenses.buildAll(sc); sc.groups.L.surfaces = l.surfaces; store.reports.L = l.infos; store.dirty.delete('L'); }
      if (store.dirty.has('A') && (opts.forceA || (store.autoA && !opts.deferA)) && !RF.Solvers.get(RF.Solvers.current(sc)).loaded) regenerateA(store);   // loaded solvers: the UI runs them async
      return store;
    };
    return store;
  }
  // Paint mode goes through the solver interface (js/solvers.js): the registered solver makes the
  // geometry, the host verifies it.  reports.A keeps its old shape for the panels: the solver's own
  // extras, overridden by host-verified facts, plus the standard intent and what was solved.
  function regenerateA(store) { return applySolve(store, RF.Solvers.runSync(store.scene)); }
  // loaded solvers run in a worker: resolve to the same report (null if the scene changed meanwhile)
  async function regenerateAAsync(store, onProgress) {
    const v = store.version, r = await RF.Solvers.runAsync(store.scene, null, onProgress);
    return store.version === v ? applySolve(store, r) : null;
  }
  function applySolve(store, r) {
    const sc = store.scene, out = r.output || {}, f = r.facts, extras = out.extras || {};
    sc.groups.A.surfaces = f.errors.length ? [] : out.surfaces;
    sc.solve = r.meta;
    const rep = Object.assign({}, extras, {
      placed: f.placed, facts: f, intent: out.intent || null, intentIndex: out.intent ? RF.Solvers.intentIndex(out.intent, sc.target.res) : null,
      solver: r.meta, solveMs: r.ms, warnings: (out.notes || []).slice(),
    });
    if (f.dropped !== null) rep.dropped = f.dropped;
    if (f.errors.length) { rep.error = 'Solver ' + r.meta.id + ' returned unusable output: ' + f.errors[0]; rep.ok = false; }
    const v = f.violations;
    if (v.envelope.length) rep.warnings.push(v.envelope.length + ' surface(s) reach outside the envelope (' + v.envelope.slice(0, 3).join(', ') + (v.envelope.length > 3 ? '…' : '') + ').');
    if (v.keepOut.length) rep.warnings.push(v.keepOut.length + ' surface(s) enter the keep-out around the LED (' + v.keepOut.slice(0, 3).join(', ') + (v.keepOut.length > 3 ? '…' : '') + ').');
    if (f.intentErrors.length) rep.warnings.push('Solver intent is malformed: ' + f.intentErrors[0]);
    store.reports.A = rep;
    store.dirty.delete('A');
    return rep;
  }

  // Raise bounce cap visibly when a preset needs it (never silently)
  function ensureBounces(store, need, why) {
    const sim = store.scene.sim;
    if (sim.bounces < need) {
      store.notice('Bounces raised ' + sim.bounces + ' → ' + need + ': ' + why);
      sim.bounces = need;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the control table
  const all = ['A', 'B', 'C'];
  const srcGroups = ['A', 'B', 'C', 'L'];
  function num(id, label, get, set, o) {
    return Object.assign({ id, label, type: 'number', get, set, modes: all, adv: false, groups: [], min: -Infinity, max: Infinity, step: 'any' }, o || {});
  }
  function sel(id, label, options, get, set, o) { return Object.assign(num(id, label, get, set, o), { type: 'select', options }); }
  function chk(id, label, get, set, o) { return Object.assign(num(id, label, get, set, o), { type: 'check' }); }
  const S = (s) => s.scene.source, EN = (s) => s.scene.envelope, TG = (s) => s.scene.target, SIM = (s) => s.scene.sim;

  const CONTROLS = [
    // ---- simulation
    num('rays', 'Rays', (s) => SIM(s).rays, (s, v) => { SIM(s).rays = Math.round(RF.U.clamp(v, 100, 1e6)); }, { section: 'run', min: 100, max: 1e6, step: 100, log: true, help: 'Rays per run (100 – 1,000,000). Big runs render progressively.' }),
    num('bounces', 'Max bounces', (s) => SIM(s).bounces, (s, v) => { SIM(s).bounces = Math.round(RF.U.clamp(v, 1, 8)); }, { section: 'sim', adv: true, min: 1, max: 8, step: 1, help: 'Surface interactions per ray (default 1, hard cap 8). A ray that meets a surface after its budget is spent is stopped there (occlusion still applies).' }),
    num('floor', 'Energy floor %', (s) => SIM(s).floor * 100, (s, v) => { SIM(s).floor = RF.U.clamp(v, 0, 100) / 100; }, { section: 'sim', adv: true, min: 0, max: 100, step: 0.1, help: 'Rays whose remaining energy drops below this fraction of their initial energy are terminated (counted as "cut").' }),
    num('seed', 'Seed', (s) => SIM(s).seed, (s, v) => { SIM(s).seed = Math.round(v) | 0; }, { section: 'sim', adv: true, step: 1, help: 'PRNG seed. Same inputs + same seed ⇒ byte-identical grid.' }),
    // ---- source
    sel('src.kind', 'Source type', [['point', 'Point'], ['planar', 'Planar (LED die)'], ['volume', 'Volume (filament)']], (s) => S(s).kind,
      (s, v) => { const o = S(s); o.kind = v; if (v === 'planar' && !['rect', 'disc'].includes(o.shape)) o.shape = 'rect'; if (v === 'volume' && !['sphere', 'cylinder'].includes(o.shape)) o.shape = 'cylinder'; if (v === 'volume' && o.dist === 'lambertian') o.dist = 'isotropic'; }, { section: 'source', groups: srcGroups }),
    sel('src.shape', 'Shape', [['rect', 'Rectangle'], ['disc', 'Disc'], ['sphere', 'Sphere'], ['cylinder', 'Cylinder']], (s) => S(s).shape, (s, v) => { S(s).shape = v; }, { section: 'source', groups: srcGroups, show: (s) => S(s).kind !== 'point', optionFilter: (s, v) => (S(s).kind === 'planar' ? ['rect', 'disc'] : ['sphere', 'cylinder']).includes(v) }),
    num('src.w', 'Width (mm)', (s) => S(s).w, (s, v) => { S(s).w = Math.max(1e-6, v); }, { section: 'source', groups: srcGroups, min: 0.001, step: 0.1, show: (s) => S(s).kind === 'planar' && S(s).shape === 'rect' }),
    num('src.h', 'Height (mm)', (s) => S(s).h, (s, v) => { S(s).h = Math.max(1e-6, v); }, { section: 'source', groups: srcGroups, min: 0.001, step: 0.1, show: (s) => S(s).kind === 'planar' && S(s).shape === 'rect' }),
    num('src.radius', 'Radius (mm)', (s) => S(s).radius, (s, v) => { S(s).radius = Math.max(1e-6, v); }, { section: 'source', groups: srcGroups, min: 0.001, step: 0.1, show: (s) => S(s).kind !== 'point' && S(s).shape !== 'rect' }),
    num('src.length', 'Length (mm)', (s) => S(s).length, (s, v) => { S(s).length = Math.max(1e-6, v); }, { section: 'source', groups: srcGroups, min: 0.001, step: 0.1, show: (s) => S(s).kind === 'volume' && S(s).shape === 'cylinder' }),
    sel('src.dist', 'Distribution', [['lambertian', 'Lambertian'], ['gaussian', 'Gaussian'], ['cone', 'Uniform cone'], ['isotropic', 'Isotropic']], (s) => S(s).dist, (s, v) => { S(s).dist = v; }, { section: 'source', groups: srcGroups }),
    num('src.sigma', 'Gaussian σ (°)', (s) => S(s).sigma, (s, v) => { S(s).sigma = RF.U.clamp(v, 0.5, 180); }, { section: 'source', groups: srcGroups, min: 0.5, max: 180, step: 0.5, show: (s) => S(s).dist === 'gaussian' }),
    num('src.half', 'Cone half-angle (°)', (s) => S(s).halfAngle, (s, v) => { S(s).halfAngle = RF.U.clamp(v, 0.5, 180); }, { section: 'source', groups: srcGroups, min: 0.5, max: 180, step: 0.5, show: (s) => S(s).dist === 'cone' }),
    num('src.az', 'Axis azimuth (°)', (s) => V.toAzEl(S(s).axis)[0], (s, v) => { const e = V.toAzEl(S(s).axis)[1]; S(s).axis = V.fromAzEl(v, e); }, { section: 'source', groups: srcGroups, min: -180, max: 180, step: 1, help: 'Emission axis, any 3D direction (also draggable in the scene: grab the arrow tip).' }),
    num('src.el', 'Axis elevation (°)', (s) => V.toAzEl(S(s).axis)[1], (s, v) => { const a = V.toAzEl(S(s).axis)[0]; S(s).axis = V.fromAzEl(a, RF.U.clamp(v, -90, 90)); }, { section: 'source', groups: srcGroups, min: -90, max: 90, step: 1 }),
    num('src.roll', 'Roll (°)', (s) => S(s).roll || 0, (s, v) => { S(s).roll = v; }, { section: 'source', adv: true, groups: srcGroups, step: 1 }),
    num('src.x', 'Position x', (s) => S(s).pos[0], (s, v) => { S(s).pos[0] = v; }, { section: 'source', adv: true, groups: srcGroups, step: 0.5 }),
    num('src.y', 'Position y', (s) => S(s).pos[1], (s, v) => { S(s).pos[1] = v; }, { section: 'source', adv: true, groups: srcGroups, step: 0.5 }),
    num('src.z', 'Position z', (s) => S(s).pos[2], (s, v) => { S(s).pos[2] = v; }, { section: 'source', adv: true, groups: srcGroups, step: 0.5 }),
    num('src.power', 'Power (lm)', (s) => S(s).power, (s, v) => { S(s).power = Math.max(1e-9, v); }, { section: 'source', adv: true, step: 10 }),
    // ---- envelope
    sel('env.shape', 'Envelope', [['box', 'Box'], ['cylinder', 'Cylinder'], ['ellipsoid', 'Ellipsoid']], (s) => EN(s).shape, (s, v) => { EN(s).shape = v; }, { section: 'envelope', groups: ['A', 'B'] }),
    sel('env.axis', 'Cylinder axis', [['0', 'x'], ['1', 'y'], ['2', 'z']], (s) => String(EN(s).axis), (s, v) => { EN(s).axis = +v; }, { section: 'envelope', groups: ['A', 'B'], show: (s) => EN(s).shape === 'cylinder' }),
    num('env.keep', 'Source keep-out (mm)', (s) => EN(s).keepOut, (s, v) => { EN(s).keepOut = Math.max(0, v); }, { section: 'envelope', groups: ['A', 'B'], min: 0, step: 0.5, help: 'Clearance around the emitter (LED dome/package). Larger ⇒ facets farther away ⇒ smaller source images, sharper tiles, less flux.' }),
    num('env.hx', 'Half-size x', (s) => EN(s).half[0], (s, v) => { EN(s).half[0] = Math.max(1e-6, v); }, { section: 'envelope', adv: true, groups: ['A', 'B'], step: 1 }),
    num('env.hy', 'Half-size y', (s) => EN(s).half[1], (s, v) => { EN(s).half[1] = Math.max(1e-6, v); }, { section: 'envelope', adv: true, groups: ['A', 'B'], step: 1 }),
    num('env.hz', 'Half-size z', (s) => EN(s).half[2], (s, v) => { EN(s).half[2] = Math.max(1e-6, v); }, { section: 'envelope', adv: true, groups: ['A', 'B'], step: 1 }),
    num('env.cx', 'Centre x', (s) => EN(s).center[0], (s, v) => { EN(s).center[0] = v; }, { section: 'envelope', adv: true, groups: ['A', 'B'], step: 1 }),
    num('env.cy', 'Centre y', (s) => EN(s).center[1], (s, v) => { EN(s).center[1] = v; }, { section: 'envelope', adv: true, groups: ['A', 'B'], step: 1 }),
    num('env.cz', 'Centre z', (s) => EN(s).center[2], (s, v) => { EN(s).center[2] = v; }, { section: 'envelope', adv: true, groups: ['A', 'B'], step: 1 }),
    // ---- target
    num('tgt.dist', 'Target distance (mm)', (s) => TG(s).distance, (s, v) => { TG(s).distance = Math.max(1e-6, v); }, { section: 'target', groups: ['A', 'B', 'C', 'L'], min: 1, step: 10, help: 'Also draggable in the scene (the handle at the target centre).' }),
    num('tgt.size', 'Target width (mm)', (s) => TG(s).size, (s, v) => { TG(s).size = Math.max(1e-6, v); }, { section: 'target', groups: ['A', 'B'], min: 1, step: 10 }),
    num('tgt.tiltX', 'Tilt about u (°)', (s) => TG(s).tiltX, (s, v) => { TG(s).tiltX = RF.U.clamp(v, -89, 89); }, { section: 'target', groups: ['A', 'B'], min: -89, max: 89, step: 1 }),
    num('tgt.tiltY', 'Tilt about v (°)', (s) => TG(s).tiltY, (s, v) => { TG(s).tiltY = RF.U.clamp(v, -89, 89); }, { section: 'target', groups: ['A', 'B'], min: -89, max: 89, step: 1 }),
    chk('tgt.linked', 'Aim point moves with target', (s) => TG(s).linked !== false, (s, v) => { const t = TG(s); if (!v && t.linked !== false) t.aim = [t.distance, 0, 0]; t.linked = !!v; }, { section: 'target', groups: ['A', 'B', 'C', 'L'], help: 'Unlink to move the target plane without moving the optical target point the facets aim at (the design stays focused at the aim point).' }),
    num('aim.x', 'Aim x', (s) => RF.Engine.aimPoint(TG(s))[0], (s, v) => { TG(s).aim[0] = v; }, { section: 'target', groups: ['A', 'B', 'C', 'L'], step: 10, show: (s) => TG(s).linked === false }),
    num('aim.y', 'Aim y', (s) => RF.Engine.aimPoint(TG(s))[1], (s, v) => { TG(s).aim[1] = v; }, { section: 'target', groups: ['A', 'B', 'C', 'L'], step: 10, show: (s) => TG(s).linked === false }),
    num('aim.z', 'Aim z', (s) => RF.Engine.aimPoint(TG(s))[2], (s, v) => { TG(s).aim[2] = v; }, { section: 'target', groups: ['A', 'B', 'C', 'L'], step: 10, show: (s) => TG(s).linked === false }),
    num('tgt.res', 'Paint grid', (s) => TG(s).res, (s, v) => setResolution(s, Math.round(RF.U.clamp(v, 10, 200))), { section: 'heatmap', min: 10, max: 200, step: 1, help: 'Paint / design grid N×N (default 50, up to 200). The simulation has its own grid.' }),
    num('sim.res', 'Sim grid', (s) => SIM(s).res, (s, v) => { SIM(s).res = Math.round(RF.U.clamp(v, 10, 1000)); }, { section: 'heatmap', min: 10, max: 1000, step: 10, help: 'Simulation accumulator N×N (10–1000). Every statistic is computed on this grid.' }),
    chk('sim.autoRes', 'Auto sim grid', (s) => !!SIM(s).autoRes, (s, v) => { SIM(s).autoRes = !!v; }, { section: 'heatmap', help: 'Pick the sim grid for ~50 rays per lit cell, from a 4,000-ray pilot.' }),
    // ---- Mode A
    num('A.budget', 'Facet budget', (s) => s.scene.modeA.budget, (s, v) => { s.scene.modeA.budget = Math.round(RF.U.clamp(v, 1, 2000)); }, { primary: true, section: 'modeA', modes: ['A'], groups: ['A'], min: 1, max: 2000, step: 1, help: 'How many segments you are willing to make. Everything else (search resolution etc.) is derived.' }),
    sel('A.type', 'Facets', [['curved', 'Curved (tile size solved)'], ['flat', 'Flat (tile locked to footprint)']], (s) => s.scene.modeA.facetType, (s, v) => { s.scene.modeA.facetType = v; }, { primary: true, section: 'modeA', modes: ['A'], groups: ['A'] }),
    num('A.refl', 'Mirror reflectivity', (s) => s.scene.modeA.reflectivity, (s, v) => { s.scene.modeA.reflectivity = RF.U.clamp(v, 0, 1); }, { section: 'modeA', modes: ['A'], groups: ['A'], min: 0, max: 1, step: 0.01 }),
    num('A.req', 'Required delivered flux %', (s) => s.scene.modeA.requiredFlux, (s, v) => { s.scene.modeA.requiredFlux = RF.U.clamp(v, 0, 100); }, { section: 'modeA', modes: ['A'], adv: true, min: 0, max: 100, step: 1, help: '0 = shape only. Otherwise the feasibility report checks this absolute level against what the envelope can intercept.' }),
    num('A.brush', 'Brush size (cells)', (s) => s.scene.modeA.brush.size, (s, v) => { s.scene.modeA.brush.size = RF.U.clamp(v, 0.5, 20); }, { section: 'heatmap', modes: ['A'], min: 0.5, max: 20, step: 0.5 }),
    num('A.strength', 'Brush level', (s) => s.scene.modeA.brush.strength, (s, v) => { s.scene.modeA.brush.strength = RF.U.clamp(v, 0.05, 1); }, { section: 'heatmap', modes: ['A'], min: 0.05, max: 1, step: 0.05 }),
    chk('A.erase', 'Erase', (s) => !!s.scene.modeA.brush.erase, (s, v) => { s.scene.modeA.brush.erase = !!v; }, { section: 'heatmap', modes: ['A'] }),
    // ---- Mode B (selected stamp)
    num('B.scale', 'Tile scale (mm)', (s) => selStamp(s) ? selStamp(s).scale : s.scene.modeB.defaultScale, (s, v) => { const st = selStamp(s); if (st) st.scale = Math.max(1e-6, v); else s.scene.modeB.defaultScale = Math.max(1e-6, v); }, { primary: true, section: 'modeB', modes: ['B'], groups: ['B'], step: 1, help: 'Range clamps to what this facet can physically paint (reason shown below).' }),
    sel('B.type', 'Facet', [['curved', 'Curved (curvature sets size)'], ['flat', 'Flat (size sets size)']], (s) => (selStamp(s) ? selStamp(s).facetType : s.scene.modeB.facetType), (s, v) => { const st = selStamp(s); if (st) st.facetType = v; else s.scene.modeB.facetType = v; }, { primary: true, section: 'modeB', modes: ['B'], groups: ['B'] }),
    num('B.ap', 'Facet half-angle (°)', (s) => (selStamp(s) ? selStamp(s).apDeg : 10), (s, v) => { const st = selStamp(s); if (st) st.apDeg = RF.U.clamp(v, 0.2, 30); }, { section: 'modeB', modes: ['B'], groups: ['B'], min: 0.2, max: 30, step: 0.2, show: (s) => selStamp(s) && selStamp(s).facetType === 'curved', help: 'Angular size of a curved facet as seen from the source (sets its flux).' }),
    sel('B.dir', 'Direction', [['auto', 'Auto (brightest free direction)'], ['manual', 'Manual (picker)']], (s) => (selStamp(s) ? selStamp(s).dirMode : 'auto'), (s, v) => { const st = selStamp(s); if (st) st.dirMode = v; }, { section: 'modeB', modes: ['B'], groups: ['B'], show: (s) => !!selStamp(s) }),
    // ---- Mode C
    sel('C.preset', 'Preset', [['parabola', 'Parabola (focus at source)'], ['ellipse', 'Ellipse (2nd focus on axis)'], ['cpc', 'CPC collimator'], ['cone', 'Cone'], ['sphere', 'Sphere (retro)'], ['flat', 'Flat disc']], (s) => s.scene.modeC.preset.kind, (s, v) => { s.scene.modeC.preset.kind = v; applyPreset(s); }, { section: 'modeC', modes: ['C'], groups: ['C'] }),
    num('C.f', 'Focal length (mm)', (s) => s.scene.modeC.preset.f, (s, v) => { s.scene.modeC.preset.f = Math.max(0.01, v); applyPreset(s); }, { primary: true, section: 'modeC', modes: ['C'], groups: ['C'], min: 0.01, step: 0.5, show: (s) => ['parabola', 'ellipse', 'flat'].includes(s.scene.modeC.preset.kind) }),
    num('C.rim', 'Rim radius (mm)', (s) => s.scene.modeC.preset.rim, (s, v) => { s.scene.modeC.preset.rim = Math.max(0.01, v); applyPreset(s); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0.01, step: 0.5, show: (s) => s.scene.modeC.preset.kind !== 'cpc' }),
    num('C.depth', 'Focus separation (mm)', (s) => s.scene.modeC.preset.depth, (s, v) => { s.scene.modeC.preset.depth = Math.max(0.01, v); applyPreset(s); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0.01, step: 1, show: (s) => ['ellipse', 'cone'].includes(s.scene.modeC.preset.kind) }),
    num('C.theta', 'Angle (°)', (s) => s.scene.modeC.preset.theta, (s, v) => { s.scene.modeC.preset.theta = RF.U.clamp(v, 1, 170); applyPreset(s); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 1, max: 170, step: 1, show: (s) => ['cpc', 'cone', 'sphere'].includes(s.scene.modeC.preset.kind), help: 'CPC: acceptance half-angle. Cone: wall angle. Sphere: cap span.' }),
    num('C.a1', 'Small aperture radius (mm)', (s) => s.scene.modeC.preset.a1 || 2, (s, v) => { s.scene.modeC.preset.a1 = Math.max(0.01, v); applyPreset(s); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0.01, step: 0.1, show: (s) => ['cpc', 'cone'].includes(s.scene.modeC.preset.kind) }),
    num('C.n', 'Profile segments', (s) => s.scene.modeC.preset.n, (s, v) => { s.scene.modeC.preset.n = Math.round(RF.U.clamp(v, 1, 400)); applyPreset(s); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 1, max: 400, step: 1, help: 'Facets along the profile (rings after revolving).' }),
    sel('C.sweep', 'Sweep', [['revolve', 'Revolve (dish / cup)'], ['extrude', 'Extrude (trough)']], (s) => s.scene.modeC.sweep, (s, v) => { s.scene.modeC.sweep = v; }, { primary: true, section: 'modeC', modes: ['C'], groups: ['C'] }),
    num('C.len', 'Extrude length (mm)', (s) => s.scene.modeC.extrudeLength, (s, v) => { s.scene.modeC.extrudeLength = Math.max(0.01, v); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0.01, step: 1, show: (s) => s.scene.modeC.sweep === 'extrude' }),
    num('C.az', 'Azimuthal facets (0 = smooth)', (s) => s.scene.modeC.azSegments, (s, v) => { s.scene.modeC.azSegments = Math.round(RF.U.clamp(v, 0, 360)); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0, max: 360, step: 1, show: (s) => s.scene.modeC.sweep === 'revolve' }),
    sel('C.axis', 'Sweep axis', [['aim', 'Source → aim point'], ['source', 'Source emission axis'], ['x', 'World x'], ['y', 'World y'], ['z', 'World z']], (s) => s.scene.modeC.axisMode, (s, v) => { s.scene.modeC.axisMode = v; }, { section: 'modeC', modes: ['C'], groups: ['C'] }),
    chk('C.mirror', 'Mirror copy', (s) => s.scene.modeC.mirror, (s, v) => { s.scene.modeC.mirror = !!v; }, { section: 'modeC', modes: ['C'], groups: ['C'] }),
    chk('C.flip', 'Flip facing', (s) => s.scene.modeC.flipFacing, (s, v) => { s.scene.modeC.flipFacing = !!v; }, { section: 'modeC', modes: ['C'], groups: ['C'] }),
    chk('C.rev', 'Reverse axis', (s) => s.scene.modeC.reverseAxis, (s, v) => { s.scene.modeC.reverseAxis = !!v; }, { section: 'modeC', modes: ['C'], groups: ['C'] }),
    sel('C.inter', 'Profile is', [['reflect', 'Reflector'], ['refract', 'Refractor (lens)'], ['absorb', 'Absorber']], (s) => s.scene.modeC.interaction, (s, v) => { s.scene.modeC.interaction = v; if (v === 'refract') ensureBounces(s, 2, 'a refracting profile needs an entry and an exit interaction.'); }, { section: 'modeC', modes: ['C'], groups: ['C'] }),
    num('C.refl', 'Reflectivity', (s) => s.scene.modeC.reflectivity, (s, v) => { s.scene.modeC.reflectivity = RF.U.clamp(v, 0, 1); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0, max: 1, step: 0.01, show: (s) => s.scene.modeC.interaction === 'reflect' }),
    num('C.ior', 'Index of refraction', (s) => s.scene.modeC.ior, (s, v) => { s.scene.modeC.ior = RF.U.clamp(v, 1, 4); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 1, max: 4, step: 0.01, show: (s) => s.scene.modeC.interaction === 'refract' }),
    num('C.T', 'Fresnel transmission', (s) => s.scene.modeC.fresnelT, (s, v) => { s.scene.modeC.fresnelT = RF.U.clamp(v, 0, 1); }, { section: 'modeC', modes: ['C'], groups: ['C'], min: 0, max: 1, step: 0.01, show: (s) => s.scene.modeC.interaction === 'refract', help: 'Per-interface transmitted fraction (Fresnel reflection loss) — separate from the index.' }),
  ];
  const BY_ID = {}; for (const c of CONTROLS) BY_ID[c.id] = c;

  function selStamp(s) { const id = s.scene.modeB.selected; return s.scene.modeB.stamps.find((t) => t.id === id) || null; }
  function applyPreset(s) {
    const mc = s.scene.modeC;
    mc.profile = RF.Profile.presetProfile(mc.preset, s.scene);
    if (mc.preset.kind === 'cpc') ensureBounces(s, 4, 'a CPC needs several wall bounces.');
  }
  function setResolution(s, res) {
    const t = s.scene.target, old = t.res, p = s.scene.modeA.paint;
    if (res === old) return;
    const np = new Array(res * res).fill(0);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const oi = Math.min(old - 1, Math.floor((i + 0.5) * old / res)), oj = Math.min(old - 1, Math.floor((j + 0.5) * old / res));
      np[j * res + i] = p[oj * old + oi] || 0;
    }
    s.scene.modeA.paint = np; t.res = res;
    s.invalidate(['A']);
  }

  // Set a control through its table row (the path the DOM uses)
  function setControl(store, id, value) {
    const c = BY_ID[id];
    if (!c) throw new Error('no control ' + id);
    c.set(store, value);
    store.invalidate(c.groups);
    return c;
  }
  function controlVisible(store, c) {
    if (!c.modes.includes(store.scene.mode)) return false;
    if (c.show && !c.show(store)) return false;
    return true;
  }

  // ---------------------------------------------------------------- non-table actions
  const actions = {
    setMode(store, m) { store.scene.mode = m; },
    // Paint a disc of cells at target (u, v) mm with the current brush (UI path for painting)
    paintAt(store, u, v) {
      const sc = store.scene, T = RF.Engine.targetFrame(sc.target), res = T.res, cell = 2 * T.half / res, b = sc.modeA.brush;
      const ci = (u + T.half) / cell - 0.5, cj = (v + T.half) / cell - 0.5, rad = b.size / 2;
      let changed = false;
      for (let j = Math.floor(cj - rad - 1); j <= Math.ceil(cj + rad + 1); j++) for (let i = Math.floor(ci - rad - 1); i <= Math.ceil(ci + rad + 1); i++) {
        if (i < 0 || j < 0 || i >= res || j >= res) continue;
        if ((i - ci) ** 2 + (j - cj) ** 2 > rad * rad + 0.25) continue;
        const k = j * res + i, nv = b.erase ? 0 : Math.max(sc.modeA.paint[k], b.strength);
        if (nv !== sc.modeA.paint[k]) { sc.modeA.paint[k] = nv; changed = true; }
      }
      if (changed) store.invalidate(['A']);
      return changed;
    },
    clearPaint(store) { store.scene.modeA.paint.fill(0); store.invalidate(['A']); },
    invertPaint(store) { const p = store.scene.modeA.paint; for (let k = 0; k < p.length; k++) p[k] = +Math.min(1, Math.max(0, 1 - p[k])).toFixed(4); store.invalidate(['A']); },
    // a saved pattern (any resolution) → current paint grid, nearest-cell resample
    setPaint(store, src, srcRes) {
      const sc = store.scene, res = sc.target.res, p = sc.modeA.paint;
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) p[j * res + i] = src[Math.min(srcRes - 1, Math.floor((j + 0.5) * srcRes / res)) * srcRes + Math.min(srcRes - 1, Math.floor((i + 0.5) * srcRes / res))] || 0;
      store.invalidate(['A']);
    },
    paintPreset(store, kind) {
      const sc = store.scene, res = sc.target.res, p = sc.modeA.paint, c = (res - 1) / 2;
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const x = (i - c) / res, y = (j - c) / res, r = Math.hypot(x, y);
        let v = 0;
        if (kind === 'spot') v = r < 0.08 ? 1 : 0;
        else if (kind === 'beam') v = (x / 0.11) ** 2 + (y / 0.06) ** 2 <= 1 ? 1 : (x / 0.28) ** 2 + (y / 0.12) ** 2 <= 1 ? 0.45 : 0;
        else if (kind === 'ring') v = r > 0.14 && r < 0.22 ? 1 : 0;
        else if (kind === 'band') v = Math.abs(y) < 0.06 && Math.abs(x) < 0.35 ? 1 : 0;
        else if (kind === 'checker') v = Math.abs(x) < 0.2 && Math.abs(y) < 0.2 && ((i + j) % 2 === 0) ? 1 : 0;
        else if (kind === 'wall') v = y > -0.1 && y < 0.3 && Math.abs(x) < 0.3 ? 0.4 + 0.6 * (0.3 - y) / 0.4 : 0;
        else if (kind === 'lowbeam') {            // asymmetric cutoff: flat left, 15° step up on the right; hotspot under the kink
          const cut = x < 0 ? 0 : Math.min(x * Math.tan(15 * Math.PI / 180), 0.05);
          v = y <= cut && y > -0.22 && Math.abs(x) < 0.42 ? ((x / 0.1) ** 2 + ((y + 0.035) / 0.04) ** 2 <= 1 ? 1 : 0.4) : 0;
        }
        else if (kind === 'twospot') v = Math.hypot(x - 0.18, y) < 0.06 || Math.hypot(x + 0.18, y) < 0.06 ? 1 : 0;
        else if (kind === 'cross') v = (Math.abs(x) < 0.035 && Math.abs(y) < 0.28) || (Math.abs(y) < 0.035 && Math.abs(x) < 0.28) ? 1 : 0;
        else if (kind === 'frame') { const m = Math.max(Math.abs(x), Math.abs(y)); v = m > 0.2 && m < 0.26 ? 1 : 0; }
        else if (kind === 'gradient') v = Math.abs(x) < 0.3 && Math.abs(y) < 0.14 ? 0.15 + 0.85 * (x + 0.3) / 0.6 : 0;
        else if (kind === 'stripes') v = Math.abs(y) < 0.22 && Math.abs(x) < 0.3 && Math.floor((x + 0.3) / 0.12) % 2 === 0 ? 1 : 0;
        else if (kind === 'thinring') v = r > 0.18 && r < 0.205 ? 1 : 0;
        p[j * res + i] = v;
      }
      store.invalidate(['A']);
    },
    addStamp(store, u, v) {
      const st = RF.ModeB.newStamp(store.scene, u, v);
      store.scene.modeB.stamps.push(st); store.scene.modeB.selected = st.id; store.invalidate(['B']);
      return st;
    },
    moveStamp(store, id, u, v) { const st = store.scene.modeB.stamps.find((t) => t.id === id); if (st) { st.u = u; st.v = v; store.invalidate(['B']); } },
    setStampDir(store, id, th, ph) { const st = store.scene.modeB.stamps.find((t) => t.id === id); if (st) { st.dirMode = 'manual'; st.th = th; st.ph = ph; store.invalidate(['B']); } },
    duplicateStamp(store, id) {
      const st = store.scene.modeB.stamps.find((t) => t.id === id); if (!st) return null;
      const T = RF.Engine.targetFrame(store.scene.target), d = 4 * T.half / T.res;
      const cp = Object.assign(RF.ModeB.newStamp(store.scene, st.u + d, st.v - d, st.scale), { facetType: st.facetType, apDeg: st.apDeg });
      store.scene.modeB.stamps.push(cp); store.scene.modeB.selected = cp.id; store.invalidate(['B']);
      return cp;
    },
    deleteStamp(store, id) { const b = store.scene.modeB; b.stamps = b.stamps.filter((t) => t.id !== id); if (b.selected === id) b.selected = null; store.invalidate(['B']); },
    clearStamps(store) { store.scene.modeB.stamps = []; store.scene.modeB.selected = null; store.invalidate(['B']); },
    setProfile(store, pts) { store.scene.modeC.profile = pts.map((p) => [p[0], p[1]]); store.invalidate(['C']); },
    applyPreset(store) { applyPreset(store); store.invalidate(['C']); },
    addLens(store, kind) {
      const ids = new Set(store.scene.lenses.map((l) => l.id)); let k = 1; while (ids.has('l' + k)) k++;
      const L = { id: 'l' + k, kind, params: RF.Lenses.defaults(kind) };
      store.scene.lenses.push(L);
      ensureBounces(store, RF.Lenses.bouncesNeeded(kind), kind === 'tir' ? 'a TIR collimator needs entry + TIR + exit.' : 'a lens needs an entry and an exit interaction.');
      store.invalidate(['L']);
      return L;
    },
    updateLens(store, id, key, value) { const L = store.scene.lenses.find((l) => l.id === id); if (L) { L.params[key] = value; store.invalidate(['L']); } },
    removeLens(store, id) { store.scene.lenses = store.scene.lenses.filter((l) => l.id !== id); store.invalidate(['L']); },
    setGroupEnabled(store, g, on) { store.scene.groups[g].enabled = !!on; },
    clearGroup(store, g) {
      store.scene.groups[g].surfaces = [];
      if (g === 'B') { store.scene.modeB.stamps = []; store.scene.modeB.selected = null; }
      if (g === 'L') store.scene.lenses = [];
      if (g === 'C') store.scene.modeC.profile = [];
      if (g === 'A') store.dirty.delete('A');
    },
    // Scene-view handle drags (UI path for direct manipulation)
    moveSource(store, p) { store.scene.source.pos = p.slice(); store.invalidate(srcGroups); },
    setSourceAxis(store, a) { store.scene.source.axis = V.norm(a); store.invalidate(srcGroups); },
    setTargetDistance(store, d) { store.scene.target.distance = Math.max(1e-6, d); store.invalidate(['A', 'B', 'C', 'L']); },
    setEnvelopeHalf(store, axis, h) { store.scene.envelope.half[axis] = Math.max(1e-6, h); store.invalidate(['A', 'B']); },
    setEnvelopeCenter(store, c) { store.scene.envelope.center = c.slice(); store.invalidate(['A', 'B']); },
  };

  // Simulate a store's scene synchronously (used by checks and the headless runner)
  function simulate(store, N) {
    const sc = store.scene;
    const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc));
    const ctx = RF.Engine.runSync(P, N || sc.sim.rays);
    return { P, ctx, hash: RF.Engine.gridHash(ctx), stats: RF.Engine.stats(ctx) };
  }

  RF.Controller = { createStore, regenerateA, regenerateAAsync, CONTROLS, BY_ID, setControl, controlVisible, actions, simulate, ensureBounces, selStamp };
})(typeof globalThis !== 'undefined' ? globalThis : this);
