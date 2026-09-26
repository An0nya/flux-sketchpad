/* state.js — the serialisable scene: defaults, surface groups, JSON save/load, localStorage,
 * and whole-scene transforms used by the verification suite (scale, mirror, reorder).
 *
 * Everything the tracer needs is in `scene`; generated surfaces are stored too, so loading a file
 * reproduces the exact grid without re-running any solver.                                     */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const VERSION = 1;
  const LS_KEY = 'faceted-reflector-demo/scene/v1';

  function defaultPaint(res) {
    // A wide beam with a brighter core: the kind of pattern a headlamp designer paints first.
    const p = new Array(res * res).fill(0), c = (res - 1) / 2;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = (i - c) / res, y = (j - c) / res;
      const outer = (x / 0.28) ** 2 + (y / 0.12) ** 2 <= 1;
      const inner = (x / 0.11) ** 2 + (y / 0.06) ** 2 <= 1;
      p[j * res + i] = inner ? 1 : outer ? 0.45 : 0;
    }
    return p;
  }

  // The app's starting scene = the verification baseline with Anya's settings on top (2026-09-25;
  // design/anya-default-scene-2026-09-25.json).  The checks and tests use testScene(): their expected
  // values are derived for it, so changing what the app opens with must not move them.
  function defaultScene() {
    const s = testScene();
    Object.assign(s.source, { pos: [-36.58, -3.53, 13.58], axis: [-0.0086, 0.0052, 0.99995], w: 1, h: 1 });   // 1 mm LED on the back wall
    Object.assign(s.envelope, { center: [-32.05, -6.92, 40.47], half: [27.95, 52.59, 27.46], keepOut: 5 });
    s.modeA.minDistance = s.modeB.minDistance = 15;   // was a 15 mm keep-out: same geometry (clearance ≤ 5 + a solver preference)
    Object.assign(s.target, { distance: 2000, size: 500, res: 100 });
    Object.assign(s.sim, { rays: 500000, res: 100 });   // 50k was too few to see the beam resolve (~20 rays per painted cell)
    Object.assign(s.modeA, { paint: defaultPaint(100), budget: 100 });
    return s;
  }
  function testScene() {
    return {
      version: VERSION, units: 'mm', name: 'Headlamp sketch',
      source: {
        kind: 'planar', shape: 'rect', pos: [0, 0, 0], axis: [0, 0, 1], roll: 0,
        w: 2, h: 2, radius: 1, length: 4, power: 1000,
        dist: 'lambertian', sigma: 30, halfAngle: 60,
      },
      envelope: { shape: 'box', center: [-20, 0, 27.5], half: [40, 45, 32.5], axis: 2, keepOut: 5 },   // LED clearance (hard, ≤ CLEAR_MAX)
      target: { distance: 1000, size: 1000, tiltX: 0, tiltY: 0, res: 50, linked: true, aim: [1000, 0, 0] },
      sim: { rays: 10000, res: 50, autoRes: false, bounces: 1, floor: 0.01, seed: 1, smoothing: false, view: 'total', surfaceView: 'shaded' },
      mode: 'A',
      modeA: { paint: defaultPaint(50), brush: { size: 3, strength: 1, erase: false }, budget: 48, facetType: 'curved', reflectivity: 0.9, requiredFlux: 0, minDistance: 12 },   // minDistance: solver preference (was part of a 12 mm keep-out)
      modeB: { stamps: [], selected: null, facetType: 'curved', defaultScale: 160, minDistance: 12 },
      modeC: {
        profile: [], sweep: 'revolve', axisMode: 'aim', azSegments: 0, mirror: false, flipFacing: false, reverseAxis: false,
        interaction: 'reflect', reflectivity: 0.9, ior: 1.49, fresnelT: 0.96, extrudeLength: 60,
        preset: { kind: 'parabola', f: 12, rim: 45, n: 40, theta: 20, depth: 30 },
      },
      lenses: [],
      groups: {
        A: { label: 'Mode A reflector', enabled: true, surfaces: [] },
        B: { label: 'Mode B stamps', enabled: true, surfaces: [] },
        C: { label: 'Mode C profile', enabled: true, surfaces: [] },
        L: { label: 'Lenses', enabled: true, surfaces: [] },
        M: { label: 'Test / manual', enabled: true, surfaces: [] },
      },
      notices: [],
    };
  }

  function allSurfaces(scene) {
    const out = [];
    for (const key of Object.keys(scene.groups)) {
      const g = scene.groups[key];
      if (!g.enabled) continue;
      for (const s of g.surfaces) out.push(s);
    }
    return out;
  }

  // Merge a loaded object onto defaults (tolerates older / partial files).
  function mergeDefaults(obj, def) {
    if (Array.isArray(def) || def === null || typeof def !== 'object') return obj === undefined ? def : obj;
    const out = {};
    for (const k of Object.keys(def)) out[k] = mergeDefaults(obj ? obj[k] : undefined, def[k]);
    if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
    return out;
  }
  function serialize(scene) { return JSON.stringify(scene); }
  const CLEAR_MAX = 5;                                  // mm: the LED clearance control's range (package / dome)
  function deserialize(str) {
    const obj = typeof str === 'string' ? JSON.parse(str) : str;
    if (!obj || typeof obj !== 'object') throw new Error('not a scene object');
    const sc = mergeDefaults(obj, defaultScene());
    // 09-25: the old keep-out split into a hard LED clearance (≤ CLEAR_MAX, verified) + a per-solver minimum
    // facet distance.  Older files keep their exact geometry: clearance = min(old, max), distance = the rest.
    if (!obj.modeA || obj.modeA.minDistance === undefined) {
      const k = Math.abs(+((obj.envelope && obj.envelope.keepOut) || 0)) || 0;
      sc.envelope.keepOut = Math.min(k, CLEAR_MAX); sc.modeA.minDistance = sc.modeB.minDistance = k > CLEAR_MAX ? k : 0;
    }
    if (!obj.sim || obj.sim.res === undefined) sc.sim.res = sc.target.res;   // older files: sim grid = paint grid
    // groups: keep loaded surfaces verbatim
    if (obj.groups) for (const k of Object.keys(obj.groups)) sc.groups[k] = Object.assign({ label: k, enabled: true, surfaces: [] }, obj.groups[k]);
    if (!Array.isArray(sc.modeA.paint) || sc.modeA.paint.length !== sc.target.res * sc.target.res) sc.modeA.paint = defaultPaint(sc.target.res);
    return sc;
  }
  function saveLocal(scene) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, serialize(scene)); return true; } catch (e) { return false; }
  }
  function loadLocal() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const s = localStorage.getItem(LS_KEY);
      return s ? deserialize(s) : null;
    } catch (e) { return null; }
  }
  // Manual snapshot: its own key, so autosave (crash recovery) never overwrites it.
  const SNAP_KEY = LS_KEY + '/snapshot';
  function saveSnapshot(scene) {
    try { localStorage.setItem(SNAP_KEY, serialize(scene)); localStorage.setItem(SNAP_KEY + '/t', String(Date.now())); return true; } catch (e) { return false; }
  }
  function loadSnapshot() { try { const s = localStorage.getItem(SNAP_KEY); return s ? deserialize(s) : null; } catch (e) { return null; } }
  function snapshotTime() { try { const t = +localStorage.getItem(SNAP_KEY + '/t'); return t || null; } catch (e) { return null; } }
  function clearLocal() { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------- whole-scene transforms
  // Apply fp (point map) and fv (direction map) and fl (length scale) to every geometric field.
  function mapSurface(s, fp, fv, fl) {
    const o = RF.U.deepCopy(s);
    if (o.type === 'facet') {
      o.P = fp(o.P); o.S0 = fp(o.S0); o.Z = fp(o.Z);
      if (o.di !== null && o.di !== undefined && isFinite(o.di)) o.di = fl(o.di);
    }
    if (o.type === 'plane') { o.P = fp(o.P); o.n = fv(o.n); }
    if (o.clip) {
      if (o.clip.pts3) o.clip.pts3 = o.clip.pts3.map(fp);
      if (o.clip.ref) o.clip.ref = fv(o.clip.ref);
      if (o.clip.hx !== undefined) { o.clip.hx = fl(o.clip.hx); o.clip.hy = fl(o.clip.hy); }
      if (o.clip.r !== undefined) o.clip.r = fl(o.clip.r);
    }
    if (o.type === 'rev') {
      o.O = fp(o.O); o.W = fv(o.W); if (o.ref) o.ref = fv(o.ref);
      const g = o.seg;
      for (const k of ['z0', 'z1', 'r0', 'r1', 'zc', 'R', 'rmax']) if (g[k] !== undefined) g[k] = fl(g[k]);
    }
    return o;
  }
  function mapScene(scene, fp, fv, fl) {
    const sc = RF.U.deepCopy(scene);
    const s = sc.source;
    s.pos = fp(s.pos); s.axis = fv(s.axis);
    s.w = fl(s.w); s.h = fl(s.h); s.radius = fl(s.radius); s.length = fl(s.length);
    sc.envelope.center = fp(sc.envelope.center);
    sc.envelope.half = sc.envelope.half.map((h) => Math.abs(fl(h)));
    sc.envelope.keepOut = Math.abs(fl(sc.envelope.keepOut || 0));
    sc.modeA.minDistance = Math.abs(fl(sc.modeA.minDistance || 0)); if (sc.modeB) sc.modeB.minDistance = Math.abs(fl(sc.modeB.minDistance || 0));   // lengths too
    sc.target.distance = fl(sc.target.distance); sc.target.size = fl(sc.target.size);
    sc.target.aim = fp(sc.target.aim);
    for (const k of Object.keys(sc.groups)) sc.groups[k].surfaces = sc.groups[k].surfaces.map((x) => mapSurface(x, fp, fv, fl));
    // design intent is geometry too: lens parameters, profile, stamps (u,v,scale), paint in u
    const LEN = ['f', 'a', 'edge', 'tb', 'A', 'rc', 'hc', 'd'];
    for (const L of sc.lenses) for (const k of LEN) if (typeof L.params[k] === 'number') L.params[k] = Math.abs(fl(L.params[k]));
    const mc = sc.modeC;
    mc.profile = mc.profile.map(([r, z]) => [Math.abs(fl(r)), fl(z)]);
    for (const k of ['f', 'rim', 'depth', 'a1']) if (typeof mc.preset[k] === 'number') mc.preset[k] = Math.abs(fl(mc.preset[k]));
    mc.extrudeLength = Math.abs(fl(mc.extrudeLength));
    const fu = mapScene.fu || ((u) => fl(u));
    for (const st of sc.modeB.stamps) { st.u = fu(st.u); st.v = fl(st.v); st.scale = Math.abs(fl(st.scale)); }
    sc.modeB.defaultScale = Math.abs(fl(sc.modeB.defaultScale));
    return sc;
  }
  // Scale every length about the world origin (the target stays on the +x throw axis).
  function scaleScene(scene, k) { return mapScene(scene, (p) => V.mul(p, k), (v) => v.slice(), (l) => l * k); }
  // Mirror across the world plane y = 0 (the target's u axis is −y, so the grid mirrors in u).
  function mirrorSceneY(scene) {
    const m = (p) => [p[0], -p[1], p[2]];
    mapScene.fu = (u) => -u;                        // target u axis is −y: mirror flips u
    let sc;
    try { sc = mapScene(scene, m, m, (l) => l); } finally { mapScene.fu = null; }
    sc.source.roll = -(sc.source.roll || 0);
    const res = sc.target.res, p = sc.modeA.paint, q = p.slice();
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) q[j * res + i] = p[j * res + (res - 1 - i)];
    sc.modeA.paint = q;
    return sc;
  }
  // Reverse the order of every surface list (order must not matter).
  function reorderScene(scene) {
    const sc = RF.U.deepCopy(scene);
    const keys = Object.keys(sc.groups).reverse(), g = {};
    for (const k of keys) { g[k] = sc.groups[k]; g[k].surfaces = g[k].surfaces.slice().reverse(); }
    sc.groups = g;
    return sc;
  }

  RF.State = { CLEAR_MAX,
    VERSION, LS_KEY, defaultScene, testScene, defaultPaint, allSurfaces, serialize, deserialize,
    saveLocal, loadLocal, clearLocal, saveSnapshot, loadSnapshot, snapshotTime, mapSurface, scaleScene, mirrorSceneY, reorderScene,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
