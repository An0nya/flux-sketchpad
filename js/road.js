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

  function defaults() { return { lane: 'auto', mountH: 0.65, spacing: 1.4, two: true, aim: 'spec', aimPct: -1.0 }; }
  // lane width (m): the chosen standard, or by preset (FMVSS → US 12 ft, ECE → EU)
  function laneWidth(road, preset) {
    if (road && LANES[road.lane]) return LANES[road.lane];
    return /^ece/.test(preset || '') ? LANES.eu : LANES.us;
  }
  // lamp positions: two identical lamps (a real pair: the same beam, not mirror images) ±spacing/2 from the car's
  // centre, or one (the right-hand lamp)
  function lamps(road) { const h = road.mountH, s = road.spacing / 2; return road.two ? [[0, s, h], [0, -s, h]] : [[0, -s, h]]; }

  function model(o) {
    const road = Object.assign(defaults(), o.road || {}), conv = o.conv || 'A', I = o.I, ls = lamps(road);
    function lux(p, facing) {
      let E = 0;
      for (const L of ls) {
        const d = [p[0] - L[0], p[1] - L[1], p[2] - L[2]], r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], r = Math.sqrt(r2);
        const cos = facing === 'up' ? -d[2] / r : d[0] / r;           // ground faces up; the IIHS sensor faces the car
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
    // illuminance map over the road for the bird's-eye view: x ahead × y left, at height z, sensor facing
    function map(m) {
      const nx = m.nx, ny = m.ny, E = new Float32Array(nx * ny);
      for (let j = 0; j < nx; j++) {
        const x = m.x0 + (j + 0.5) * (m.x1 - m.x0) / nx;
        for (let i = 0; i < ny; i++) E[j * ny + i] = lux([x, m.y0 + (i + 0.5) * (m.y1 - m.y0) / ny, m.z], m.facing);
      }
      return { E, nx, ny, x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1 };
    }
    return { road, lamps: ls, lux, reach, iihs, map };
  }
  // the lookup's aim offset [dh, dv] (reading the beam at (H + dh, V + dv)): the spec judge's own (ev.shift), or a
  // manual R48-style inclination in % that puts the lamp's cut-off (cutV, where the judge found it) at that slope
  function aimShift(road, ev) {
    if (!road || road.aim !== 'manual') return ev && ev.shift ? ev.shift.slice() : [0, 0];
    const cutV = ev && ev.aim && isFinite(ev.aim.cutV) ? ev.aim.cutV : 0;
    return [0, cutV - (road.aimPct || 0) * PCT];
  }
  RF.Road = { PCT, LANES, IIHS, defaults, laneWidth, lamps, model, aimShift };
})(typeof globalThis !== 'undefined' ? globalThis : this);
