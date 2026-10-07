/* road.js — a straight two-lane road lit by the beam: Spec mode's Road view and IIHS-style metrics.
 * Pure: give it the road settings, the angle convention and an intensity lookup I(H, V) in cd that is already aimed
 * (the caller applies the lab's or the user's aim). No DOM, no tracing.
 *
 * Road frame (metres): x ahead of the lamps, y LEFT of the own-lane centre, z up from the ground. Right-hand traffic:
 * the car is centred in the right lane, the oncoming lane is to the left (y > 0).
 * Illuminance at a point from a lamp at L: E = I(direction L→p) · cosθ / r², with r in metres (cd / m² = lx).
 * Sensor facing: 'car' = a vertical plane facing back toward the car (IIHS: "a vertical plane perpendicular to the
 * road"), 'up' = the ground.
 *
 * IIHS (Headlight Test and Rating Protocol, Ver. II 2016 / III 2018 — same numbers): straightaway, 5 lx reached and
 * held until the car is 10 m away (15 m for the left edge), 25 cm above the ground, at the right and left edges of a
 * 6.6 m road (two 3.3 m lanes); glare 110 cm high, 3 m left of the own-lane centre, max 10 lx at 5–10 m.
 * Low-beam visibility demerits (Table 4): right edge 30 − 0.3·d (0 at ≥ 100 m), left edge 27 − 0.45·d (0 at ≥ 60 m). */
