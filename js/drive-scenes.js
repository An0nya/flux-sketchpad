/* drive-scenes.js — the places the Drive view can light: an open road, a forest, a city street. Pure: builds the primitives and
 * the ground markings that drive.js renders. Everything is placed in road coordinates (s metres along the lane centre, off metres
 * to its left), so the same scene follows a straight road or an IIHS bend.
 *
 * These are sketches, on purpose: a tree is a trunk and three blobs, a deer is five ellipsoids and two retroreflecting eyes. What
 * matters for judging a beam is where the light goes and how much comes back — retroreflective sheeting, eyes, hi-vis tape and
 * lane paint are bright; bark, fur, dark clothing and wet leaves are nearly black; windows glow by themselves.
 * Sizes, spacings and sheeting classes are plausible, not surveyed.                                                         */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {}), D = RF.Drive;
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // ---------------------------------------------------------------- building blocks
  function kit(ctx) {
    const O = [], R = ctx.rand, Lw = ctx.Lw, edgeR = -Lw / 2, edgeL = 1.5 * Lw;
    const at = (s, off) => { if (ctx.A) { const q = ctx.A.at(s, off); return { x: q.p[0], y: q.p[1], yaw: Math.atan2(q.t[1], q.t[0]) }; } return { x: s, y: off, yaw: 0 }; };
    const add = (ob) => { O.push(ob); return ob; };
    const k = {
      O, at, add, edgeR, edgeL,
      // a post with a reflector on the face toward the oncoming car
      post(s, off, o) {
        o = o || {}; const p = at(s, off), h = o.h || 1.0;
        add({ k: 'cyl', x: p.x, y: p.y, r: 0.045, z0: 0, z1: h, mat: 'sign-back' });
        add({ k: 'disc', x: p.x - 0.05 * Math.cos(p.yaw), y: p.y - 0.05 * Math.sin(p.yaw), z: h - 0.15, r: 0.04, nx: -Math.cos(p.yaw), ny: -Math.sin(p.yaw), nz: 0, sub: true, mat: o.red ? 'reflector-red' : 'reflector-white' });
      },
      // a board on a pole: face = 'green' (direction sign with legend bars) | 'yellow' (warning) | 'white' (speed/regulatory)
      sign(s, off, face, o) {
        o = o || {}; const p = at(s, off), w = o.w || 1.6, hh = o.h || 0.9, z0 = o.z0 || 2.0, key = { green: 'sign-green', yellow: 'sign-yellow', white: 'sign-white' }[face];
        add({ k: 'cyl', x: p.x, y: p.y, r: 0.05, z0: 0, z1: z0 + hh, mat: 'sign-back' });
        const legend = ({ u, z, face: f }) => {
          if (f !== 0) return 'sign-back';
          const zc = z0 + hh / 2, edge = Math.abs(u) > w / 2 - 0.07 || z < z0 + 0.07 || z > z0 + hh - 0.07;
          if (face === 'green') return edge || (Math.abs(z - zc - 0.2) < 0.06 && Math.abs(u) < w * 0.3) || (Math.abs(z - zc + 0.1) < 0.06 && Math.abs(u) < w * 0.38) ? 'sign-white' : 'sign-green';
          if (face === 'yellow') return Math.abs(u) < 0.07 && z > z0 + 0.2 && z < z0 + hh - 0.25 ? 'cloth-dark' : (Math.abs(u) < 0.07 && z > z0 + 0.1 && z < z0 + 0.18 ? 'cloth-dark' : (edge ? 'cloth-dark' : key));
          return edge ? 'cloth-dark' : (Math.abs(z - (z0 + hh / 2)) < 0.12 && Math.abs(u) < 0.25 ? 'cloth-dark' : key);
        };
        add({ k: 'box', x: p.x + 0.07 * Math.cos(p.yaw), y: p.y + 0.07 * Math.sin(p.yaw), z0, z1: z0 + hh, hx: 0.02, hy: w / 2, yaw: p.yaw, mat: legend });
      },
      tree(s, off, o) {
        o = o || {}; const p = at(s, off), h = o.h || (7 + 8 * R()), tr = o.r || (0.12 + 0.18 * R()), birch = o.birch;
        add({ k: 'cyl', x: p.x, y: p.y, r: tr, z0: 0, z1: h * 0.55, mat: birch ? 'trunk-birch' : 'bark' });
        const n = 3; for (let i = 0; i < n; i++) {
          const f = i / (n - 1), rr = (1.1 + 1.6 * R()) * (1.15 - 0.5 * f), zz = h * (0.5 + 0.38 * f);
          add({ k: 'ell', x: p.x + (R() - 0.5) * 0.9, y: p.y + (R() - 0.5) * 0.9, z: zz, rx: rr, ry: rr, rz: rr * 1.15, mat: 'foliage' });
        }
      },
      bush(s, off, r) { const p = at(s, off); add({ k: 'ell', x: p.x, y: p.y, z: r * 0.55, rx: r, ry: r, rz: r * 0.6, mat: 'foliage' }); },
      // a deer standing broadside to the road with its head turned toward the car: body, neck, head, four legs, two eyes
      deer(s, off) {
        const p = at(s, off), c = Math.cos(p.yaw), sn = Math.sin(p.yaw), L = (a, b) => [p.x + a * c - b * sn, p.y + a * sn + b * c];   // a along the road, b to the left
        const body = L(0, 0); add({ k: 'ell', x: body[0], y: body[1], z: 0.95, rx: 0.2, ry: 0.6, rz: 0.34, mat: 'fur' });
        const neck = L(0, -0.55); add({ k: 'ell', x: neck[0], y: neck[1], z: 1.25, rx: 0.12, ry: 0.22, rz: 0.3, mat: 'fur' });
        const head = L(-0.12, -0.82); add({ k: 'ell', x: head[0], y: head[1], z: 1.5, rx: 0.2, ry: 0.1, rz: 0.1, mat: 'fur' });
        for (const [a, b] of [[-0.1, 0.4], [0.1, 0.4], [-0.1, -0.4], [0.1, -0.4]]) { const q = L(a, b); add({ k: 'cyl', x: q[0], y: q[1], r: 0.04, z0: 0, z1: 0.65, mat: 'fur' }); }
        for (const side of [-0.05, 0.05]) { const e = L(-0.31, -0.82 + side); add({ k: 'disc', x: e[0], y: e[1], z: 1.52, r: 0.013, nx: -c, ny: -sn, nz: 0, sub: true, mat: 'eyeshine' }); }
      },
      // a pedestrian: 'dark' clothes | 'hivis' vest with tape | 'light' clothes
      person(s, off, kind) {
        const p = at(s, off), legs = kind === 'light' ? 'cloth-dark' : 'cloth-dark', torso = ({ dark: 'cloth-dark', hivis: 'hivis', light: 'cloth-light' })[kind] || 'cloth-dark';
        for (const dy of [-0.1, 0.1]) { const q = at(s, off + dy); add({ k: 'cyl', x: q.x, y: q.y, r: 0.085, z0: 0, z1: 0.85, mat: legs }); }
        add({ k: 'cyl', x: p.x, y: p.y, r: 0.2, z0: 0.85, z1: 1.5, mat: kind === 'hivis' ? ({ z }) => ((z > 1.0 && z < 1.06) || (z > 1.26 && z < 1.32) ? 'hivis-tape' : 'hivis') : torso });
        add({ k: 'ell', x: p.x, y: p.y, z: 1.64, rx: 0.1, ry: 0.09, rz: 0.12, mat: 'skin' });
      },
      // a car, seen from any side. face = +1 heads along the road's direction, −1 against it (an oncoming car); turn rotates it (cross
      // traffic: ±π/2). lamps: 'head' (white, kcd = its intensity toward the viewer), 'tail' (red), or false. Lamps are emitters with the
      // luminance that gives that intensity; the face toward the road's start carries a plate, and the rear red reflectors.
      car(s, off, o) {
        o = o || {}; const p = at(s, off), yaw = p.yaw + (o.turn || 0), c = Math.cos(yaw), sn = Math.sin(yaw), F = o.face === -1 ? -1 : 1, L = (a, b) => [p.x + a * c - b * sn, p.y + a * sn + b * c];
        add({ k: 'box', x: p.x, y: p.y, z0: 0.25, z1: 0.85, hx: 2.2, hy: 0.9, yaw, mat: 'car-paint' });
        const cb = L(-F * 0.2, 0); add({ k: 'box', x: cb[0], y: cb[1], z0: 0.85, z1: 1.4, hx: 1.2, hy: 0.78, yaw, mat: ({ face }) => (face === 5 ? 'car-paint' : 'win-dark') });
        for (const a of [-1.35, 1.35]) for (const b of [-0.85, 0.85]) { const q = L(a, b); add({ k: 'box', x: q[0], y: q[1], z0: 0, z1: 0.64, hx: 0.32, hy: 0.11, yaw, mat: 'tyre' }); }
        const front = L(F * 2.21, 0), rear = L(-F * 2.21, 0), nF = [F * c, F * sn], face = (end, nrm, b, z, r, mat, extra) => { const q = L(end, b); add(Object.assign({ k: 'disc', x: q[0], y: q[1], z, r, nx: nrm[0], ny: nrm[1], nz: 0, sub: r < 0.07, mat }, extra)); };
        void front; void rear;
        const lampR = o.lamps === 'head' ? 0.06 : 0.045, kcd = (o.kcd || 30) * 1000;
        if (o.lamps === 'head') for (const b of [-0.62, 0.62]) face(F * 2.21, nF, b, 0.68, lampR, 'lamp-head', { emitPow: 8, emit: ((I) => { const Lm = I / (Math.PI * lampR * lampR); return [Lm, Lm, 0.93 * Lm]; })(kcd / 2) });   // a headlamp is a beam: cos^8 ≈ ±20° to 60 %, nothing at 70° (cross traffic)
        if (o.lamps === 'tail') for (const b of [-0.7, 0.7]) face(-F * 2.21, [-nF[0], -nF[1]], b, 0.78, lampR, 'lamp-head', { emitPow: 2, emit: ((I) => { const Lm = I / (Math.PI * lampR * lampR); return [Lm, 0.03 * Lm, 0.015 * Lm]; })(o.tailCd || 80) });
        face(F * 2.21, nF, 0, 0.55, 0.15, 'plate'); face(-F * 2.21, [-nF[0], -nF[1]], 0, 0.55, 0.15, 'plate');
        for (const b of [-0.7, 0.7]) face(-F * 2.21, [-nF[0], -nF[1]], b, 0.62, 0.035, 'reflector-red');
      },
      // a traffic-signal head facing the approaching car at (s, off, z), one lamp lit: 'red' | 'green'
      signal(s, off, z, lit) {
        const p = at(s, off), c = Math.cos(p.yaw), sn = Math.sin(p.yaw), cols = { red: [1.2e4, 300, 200], amber: [1.2e4, 5e3, 100], green: [200, 8000, 3500] }, dz = { red: 0.34, amber: 0, green: -0.34 };
        add({ k: 'box', x: p.x, y: p.y, z0: z - 0.55, z1: z + 0.55, hx: 0.17, hy: 0.19, yaw: p.yaw, mat: 'pole' });
        for (const key of ['red', 'amber', 'green']) add({ k: 'disc', x: p.x - 0.18 * c, y: p.y - 0.18 * sn, z: z + dz[key], r: 0.1, nx: -c, ny: -sn, nz: 0, mat: 'pole', emitPow: 2, emit: key === lit ? cols[key] : null });
      },
      parkedCar(s, off) { this.car(s, off, { face: 1 }); },
    };
    return k;
  }

  // ---------------------------------------------------------------- scenes
  const SCENES = {
    road: {
      label: 'Open road',
      build(ctx, o) {
        const k = kit(ctx), us = ctx.us;
        for (let s = 20; s < 300; s += 50) { k.post(s, k.edgeR - 0.9); k.post(s + 25, k.edgeL + 0.9); }          // delineators: white right, white left (EU: red-white; plain here)
        if (o.signs) { k.sign(95, k.edgeR - 2.2, 'green', { w: 1.8, h: 1.0 }); k.sign(150, k.edgeL + 2.0, 'yellow', { w: 0.8, h: 0.8 }); k.sign(215, k.edgeR - 2.0, 'white', { w: 0.7, h: 0.9 }); }
        if (o.people) { k.person(55, k.edgeR - 1.6, 'dark'); k.person(95, k.edgeL + 1.4, 'hivis'); k.person(32, k.edgeL + 1.2, 'light'); }
        if (o.animals) { k.deer(70, k.edgeL + 3.5); k.deer(125, k.edgeR - 4); }
        for (let s = 10; s < 300; s += 17) { k.bush(s, k.edgeR - 4.5 - 3 * ctx.rand(), 0.6 + 0.5 * ctx.rand()); k.bush(s + 5, k.edgeL + 4.5 + 3 * ctx.rand(), 0.6 + 0.5 * ctx.rand()); }
        return { objects: k.O, markings: D.laneMarkings(ctx.Lw, { us }), verge: ['gravel', 1.6, 'grass'] };
      },
    },
    forest: {
      label: 'Forest road',
      build(ctx, o) {
        const k = kit(ctx), R = ctx.rand;
        for (const side of [1, -1]) for (let s = 4; s < 280; s += 3.2 + 4 * R()) {
          const off = side > 0 ? k.edgeL + 2.6 + 9 * R() * R() : k.edgeR - 2.6 - 9 * R() * R();
          k.tree(s, off, { birch: R() < 0.18 });
          if (R() < 0.6) { const off2 = side > 0 ? k.edgeL + 12 + 28 * R() : k.edgeR - 12 - 28 * R(); k.tree(s + 2 * R(), off2); }
          if (R() < 0.35) k.bush(s + 1.5, side > 0 ? k.edgeL + 1.8 + 2 * R() : k.edgeR - 1.8 - 2 * R(), 0.5 + 0.5 * R());
        }
        for (let s = 25; s < 280; s += 50) k.post(s, k.edgeR - 0.9);
        if (o.signs) k.sign(115, k.edgeR - 2.0, 'yellow', { w: 0.8, h: 0.8 });
        if (o.animals) { k.deer(48, k.edgeR - 3.2); k.deer(88, k.edgeL + 3.0); k.deer(130, k.edgeL + 5.5); }
        if (o.people) { k.person(70, k.edgeR - 1.4, 'dark'); k.person(40, k.edgeL + 1.3, 'hivis'); }
        return { objects: k.O, markings: D.laneMarkings(ctx.Lw, { us: ctx.us }), verge: ['gravel', 1.0, 'leaves'] };
      },
    },
    city: {
      label: 'City street',
      build(ctx, o) {
        const k = kit(ctx), R = ctx.rand, walk = 3.0, setback = 2.5, win = ({ u, z, face }, seed) => {   // windows on the faces seen from the road
          const gx = Math.floor((u + 400) / 2.6), gz = Math.floor(z / 3.2), cell = (u + 400) / 2.6 - gx, cz = z / 3.2 - gz;
          if (z < 3.0 || cell < 0.2 || cell > 0.8 || cz < 0.25 || cz > 0.8) return face === 0 ? 'wall-light' : 'wall';
          const h = Math.sin((gx + 1) * 12.9898 + (gz + 1) * 78.233 + seed * 3.1) * 43758.5453, f = h - Math.floor(h);
          return f < 0.22 ? 'win-warm' : f < 0.3 ? 'win-cool' : 'win-dark';
        };
        for (const side of [1, -1]) for (let s = -8, i = 0; s < 280; s += 15 + 14 * R(), i++) {
          const len = 12 + 10 * R(), hgt = 9 + 18 * R(), dep = 7 + 4 * R(), off = side > 0 ? k.edgeL + walk + setback + dep : k.edgeR - walk - setback - dep, p = k.at(s + len, off), seed = i + (side > 0 ? 0 : 50);
          k.add({ k: 'box', x: p.x, y: p.y, z0: 0, z1: hgt, hx: len, hy: dep, yaw: p.yaw, mat: (h) => win(h, seed) });
        }
        for (let s = 12; s < 280; s += 32) for (const side of [1, -1]) { const off = side > 0 ? k.edgeL + 0.9 : k.edgeR - 0.9; k.add({ k: 'cyl', x: k.at(s, off).x, y: k.at(s, off).y, r: 0.07, z0: 0, z1: 7.5, mat: 'pole' }); }
        for (let s = 20; s < 160; s += 11 + 9 * R()) k.parkedCar(s, k.edgeR - 1.3);
        for (let s = 30; s < 140; s += 17 + 10 * R()) k.parkedCar(s + 5, k.edgeL + 1.3 + 0.9);
        if (o.signs) { k.sign(75, k.edgeR - 1.0, 'white', { w: 0.6, h: 0.8, z0: 2.0 }); k.sign(135, k.edgeR - 1.0, 'green', { w: 1.4, h: 0.7, z0: 2.3 }); }
        if (o.people) { k.person(48, 0.3, 'dark'); k.person(48.4, -1.4, 'hivis'); k.person(46, k.edgeL + 1.5, 'light'); k.person(92, k.edgeR - 2.0, 'dark'); }
        if (o.animals) k.deer(110, k.edgeL + 2.2);
        const marks = D.laneMarkings(ctx.Lw, { us: ctx.us });
        for (let b = k.edgeR + 0.4; b < k.edgeL - 0.2; b += 1.0) marks.push({ o0: b, o1: b + 0.5, mat: 'white-paint', pat: { s0: 40, s1: 1e5, period: 1e6, on: 3.5 } });   // zebra crossing, 40–43.5 m
        marks.push({ o0: k.edgeR, o1: 0.2 + ctx.Lw / 2 - 0.4, mat: 'white-paint', pat: { s0: 38, s1: 1e5, period: 1e6, on: 0.4 } });                                                 // stop line in our lane
        return { objects: k.O, markings: marks, verge: ['concrete', walk, 'concrete'] };
      },
    },
  };
  SCENES.intersection = {
    label: 'Intersection',
    build(ctx, o) {
      const k = kit(ctx), R = ctx.rand, Lw = ctx.Lw, us = ctx.us, edgeR = k.edgeR, edgeL = k.edgeL, walk = 3.0, Wc = 2 * Lw + 0.4, c0 = 44, c1 = c0 + Wc;
      // the road's own markings stop before the intersection and resume after it
      const marks = D.laneMarkings(Lw, { us }); for (const m of marks) m.skip = [[c0 - 5.5, c1 + 4.5]];
      // four crossings: across the main road on the near and far side (bars parallel to travel), and across both legs of the cross street
      const across = (s0, len) => { for (let b = edgeR + 0.5; b < edgeL - 0.4; b += 1.0) marks.push({ o0: b, o1: b + 0.5, mat: 'white-paint', pat: { s0, s1: 1e5, period: 1e6, on: len } }); };
      across(c0 - 4.0, 3.0); across(c1 + 1.0, 3.0);
      const leg = (o0, o1) => marks.push({ o0, o1, mat: 'white-paint', pat: { s0: c0 + 0.5, s1: c1 - 0.4, period: 1.0, on: 0.5 } });
      leg(edgeL + 1.5, edgeL + 4.5); leg(edgeR - 4.5, edgeR - 1.5);
      marks.push({ o0: -Lw / 2 + 0.25, o1: Lw / 2 - 0.15, mat: 'white-paint', pat: { s0: c0 - 5.4, s1: 1e5, period: 1e6, on: 0.4 } });        // our stop line
      const mid = c0 + Wc / 2, cl = us ? 'yellow-paint' : 'white-paint';
      marks.push({ o0: edgeL + 6, o1: edgeL + 80, mat: cl, pat: { s0: mid - 0.08, s1: 1e5, period: 1e6, on: 0.16 } }, { o0: edgeR - 80, o1: edgeR - 6, mat: cl, pat: { s0: mid - 0.08, s1: 1e5, period: 1e6, on: 0.16 } });
      // corner and street-wall buildings, cut where the cross street runs
      const win = ({ u, z, face }, seed) => { const gx = Math.floor((u + 400) / 2.6), gz = Math.floor(z / 3.2), cell = (u + 400) / 2.6 - gx, cz = z / 3.2 - gz;
        if (z < 3.0 || cell < 0.2 || cell > 0.8 || cz < 0.25 || cz > 0.8) return face === 0 ? 'wall-light' : 'wall';
        const h = Math.sin((gx + 1) * 12.9898 + (gz + 1) * 78.233 + seed * 3.1) * 43758.5453, f = h - Math.floor(h); return f < 0.22 ? 'win-warm' : f < 0.3 ? 'win-cool' : 'win-dark'; };
      const bld = (sA, sB, side, dep, hgt, seed) => { const off = side > 0 ? edgeL + walk + 2.5 + dep : edgeR - walk - 2.5 - dep, p = k.at((sA + sB) / 2, off); k.add({ k: 'box', x: p.x, y: p.y, z0: 0, z1: hgt, hx: (sB - sA) / 2, hy: dep, yaw: p.yaw, mat: (h) => win(h, seed) }); };
      for (const side of [1, -1]) { let i = 0;
        for (let s = c1 + walk + 0.5; s < 280; s += 0, i++) { const len = 12 + 10 * R(); bld(s, s + len, side, 7 + 4 * R(), 9 + 18 * R(), i + (side > 0 ? 0 : 40)); s += len + 1.5 + 12 * R(); }
        for (let s = c0 - walk - 0.5, j = 0; s > -30; j++) { const len = 12 + 10 * R(); bld(s - len, s, side, 7 + 4 * R(), 9 + 18 * R(), 80 + j + (side > 0 ? 0 : 40)); s -= len + 1.5 + 12 * R(); } }
      for (const sa of [c0 - walk - 3, c1 + walk + 3, c0 - walk - 35, c1 + walk + 35]) for (const side of [1, -1]) { const off = side > 0 ? edgeL + 0.9 : edgeR - 0.9; k.add({ k: 'cyl', x: k.at(sa, off).x, y: k.at(sa, off).y, r: 0.07, z0: 0, z1: 7.5, mat: 'pole' }); }
      // the signal: a mast over our lane on the far side, red
      const mp = k.at(c1 + 1.2, edgeR - 1.3); k.add({ k: 'cyl', x: mp.x, y: mp.y, r: 0.1, z0: 0, z1: 6.4, mat: 'pole' });
      const am = k.at(c1 + 1.2, (edgeR - 1.3) / 2); k.add({ k: 'box', x: am.x, y: am.y, z0: 6.1, z1: 6.3, hx: 0.06, hy: Math.abs(edgeR - 1.3) / 2 + 0.2, yaw: am.yaw, mat: 'pole' });
      k.signal(c1 + 1.2, 0.0, 5.5, 'red'); k.signal(c1 + 1.2, Lw, 5.5, 'red');
      if (o.signs) k.sign(c1 + 1.0, edgeL + 1.4, 'green', { w: 1.8, h: 0.5, z0: 3.2 });
      // cross traffic: one car on each leg, crossing in opposite directions
      k.car(c0 + Lw * 0.5 + 0.1, edgeL + 8.0, { turn: Math.PI / 2, face: -1, lamps: 'head', kcd: 30 });
      k.car(c0 + Wc - Lw * 0.5 - 0.1, edgeR - 13.0, { turn: Math.PI / 2, face: 1, lamps: 'head', kcd: 30 });
      for (let s = 12; s < c0 - 8; s += 13 + 8 * R()) k.parkedCar(s, edgeR - 1.3);
      if (o.people) { k.person(c0 - 2.5, -0.9, 'dark'); k.person(c0 - 2.5, 2.0, 'hivis'); k.person(c1 + 2.5, 0.6, 'light'); k.person(c0 + 2.2, edgeL + 3.0, 'hivis'); k.person(c0 + 4.0, edgeR - 3.0, 'dark'); }
      return { objects: k.O, markings: marks, verge: ['concrete', walk, 'concrete'], cross: { s0: c0, s1: c1 } };
    },
  };
  // standard test targets for comparing designs (not in the picker): ctx.targets = [{ kind, s, off }] pedestrians, ctx.deer = [s, …] deer on the left shoulder
  SCENES.targets = {
    label: 'Test targets', hidden: true,
    build(ctx) {
      const k = kit(ctx); for (const t of ctx.targets || []) k.person(t.s, t.off, t.kind); for (const s of ctx.deer || []) k.deer(s, k.edgeL + 3.5);
      return { objects: k.O, markings: D.laneMarkings(ctx.Lw, { us: ctx.us }), verge: ['gravel', 1.6, 'grass'] };
    },
  };
  // oncoming and preceding traffic, for any scene: { oncoming: { dist, kcd }, preceding: { dist } }
  function addTraffic(ctx, objects, o) {
    const k = kit(ctx);
    if (o.oncoming && o.oncoming.dist > 0) k.car(o.oncoming.dist, ctx.Lw, { face: -1, lamps: 'head', kcd: o.oncoming.kcd || 30 });
    if (o.preceding && o.preceding.dist > 0) k.car(o.preceding.dist, 0, { face: 1, lamps: 'tail' });
    for (const ob of k.O) objects.push(ob);
  }
  // build a scene by name: ctx { Lw (lane width m), A (RF.Road.arc or null), us (US markings), seed }, o { people, animals, signs }
  function buildScene(name, ctx, o) {
    const sc = SCENES[name] || SCENES.road, c = Object.assign({ Lw: 3.5, A: null, us: false, seed: 7 }, ctx, { rand: rng((ctx && ctx.seed) || 7) }), opt = Object.assign({ people: true, animals: true, signs: true }, o), out = sc.build(c, opt);
    addTraffic(c, out.objects, opt);
    return out;
  }
  RF.Drive.scenes = SCENES; RF.Drive.buildScene = buildScene; RF.Drive.rng = rng;
})(typeof globalThis !== 'undefined' ? globalThis : this);
