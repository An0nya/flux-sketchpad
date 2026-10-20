// Scene details: the registry of live numbers shown by the drive view's "scene details" overlay, and the small pure maths
// behind them. No DOM, no state of its own. Each metric reads a plain snapshot that drive-anim.js builds from the drive
// state, so the same numbers reach the overlay and RF.DriveAnim.details() and a Node test can check them by hand.
//
// A metric: { id, group, label, unit, applies(s) -> null | reason-string, read(s) -> value }
//   applies returns null when the metric applies to this scene, otherwise the reason it is greyed out.
//   read must only read the snapshot (it never calls anything that advances traffic, activates scenery or draws).
(function () {
  const RF = globalThis.RF;
  const DEG = Math.PI / 180;

  // Illuminance (lx) from a point source of intensity I (cd) at distance r (m) on a surface whose normal makes cosTheta with the ray.
  // E = I cos(theta) / r^2. Zero behind the surface or at r = 0.
  function illuminance(I, r, cosTheta) { return r > 0 && cosTheta > 0 ? I * cosTheta / (r * r) : 0; }

  // Angle in degrees between two 3-vectors (need not be unit length). NaN when either is zero.
  function angleDeg(a, b) {
    const na = Math.hypot(a[0], a[1], a[2]), nb = Math.hypot(b[0], b[1], b[2]);
    if (!(na > 0 && nb > 0)) return NaN;
    const c = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)));
    return Math.acos(c) / DEG;
  }

  // Running maximum and the place it happened (the distance, for oncoming cars). Ties keep the first.
  function peakTracker() {
    return {
      value: 0, at: null,
      update(v, at) { if (v > this.value) { this.value = v; this.at = at; } return this; },
      reset() { this.value = 0; this.at = null; return this; },
    };
  }

  // Walks d = from, from + step, ... up to max and returns the first d where ok(d) is false; max if none fails.
  // Steps are indexed, not accumulated, so there is no float drift over hundreds of steps.
  function firstFailure(ok, step, max, from = 0) {
    const n = Math.floor(max / step);
    for (let i = Math.ceil(from / step); i <= n; i++) if (!ok(i * step)) return i * step;
    return max;
  }

  // Illuminance (lx) on the road from our own lamps at a ground point. Uses the same beam model as the rendered frame:
  // candela toward the point (ownBeamAt) times the road incidence cosine (lamp height / r), over r^2.
  // lamps: [[x, y, z], ...] in the lamp frame; beamAt(dx, dy, dz, side) returns candela (RF.Drive.ownBeamAt bound to p).
  function roadLux(lamps, beamAt, x, y) {
    let E = 0;
    for (const L of lamps) {
      const dx = x - L[0], dy = y - L[1], dz = -L[2], r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2);
      if (!(dx > 0)) continue;
      E += illuminance(beamAt(dx, dy, dz, L[1]), r, -dz / r);
    }
    return E;
  }

  // Registry. Pure data plus functions. Add a metric with register(); ids must be unique.
  const METRICS = [];
  const ids = new Set();
  function register(m) {
    if (!m || typeof m.id !== 'string' || !m.id) throw new Error('scene-details: a metric needs an id');
    if (ids.has(m.id)) throw new Error('scene-details: duplicate metric id ' + m.id);
    if (typeof m.read !== 'function') throw new Error('scene-details: ' + m.id + ' needs read(snapshot)');
    ids.add(m.id); METRICS.push(Object.assign({ group: 'own', unit: '', applies: () => null }, m));
    return m;
  }
  const always = () => null;
  const onlyWhen = (ok, why) => (s) => (ok(s) ? null : why);

  register({ id: 'speed', group: 'own', label: 'Speed', unit: 'km/h', read: (s) => s.speedKmh });
  register({ id: 'highBeam', group: 'own', label: 'High beam', read: (s) => s.highMode });
  register({ id: 'ahbReason', group: 'own', label: 'Auto high-beam reason', applies: onlyWhen((s) => s.highMode === 'auto', 'auto high beam is off'), read: (s) => s.autoReason });
  register({ id: 'afsYaw', group: 'own', label: 'AFS yaw', unit: '°', applies: onlyWhen((s) => s.afs, 'AFS is off'), read: (s) => s.afsYawDeg });
  register({ id: 'radius', group: 'own', label: 'Road radius now', unit: 'm', read: (s) => s.radius });
  register({ id: 'radius100', group: 'own', label: 'Road radius, next 100 m (tightest)', unit: 'm', read: (s) => s.radius100 });
  register({ id: 'grade', group: 'own', label: 'Grade', unit: '%', applies: onlyWhen((s) => s.pass, 'the pass only'), read: (s) => s.gradePct });
  register({ id: 'bank', group: 'own', label: 'Bank', unit: '%', applies: onlyWhen((s) => s.pass, 'the pass only'), read: (s) => s.bankPct });

  RF.SceneDetails = { illuminance, angleDeg, peakTracker, firstFailure, roadLux, register, METRICS, HAZARD_LUX: 1, always, onlyWhen };
})();