(function (root) {
  'use strict';
  const RF = root.RF;
  const PCT = Math.atan(0.01) * 180 / Math.PI;          // 1 % (1 cm per metre) in degrees ≈ 0.573°
  const LANES = { us: 3.6, eu: 3.5, iihs: 3.3 };
  const IIHS = { lane: 3.3, sensorZ: 0.25, glareZ: 1.10, glareY: 3.0, near: 10, nearLeft: 15, far: 250, lux: 5, glareMax: 10 };

  // Regulation geometry. UN R112's test points are written for a 0.75 m lamp: 0.57° / 0.86° / 1.72° D are 1 % / 1.5 % / 3 %
  // of 75 m / 50 m / 25 m, and 75R / 50R sit 1.5 m right of the lamp (1.15° at 75 m, 1.72° at 50 m). FMVSS points are plain
  // angles with no distance behind them, so the US keeps the generic 0.65 m / 3.6 m.
  const REF = { mountH: 0.75, rightEdge: 1.5 };
  const isEce = (preset) => /^ece/.test(preset || '');
  // mountH null = "by preset": a regulation spec forces its own lamp height until the user types one
  function defaults() { return { v: 2, lane: 'auto', mountH: null, spacing: 1.4, two: true, aim: 'spec', aimPct: -1.0 }; }
  function mountDefault(preset) { return isEce(preset) ? REF.mountH : 0.65; }
  // the settings with the preset's own values filled in where the user left them on auto
  function resolve(o, preset) {
    const r = Object.assign(defaults(), o || {});
    if (!(r.mountH > 0)) r.mountH = mountDefault(preset);
    return r;
  }
  // lane width (m): the chosen standard, or by preset (FMVSS → US 12 ft, ECE → the R112 reference: the right edge 1.5 m from
  // the right lamp, which is where 50R and 75R land)
  // real = the lane a driver would see (Drive view): 'auto' gives the region's standard (ECE → EU 3.5 m, FMVSS → US 3.6 m), not the
  // reference road, which is a geometry for placing test points rather than a lane
  function laneWidth(road, preset, real) {
    const sp = road && isFinite(road.spacing) ? road.spacing : 1.4, ref = 2 * REF.rightEdge + sp;
    if (road && road.lane === 'r112') return ref;
    if (road && LANES[road.lane]) return LANES[road.lane];
    return isEce(preset) ? (real ? LANES.eu : ref) : LANES.us;
  }
  // lamp positions: two identical lamps (a real pair: the same beam, not mirror images) ±spacing/2 from the car's
  // centre, or one (the right-hand lamp)
  function lamps(road) { const h = road.mountH, s = road.spacing / 2; return road.two ? [[0, s, h], [0, -s, h]] : [[0, -s, h]]; }

  // A bend of radius R (m), dir 'left' | 'right', the car heading +x on the lane centre (x ahead, y left). at(s, off): the point
  // s metres along the centre line, off metres to its left. frame(x, y): the inverse — distance along, signed offset (+ left),
  // heading (unit tangent). Shared by the IIHS curves, the bird's-eye view and the driver view.
  function arc(R, dir) {
    const sg = dir === 'left' ? 1 : -1;
    const at = (s, off) => {
      const a = s / R, t = [Math.cos(a), sg * Math.sin(a)], o = off || 0;
      return { p: [R * Math.sin(a) - o * t[1], sg * R * (1 - Math.cos(a)) + o * t[0]], t, a };
    };
    const frame = (x, y) => {
      const rx = x, ry = y - sg * R, a = Math.atan2(rx, -sg * ry), rr = Math.hypot(rx, ry);
      return { s: a * R, off: sg > 0 ? R - rr : rr - R, t: [Math.cos(a), sg * Math.sin(a)], a };
    };
    return { R, dir, sg, at, frame };
  }

  function model(o) {
    const road = resolve(o.road, o.preset), conv = o.conv || 'A', I = o.I, ls = lamps(road);
    function lux(p, facing) {
      let E = 0;
      for (const L of ls) {
        const d = [p[0] - L[0], p[1] - L[1], p[2] - L[2]], r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], r = Math.sqrt(r2);
        // ground faces up; the IIHS sensor faces back along the road (straight road: −x); an array = the direction the
        // light must travel to hit the sensor face-on (unit, away from the car)
        const cos = facing === 'up' ? -d[2] / r : Array.isArray(facing) ? (d[0] * facing[0] + d[1] * facing[1] + d[2] * facing[2]) / r : d[0] / r;
        if (!(cos > 0)) continue;
        const hv = RF.FarField.hvOf(d, conv), c = I(hv[0], hv[1]);
        if (c > 0) E += c * cos / r2;
      }
      return E;
    }
    // 5-lux reach along the line (y, z): from the near limit outward, the first drop below 5 lx ends it (0 = never lit)
    function reach(y, z, near, far, step) {
      if (lux([near, y, z]) < IIHS.lux) return 0;
      let x = near; while (x + step <= far && lux([x + step, y, z]) >= IIHS.lux) x += step;
      return x;
    }
    function iihs() {
      const L = IIHS.lane, step = 0.5;
      const right = reach(-L / 2, IIHS.sensorZ, IIHS.near, IIHS.far, step), left = reach(1.5 * L, IIHS.sensorZ, IIHS.nearLeft, IIHS.far, step);
      let glareMax = 0; for (let x = 5; x <= 10; x += 0.25) glareMax = Math.max(glareMax, lux([x, IIHS.glareY, IIHS.glareZ]));
      const glare = []; for (let x = 10; x <= IIHS.far; x += 2) glare.push([x, lux([x, IIHS.glareY, IIHS.glareZ])]);
      // demerit equations as published (not capped: the protocol's "critical value" points are 9 at 70 m / 40 m)
      const dem = { right: Math.max(0, 30 - 0.3 * right), left: Math.max(0, 27 - 0.45 * left) };
      return { right, left, glareMax, glareOver: glareMax > IIHS.glareMax, glare, demerits: dem };
    }
    // IIHS curves: radius R (m), dir 'right' | 'left'. The car is on its lane centre heading +x; the lane centre bends
    // with radius R; distance = travel along the arc (the protocol's). Sensors at the edges of the 3.3 m travel lane,
    // 25 cm up, facing back along the road at their own spot; the shorter edge counts.
    function curve(R, dir) {
      const sg = dir === 'left' ? 1 : -1, hw = IIHS.lane / 2, z = IIHS.sensorZ, step = 0.5, far = 120;
      const at = (s, side) => {                       // side: −1 right edge, +1 left edge
        const a = s / R, c = [R * Math.sin(a), sg * R * (1 - Math.cos(a))], t = [Math.cos(a), sg * Math.sin(a)], nL = [-t[1], t[0]];
        return { p: [c[0] + side * hw * nL[0], c[1] + side * hw * nL[1], z], n: [t[0], t[1], 0] };
      };
      const reachSide = (side) => {
        const ok = (s) => { const q = at(s, side); return lux(q.p, q.n) >= IIHS.lux; };
        if (!ok(IIHS.near)) return 0;
        let s = IIHS.near; while (s + step <= far && ok(s + step)) s += step;
        return s;
      };
      const right = reachSide(-1), left = reachSide(1), d = Math.min(right, left);
      const dem = R >= 200 ? Math.max(0, 10.5 - 0.15 * d) : Math.max(0, 9 - 0.15 * d);   // Table 4: 250 m / 150 m radius
      return { R, dir, right, left, d, demerits: dem };
    }
    function curves() { return [curve(250, 'right'), curve(250, 'left'), curve(150, 'right'), curve(150, 'left')]; }
    // illuminance map over the road for the bird's-eye view: x ahead × y left, at height z, sensor facing. m.arc = { R, dir }:
    // the road bends, and each spot's sensor faces back along the road there (as IIHS's curve sensors do)
    function map(m) {
      const nx = m.nx, ny = m.ny, E = new Float32Array(nx * ny), A = m.arc ? arc(m.arc.R, m.arc.dir) : null;
      for (let j = 0; j < nx; j++) {
        const x = m.x0 + (j + 0.5) * (m.x1 - m.x0) / nx;
        for (let i = 0; i < ny; i++) {
          const y = m.y0 + (i + 0.5) * (m.y1 - m.y0) / ny;
          let face = m.facing; if (A) { const t = A.frame(x, y).t; face = [t[0], t[1], 0]; }
          E[j * ny + i] = lux([x, y, m.z], face);
        }
      }
      return { E, nx, ny, x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1 };
    }
    return { road, lamps: ls, lux, reach, iihs, curve, curves, map };
  }
  // the lookup's aim offset [dh, dv] (reading the beam at (H + dh, V + dv)): the spec judge's own (ev.shift), or a
  // manual R48-style inclination in % that puts the lamp's cut-off (cutV, where the judge found it) at that slope
  function aimShift(road, ev) {
    if (!road || road.aim !== 'manual') return ev && ev.shift ? ev.shift.slice() : [0, 0];
    const cutV = ev && ev.aim && isFinite(ev.aim.cutV) ? ev.aim.cutV : 0;
    return [0, cutV - (road.aimPct || 0) * PCT];
  }
  RF.Road = { PCT, LANES, IIHS, REF, defaults, resolve, mountDefault, laneWidth, lamps, arc, model, aimShift };
})(typeof globalThis !== 'undefined' ? globalThis : this);
