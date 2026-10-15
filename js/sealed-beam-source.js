/* sealed-beam-source.js — SB2 mounting and H4 parts, shared by the page, CLI and solver worker.
 * Uses existing scene.source fields and ordinary surfaces; no scene/solver format extension.
 * R37 constraints vs assumed shape: docs/sealed-beam-v2.md. */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V, D2R = Math.PI / 180;
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };
  const glassOf = (ior) => ({ interaction: 'refract', reflectivity: 0.9, ior, fresnelT: 0.96, twoSided: false });
  const LAMPS = { '7': { r: 85, f: 25, label: '7" round (6014 / H6024 family)' }, '5.75': { r: 69.5, f: 20, label: '5¾" round (4000 family)' } };
  function layout(input, s) {
    const lamp = LAMPS[s.lamp] || LAMPS['7'], src = input.source, S = src.pos.slice();
    const low = s.beam === 'low', f = s.focal > 0 ? s.focal : lamp.f;
    const offset = low ? [s.lowFwd, s.lowLeft, s.lowUp] : [0, 0, 0];
    const F = s.mount === 'follow' ? V.sub(S, offset) : [s.focusX, s.focusY, s.focusZ];
    const designS = s.mount === 'follow' ? S : V.add(F, offset);
    const a = lamp.r, vx = F[0] - f, depth = a * a / (4 * f), xin = vx + depth;
    const env = input.envelope && input.envelope.center && input.envelope.half ? { c0: input.envelope.center[0], h0: input.envelope.half[0] } : null;   // the envelope's far end along x bounds the lens thickness
    return { lamp, f, F, S: designS, actual: S, a, vx, depth, xin, low, env };
  }
  const ACTIVE = { low: [30.75, 0.6], high: [24.05, -0.8] };
  const activeOf = (src, s) => ACTIVE[/-high$/.test(src.preset || '') ? 'high' : /-low$/.test(src.preset || '') ? 'low' : s.beam];
  const isH4 = (src, s) => s.assembly === 'h4' || (s.assembly === 'auto' && /^h4-assembly-/.test(src.preset || ''));
  function bulbSurfaces(src, s) {
    if (!isH4(src, s)) return [];
    const { a, u, v } = RF.Source.frame(src), active = activeOf(src, s);
    const O = V.sub(src.pos, V.add(V.mul(a, active[0]), V.mul(v, active[1]))), at = (x, y, z) => V.add(O, V.add(V.mul(a, x), V.add(V.mul(u, y), V.mul(v, z))));
    const surf = [], R = s.bulbRadius, wall = s.bulbWall, ri = R - wall, glass = glassOf(s.bulbIor);
    const tube = (id, r, x0, x1, front, optics) => surf.push({ type: 'rev', id: 'sb2_bulb_' + id, O, W: a, ref: u, seg: { kind: 'line', z0: x0, r0: r, z1: x1, r1: r }, front, optics });
    const disc = (id, x, r, n, optics) => surf.push({ type: 'plane', id: 'sb2_bulb_' + id, P: at(x, 0, 0), n: V.mul(a, n), clip: { kind: 'disc', r }, optics });
    if (s.bulbGlass) {
      tube('glass_outer', R, 20, 36, -1, glass); tube('glass_inner', ri, 20, 36 - wall, 1, glass);
      disc('glass_front_outer', 36, R, 1, glass); disc('glass_front_inner', 36 - wall, ri, -1, glass);
      // Rear annulus closes the shell; the central stem/holder is opaque (shape ASSUMED).
      surf.push({ type: 'rev', id: 'sb2_bulb_glass_back', O, W: a, ref: u, seg: { kind: 'line', z0: 20, r0: ri, z1: 20, r1: R }, front: -1, optics: glass });
      disc('stem', 20, ri, -1, ABSORB);
    }
    if (s.bulbTip) { tube('tip_side', R + 0.01, 33, 36.01, 1, ABSORB); disc('tip_front', 36.01, R + 0.01, 1, ABSORB); }
    if (s.bulbCup) {
      // H4/3 rim plane HH, right lip 15° down; H4/4 passing axis c = 0.6 mm above HH.
      // Cup radius/length/end-wall form ASSUMED. Both beams retain the same physical cup.
      const r = s.cupRadius, T = 16, end = Math.PI - 15 * D2R;
      for (let k = 0; k < T; k++) {
        const t0 = end * k / T, t1 = end * (k + 1) / T, yz = (t) => [r * Math.cos(t), -r * Math.sin(t)];
        const [y0, z0] = yz(t0), [y1, z1] = yz(t1), pts = [at(28.5, y0, z0), at(34, y0, z0), at(34, y1, z1), at(28.5, y1, z1)];
        surf.push({ type: 'plane', id: 'sb2_bulb_cup' + k, P: pts[0], n: V.norm(V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0]))), clip: { kind: 'poly', pts3: pts }, optics: ABSORB });
        const cap = [at(34, 0, 0), at(34, y0, z0), at(34, y1, z1)];
        surf.push({ type: 'plane', id: 'sb2_bulb_cup_end' + k, P: cap[0], n: a, clip: { kind: 'poly', pts3: cap }, optics: ABSORB });
      }
    }
    return surf;
  }
  const POSE_KEYS = ['sourceFwd', 'sourceLeft', 'sourceUp', 'sourceAz', 'sourceEl', 'sourceRoll'];
  function poseOf(scene, s) {
    const F = layout({ source: scene.source, envelope: scene.envelope }, s).F, d = V.sub(scene.source.pos, F), ae = V.toAzEl(scene.source.axis);
    return { sourceFwd: d[0], sourceLeft: d[1], sourceUp: d[2], sourceAz: ae[0], sourceEl: ae[1], sourceRoll: scene.source.roll || 0 };
  }
  // UI/CLI helper, outside solve: edits existing scene.source fields, never a new solver output/API field.
  function adjustSource(scene, s, changed) {
    if (s.mount === 'follow' && (changed || []).some((k) => POSE_KEYS.slice(0, 3).includes(k))) throw new Error('Filament offsets require fixed mounting; in follow mode edit the ordinary Source position.');
    const keys = changed || [], pose = Object.assign(poseOf(scene, s), Object.fromEntries(POSE_KEYS.filter((k) => keys.includes(k)).map((k) => [k, s[k]])));
    if (keys.includes('sourceModel') || keys.includes('beam')) {
      const id = s.sourceModel === 'sealed' ? 'sealed-beam-assumed-' + s.beam : s.sourceModel === 'h4' ? 'h4-assembly-' + s.beam : null;
      if (id) {
        const src = scene.source, keepMount = keys.includes('beam') && s.sourceModel === 'h4' && /^h4-assembly-/.test(src.preset || '');
        const old = keepMount ? { pos: src.pos.slice(), axis: src.axis.slice(), roll: src.roll || 0, fr: RF.Source.frame(src), active: activeOf(src, s) } : null;
        RF.SourcePresets.apply(src, id);
        if (old) {
          // Select the other filament inside the SAME mounted bulb, rather than translating the entire assembly.
          src.axis = old.axis; src.roll = old.roll;
          const active = activeOf(src, s), d = V.add(V.mul(old.fr.a, active[0] - old.active[0]), V.mul(old.fr.v, active[1] - old.active[1]));
          src.pos = V.add(old.pos, d); Object.assign(pose, poseOf(scene, s));
        } else { const ae = V.toAzEl(src.axis); pose.sourceAz = ae[0]; pose.sourceEl = ae[1]; pose.sourceRoll = 0; }
      }
      for (const k of POSE_KEYS) if (keys.includes(k)) pose[k] = s[k];
    }
    const F = layout({ source: scene.source, envelope: scene.envelope }, s).F;
    scene.source.pos = V.add(F, [pose.sourceFwd, pose.sourceLeft, pose.sourceUp]);
    scene.source.axis = V.fromAzEl(pose.sourceAz, pose.sourceEl); scene.source.roll = pose.sourceRoll;
    Object.assign(s, pose);
    return pose;
  }
  function replaceBulb(scene, s) {
    const a = scene.groups.A.surfaces;
    if (!a.some((f) => f.id === 'sb_reflector')) return false;
    scene.groups.A.surfaces = a.filter((f) => !f.id.startsWith('sb2_bulb_')).concat(bulbSurfaces(scene.source, s));
    return true;
  }

  // scene hook for sealed-beam-v2 (RF.Solvers.prepareScene, SOLVER_API.md): source pose / bulb settings edit scene.source before a solve or retrace
  RF.SolverHooks = RF.SolverHooks || {}; RF.SolverHooks['sealed-beam-v2'] = { prepareScene: (scene, settings, setKeys) => adjustSource(scene, settings, setKeys) };
  RF.SealedBeamSource = { layout, isH4, bulbSurfaces, POSE_KEYS, poseOf, adjustSource, replaceBulb };
})(typeof globalThis !== 'undefined' ? globalThis : this);
