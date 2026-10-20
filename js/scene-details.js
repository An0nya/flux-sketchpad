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

  // The far edge of a lit stretch: walking outward from 'from', the first distance where ok fails after it has held. null if ok never holds
  // (nothing lit), max if the stretch runs to max. Unlike firstFailure, the near field (not yet lit) is not an edge.
  function litEdge(ok, step, max, from = 0) {
    const n = Math.floor(max / step); let lit = false;
    for (let i = Math.ceil(from / step); i <= n; i++) {
      const d = i * step;
      if (ok(d)) lit = true; else if (lit) return d;
    }
    return lit ? max : null;
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

  // The strongest glare source at the eye, looking along dir: the largest veil term 10 lux / theta^2 (theta at least 1 deg, as veilAt).
  // sources: [[dx, dy, dz, lux], ...] as drive.js glareSources makes them. Returns {angle (deg off dir), lux} or null.
  function topSource(dir, sources) {
    let best = null, bestVeil = -Infinity;
    for (const q of sources || []) {
      const th = Math.max(1, angleDeg(dir, q.slice(0, 3)));
      const veil = 10 * q[3] / (th * th);
      if (veil > bestVeil) { bestVeil = veil; best = { angle: th, lux: q[3] }; }
    }
    return best;
  }

  // Peak bookkeeping for the oncoming list. samplePeaks records each car's lux into its own tracker (cars ahead only) and forgets
  // cars that are no longer listed. luxAt(car) -> lux at that car's eye from our beam now.
  function samplePeaks(peaks, cars, luxAt) {
    const here = new Set(cars.map((c) => c.id));
    for (const id of peaks.keys()) if (!here.has(id)) peaks.delete(id);
    for (const c of cars) {
      if (!(c.rel > 0)) continue;
      if (!peaks.has(c.id)) peaks.set(c.id, peakTracker());
      peaks.get(c.id).update(luxAt(c), c.rel);
    }
    return peaks;
  }

  // The nearest n cars ahead as rows: distance (m), lux at their eye now, their peak so far and the distance it happened at, and the
  // angle off our beam axis. angleAt(car) -> degrees. Cars behind us are not listed.
  function oncomingRows(cars, n, luxAt, angleAt, peaks) {
    return cars.filter((c) => c.rel > 0).sort((a, b) => a.rel - b.rel).slice(0, n).map((c) => {
      const pk = peaks.get(c.id) || { value: NaN, at: null };
      return { id: c.id, dist: c.rel, lux: luxAt(c), peak: pk.value, peakAt: pk.at, angle: angleAt(c) };
    });
  }

  // Display text. A metric's own text(value) wins (lists and special readouts); otherwise the number to its precision and unit.
  // A metric that does not apply shows its reason instead of a value.
  function display(m, value, na) {
    if (na) return 'n/a (' + na + ')';
    if (m.text) return m.text(value);
    const f = format(value, m.unit);
    return typeof value === 'number' && isFinite(value) && m.unit ? f + ' ' + m.unit : f;
  }

  // Hazards: pedestrians and deer within this distance ahead count as near. Lit means at least HAZARD_LUX on the face toward the car.
  const HAZARD_RANGE = 150, HAZARD_LUX = 1;

  // Illuminance (lx) on a face with unit normal n at point P, from our lamps (same beam model as roadLux). The face sees a lamp only
  // when the lamp is ahead of it and the ray meets its front: cos = -(n . d) / r with d = P - lamp.
  function faceLux(lamps, beamAt, P, n) {
    let E = 0;
    for (const L of lamps) {
      const dx = P[0] - L[0], dy = P[1] - L[1], dz = P[2] - L[2], r = Math.hypot(dx, dy, dz);
      if (!(dx > 0) || !(r > 0)) continue;
      E += illuminance(beamAt(dx, dy, dz, L[1]), r, -(n[0] * dx + n[1] * dy + n[2] * dz) / r);
    }
    return E;
  }

  // Hazard counts, per actor. An actor is a group of parts (a pedestrian is about four parts, a deer about nine): hazards = [[{x, y, z}, ...], ...]
  // in the drive frame. o = { eye [x,y,z], hfov (deg), occludedAt(P) -> bool, luxAt(P) -> lx }.
  // near: the actor's mean position is ahead and within HAZARD_RANGE. inView: near, and some part is inside the horizontal field of view
  // (a cone of hfov/2 about the view axis) and not occluded. lit: near, and some part is at least HAZARD_LUX from our beam (whether or not
  // in view). litDist: the farthest lit near actor, from the eye to its mean position (m), or null.
  function hazardCounts(actors, o) {
    let near = 0, inView = 0, lit = 0, litDist = null;
    for (const parts of actors) {
      if (!parts.length) continue;
      const m = [0, 0, 0];
      for (const q of parts) { m[0] += q.x; m[1] += q.y; m[2] += q.z; }
      m[0] /= parts.length; m[1] /= parts.length; m[2] /= parts.length;
      const dx = m[0] - o.eye[0], dy = m[1] - o.eye[1], dz = m[2] - o.eye[2], r = Math.hypot(dx, dy, dz);
      if (!(dx > 0) || !(r <= HAZARD_RANGE)) continue;
      near++;
      if (parts.some((q) => { const px = q.x - o.eye[0], py = q.y - o.eye[1], pz = q.z - o.eye[2]; return px > 0 && angleDeg([1, 0, 0], [px, py, pz]) <= o.hfov / 2 && !o.occludedAt([q.x, q.y, q.z]); })) inView++;
      if (parts.some((q) => o.luxAt([q.x, q.y, q.z]) >= HAZARD_LUX)) { lit++; if (litDist === null || r > litDist) litDist = r; }
    }
    return { near, inView, lit, litDist };
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

  const lineOncoming = (r) => r.dist.toFixed(0) + ' m · ' + format(r.lux, 'lx') + ' lx · peak ' + format(r.peak, 'lx') + ' lx' + (r.peakAt === null ? '' : ' at ' + r.peakAt.toFixed(0) + ' m') + ' · ' + format(r.angle, '°') + '° off';
  register({ id: 'oncoming', group: 'oncoming', label: 'Nearest oncoming cars', applies: onlyWhen((s) => s.oncomingOn, 'oncoming traffic is off'), read: (s) => s.oncoming,
    text: (rows) => (rows.length ? rows.map(lineOncoming) : 'none in range') });
  register({ id: 'glareSetting', group: 'glare', label: 'Glare setting', read: (s) => s.glareName,
    text: (name) => 'glare ' + name + (name === 'off' ? ' (the veil below is not in the picture)' : '') });
  // the raw veiling luminance and strongest source, whatever the glare setting: the veil is the glare scattered over the image
  register({ id: 'veil', group: 'glare', label: 'Veiling luminance at our eye (veilAt)', unit: 'cd/m²', read: (s) => s.veil });
  register({ id: 'veilTop', group: 'glare', label: 'Strongest glare source', read: (s) => s.veilTop,
    text: (t) => (t ? format(t.angle, '°') + '° off ahead, ' + format(t.lux, 'lx') + ' lx at the eye' : 'none') });
  register({ id: 'ev', group: 'glare', label: 'Exposure', unit: 'EV', read: (s) => s.ev });
  register({ id: 'white', group: 'glare', label: 'Display white', unit: 'cd/m²', read: (s) => s.white });

  const notPass = (why) => (s) => (s.pass ? 'not checked on the pass yet' : why(s));
  register({ id: 'reach', group: 'range', label: 'Beam reach (1 lx on the lane centre)', unit: 'm', applies: notPass(always), read: (s) => s.reach,
    text: (d) => (d === null || d === undefined ? 'no lit road ahead' : d >= 300 ? 'over 300 m' : format(d, 'm') + ' m') });
  register({ id: 'lamp', group: 'lamp', label: 'Beam in use', read: (s) => s.lamp });
  const hazardsOn = notPass(onlyWhen((s) => s.hazardsOn, 'people and deer are both off'));
  register({ id: 'hazNear', group: 'hazards', label: 'Within 150 m ahead', applies: hazardsOn, read: (s) => s.hazards && s.hazards.near, text: (n) => String(n) });
  register({ id: 'hazView', group: 'hazards', label: 'In view (in the field of view, not occluded)', applies: hazardsOn, read: (s) => s.hazards && s.hazards.inView, text: (n) => String(n) });
  register({ id: 'hazLit', group: 'hazards', label: 'Lit by our beam (1 lx or more)', applies: hazardsOn, read: (s) => s.hazards && s.hazards.lit, text: (n) => String(n) });
  register({ id: 'hazLitDist', group: 'hazards', label: 'Farthest lit hazard', unit: 'm', applies: hazardsOn, read: (s) => s.hazards && s.hazards.litDist,
    text: (d) => (d === null || d === undefined ? 'none lit' : format(d, 'm') + ' m') });

  // Panel headings, in display order. A metric's group must be one of these keys.
  const GROUPS = { own: 'Own car', oncoming: 'Oncoming traffic', glare: 'Glare we receive', hazards: 'Hazards', range: 'Range', lamp: 'Lamp' };

  // Display text for a value: null or NaN is a dash, Infinity is ∞ (a straight road has an infinite radius), strings pass through.
  const DP = { 'km/h': 0, m: 0, '%': 1, '°': 1, lx: 2, 'cd/m²': 2, EV: 1 };
  function format(v, unit) {
    if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '—';
    if (typeof v === 'string') return v;
    if (typeof v !== 'number') return String(v);
    if (v === Infinity) return '∞';
    return v.toFixed(DP[unit] === undefined ? 2 : DP[unit]);
  }

  RF.SceneDetails = { illuminance, angleDeg, peakTracker, firstFailure, litEdge, roadLux, faceLux, hazardCounts, topSource, samplePeaks, oncomingRows, display, register, METRICS, GROUPS, format, HAZARD_LUX, HAZARD_RANGE, always, onlyWhen };
})();
