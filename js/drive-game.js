/* Reach > uniformity: game rules in SI units; no saved optical-scene fields. */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {}), G = 9.81, STEP = 1 / 120;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mu = (wet) => wet ? 0.4 : 0.8;
  const stoppingDistance = (kmh, reaction, wet) => { const v = kmh / 3.6; return v * reaction + v * v / (2 * mu(wet) * G); };
  function motion(v, dt, brake, wet) {
    const a = brake ? mu(wet) * G : 0, h = a ? Math.min(dt, v / a) : dt;
    return { v: Math.max(0, v - a * h), dx: v * h - a * h * h / 2 };
  }
  // Continuous overlap interval for two axis-aligned boxes in road coordinates. Sweeping avoids driving through a thin actor between frames.
  function overlap(a, b) {
    const x = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), y = Math.min(a.y + a.hy, b.y + b.hy) - Math.max(a.y - a.hy, b.y - b.hy);
    return x >= 0 && y > 0 ? clamp(y / (2 * Math.min(a.hy, b.hy)), 0, 1) : 0;
  }
  function sweep(a, b, aa, bb) {
    let lo = 0, hi = 1;
    for (const k of ['x', 'y']) {
      const h = (k === 'x' ? a.hx + b.hx : a.hy + b.hy), d = b[k] - a[k], dv = (bb[k] - aa[k]) - d;
      if (Math.abs(dv) < 1e-12) { if (Math.abs(d) > h) return null; }
      else { const t0 = (-h - d) / dv, t1 = (h - d) / dv; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
    }
    return lo <= hi && lo <= 1 && hi >= 0 ? clamp(lo, 0, 1) : null;
  }
  function score(o) {
    // Mitigation (doc §6 contradicts itself: 'both −25 max' vs 15 + 20 = 35): game choice = 35 % when both apply, capped at 50 %. Persons only; never erases recklessness.
    const speed = Math.max(0, o.speed || 0), hit = !!o.hit, noncompliant = o.verdict === 'fail', mitigation = o.person ? Math.min(0.5, (o.noHiViz ? 0.15 : 0) + (o.jaywalking ? 0.20 : 0)) : 0;
    const recklessness = hit ? Math.min(100, (noncompliant ? 40 : 0) + (o.highMisuse ? 30 : 0) + speed) : 0, liability = recklessness * (1 - mitigation);
    const energy = hit ? 0.5 * 1500 * (speed / 3.6) ** 2 * clamp(o.fraction || 0, 0, 1) : 0;
    const damage = !hit ? 'none' : energy < 5000 ? 'clipped' : energy < 30000 ? 'dented' : energy < 100000 ? 'major repair' : 'totalled';
    const repair = !hit ? 0 : energy < 5000 ? 500 : energy < 30000 ? 2000 : energy < 100000 ? 5000 : 20000;
    const tier = !hit ? 'pass' : liability > 60 || (speed > 30 && (o.crosswalk || noncompliant)) ? 'jail-risk game over' : liability < 20 && speed < 10 && o.verdict === 'pass' ? 'repair (~$2k)' : 'ticket + civil (~$5k + points)';
    return { energy, damage, repair, recklessness, mitigation, liability, tier, lost: hit && (!!o.person || tier === 'jail-risk game over'), conscience: hit && o.person ? 100 : 0, tickets: (o.flashes || 0) * (noncompliant ? 500 : 150) };
  }
  const lin = (b) => { const x = b / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const luma = (rgba, q) => 0.2126 * lin(rgba[4 * q]) + 0.7152 * lin(rgba[4 * q + 1]) + 0.0722 * lin(rgba[4 * q + 2]);
  // Actual post-tone-map canvas bytes, GL bottom row first. Mask is nearest-hit actor-ID bits at sim resolution, top row first.
  // A lit pixel: positive local contrast >=20%, linear display luma >=.002, delta >=.001. Not a calibrated human-vision model.
  function legacyFirstLit(f) {
    const { rgba, mask, w, h, mw, mh } = f, bit = 1 << ((f.id || 1) - 1), radius = Math.max(2, Math.ceil(w / mw * 2));
    const masked = (x, y) => mask[Math.min(mh - 1, Math.floor((h - 1 - y + 0.5) / h * mh)) * mw + Math.min(mw - 1, Math.floor((f.flip ? w - 1 - x + 0.5 : x + 0.5) / w * mw))] & bit;
    let mx0 = mw, my0 = mh, mx1 = -1, my1 = -1;
    for (let q = 0; q < mask.length; q++) if (mask[q] & bit) { const x = q % mw, y = Math.floor(q / mw); mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); my0 = Math.min(my0, y); my1 = Math.max(my1, y); }
    if (mx1 < 0) return null;
    const left = Math.max(0, Math.floor((f.flip ? mw - 1 - mx1 : mx0) / mw * w) - 1), right = Math.min(w, Math.ceil((f.flip ? mw - mx0 : mx1 + 1) / mw * w) + 1);
    const bottom = Math.max(0, Math.floor((mh - 1 - my1) / mh * h) - 1), top = Math.min(h, Math.ceil((mh - my0) / mh * h) + 1);
    for (let y = bottom; y < top; y++) for (let x = left; x < right; x++) if (masked(x, y)) {
      if (f.exclude && f.exclude.some((r) => x >= r[0] && x < r[2] && h - 1 - y >= r[1] && h - 1 - y < r[3])) continue;
      const q = y * w + x, L = luma(rgba, q); if (L < 0.002) continue;
      let bg = 0, n = 0;
      for (const [dx, dy] of [[-radius, 0], [radius, 0], [0, -radius], [0, radius]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= w || yy < 0 || yy >= h || masked(xx, yy)) continue;
        bg += luma(rgba, yy * w + xx); n++;
      }
      if (n && L - bg / n >= 0.001 && (L - bg / n) / Math.max(0.002, bg / n) >= 0.2) return { x, y: h - 1 - y, L, background: bg / n };
    }
    return null;
  }
  // Game visibility rule: >=6 independent trace pixels AND >=6 CSS px², each with positive
  // Weber contrast (L-Lbackground)/Lbackground >=.20, display-linear delta >=.001 and L >=.002.
  // Background is the SAME frame with this hazard removed, never a neighbouring glare gradient.
  // FHWA small-target guidance: size, adaptation, time and contrast jointly affect visibility:
  // https://highways.fhwa.dot.gov/safety/other/visibility/fhwa-lighting-handbook-august-2012/3-vision-and-fundamental-concepts
  // Caller supplies the body mask (any eyeshine sample excludes that trace pixel).
  // These numerical cutoffs are conservative game tuning, not the calibrated Adrian visibility model.
  const VISIBILITY = { contrast: 0.20, delta: 0.001, luma: 0.002, pixels: 6, cssArea: 6 };
  function firstLit(f) {
    if (f.legacy) return legacyFirstLit(f);
    const { rgba, background, mask, w, h, mw, mh } = f, bit = 1 << ((f.id || 1) - 1);
    if (!background || background.length !== rgba.length) return null;
    const cells = new Set(), area = (f.cssW || w) * (f.cssH || h) / (w * h); let count = 0, first = null;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (mask[y * mw + x] & bit) {
      const x0 = Math.floor((f.flip ? mw - 1 - x : x) * w / mw), x1 = Math.ceil((f.flip ? mw - x : x + 1) * w / mw);
      const y0 = Math.floor(y * h / mh), y1 = Math.ceil((y + 1) * h / mh);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        // Assign each canvas pixel to one trace cell, including non-integer scaling.
        if (Math.floor((yy + .5) * mh / h) !== y || Math.floor(((f.flip ? w - 1 - xx : xx) + .5) * mw / w) !== x) continue;
        if (f.exclude && f.exclude.some((r) => xx >= r[0] && xx < r[2] && yy >= r[1] && yy < r[3])) continue;
        const q = (h - 1 - yy) * w + xx, L = luma(rgba, q), bg = luma(background, q), delta = L - bg;
        if (L < VISIBILITY.luma || delta < VISIBILITY.delta || delta / Math.max(0.002, bg) < VISIBILITY.contrast) continue;
        cells.add(y * mw + x); count++;
        if (!first) first = { x: xx, y: yy, L, background: bg };
      }
    }
    return cells.size >= VISIBILITY.pixels && count * area >= VISIBILITY.cssArea ? Object.assign(first, { pixels: cells.size, cssArea: count * area }) : null;
  }
  function create(o) {
    const rand = RF.Drive.rng((o.seed | 0) ^ 0x4d47414d);
    return { rules: o.rules === 'legacy' ? 'legacy' : 'visible', seed: o.seed | 0, speed: o.speed, wet: !!o.wet, verdict: o.verdict || 'unsure', highBeam: !!o.highBeam, rand, next: 10 + 10 * rand(), t: 0, x: 0, v: o.speed / 3.6, brake: false, hazards: [], results: [], seen: 0, reactions: [], flashes: 0, spawned: 0, limit: 5, done: false, accumulator: 0, resume: null, wallLit: null };
  }
  function legacySpawn(g, lane, p) {
    const A = RF.DriveAnim, r = g.rand, distance = 80 + 100 * r(), desiredPerson = r() < 0.1, initialSide = r() < 0.5 ? -1 : 1;
    let s = g.x + distance, crosswalk = false, tile;
    if (desiredPerson) for (let k = Math.floor((g.x + 80) / 200); k <= Math.floor((g.x + 180) / 200); k++) {
      const q = A.roadTile(g.seed, k), x = q.s0 + 100 - lane - 2.7;
      if (['intersection', 't-junction'].includes(q.kind) && x >= g.x + 80 && x <= g.x + 180) { s = x; crosswalk = true; tile = q; break; }
    }
    const person = desiredPerson && crosswalk; let side = initialSide, off = side < 0 ? -lane / 2 - 2.2 : 1.5 * lane + 2.2, outsideLux = null;
    // Outside the useful beam = <1 lx at 1.1 m, using the same LUT/route as D3. Prefer the nearest unlit shoulder.
    if (p) {
      const pp = Object.assign({}, p, { A: A.tileRoute(g.seed, g.x) }); let found = false;
      for (let extra = 0; extra <= 1000 && !found; extra += 0.5) for (const sign of [initialSide, -initialSide]) {
        const y = sign < 0 ? -lane / 2 - 2.2 - extra : 1.5 * lane + 2.2 + extra, E = A.eyeLux(pp, { rel: s - g.x, off: y });
        if (E < 1) { side = sign; off = y; outsideLux = E; found = true; break; }
      }
    }
    if (p && outsideLux === null) { g.done = true; g.reason = 'No off-road spawn outside the beam; try a different lamp or seed'; return null; }
    const h = { id: ++g.spawned, born: g.t, kind: person ? 'person' : 'deer', s0: s, off0: off, ds: 0, doff: -side, spd: person ? 1.3 : 1 + 0.5 * r(), len: Math.abs(off) + 0.15, delay: 0.3 + r(), side, crosswalk, noHiViz: r() < 0.5, jaywalking: person && A.signalState(tile, g.t).lit !== 'red', lit: null, reaction: null, resolved: false, outsideLux };
    g.hazards.push(h); g.next += 10 + 10 * r(); return h;
  }
  function spawn(g, lane, p) {
    if (g.rules === 'legacy') return legacySpawn(g, lane, p);
    const A = RF.DriveAnim, r = g.rand, base = 80 + 100 * r(), person = r() < .1, side = r() < .5 ? -1 : 1;
    // Fixed 2.2 m shoulder setback: lamp width must NEVER move a hazard sideways.
    const off = side < 0 ? -lane / 2 - 2.2 : 1.5 * lane + 2.2, pp = p && Object.assign({}, p, { A: A.tileRoute(g.seed, g.x) });
    let distance = Math.max(base, g.speed / 3.6 * (Math.abs(off) / (person ? 1.3 : 3.5) + .3)), outsideLux = null, crosswalk = false, tile;
    if (pp) {
      // Search longitudinally beyond useful reach, checking both the shoulder and our lane.
      // Last above-threshold sample wins, so a gap before a farther bright lobe is not 'outside'.
      for (let d = distance; d <= 1200; d += 5) if (Math.max(A.eyeLux(pp, { rel: d, off }), A.eyeLux(pp, { rel: d, off: 0 })) >= 1) distance = d + 20;
      outsideLux = A.eyeLux(pp, { rel: distance, off });
      if (!Number.isFinite(outsideLux) || outsideLux >= 1 || A.eyeLux(pp, { rel: distance, off: 0 }) >= 1 || distance > 1200) { g.done = true; g.reason = 'Lamp reach exceeds the 1200 m spawn search; choose another lamp'; return null; }
    }
    let s = g.x + distance;
    if (person) for (let k = Math.floor(s / 200); k <= Math.floor((s + 100) / 200); k++) {
      const q = A.roadTile(g.seed, k), x = q.s0 + 100 - lane - 2.7;
      if (['intersection', 't-junction'].includes(q.kind) && x >= s && x <= s + 100 && (!pp || (A.eyeLux(pp, { rel: x - g.x, off }) < 1 && A.eyeLux(pp, { rel: x - g.x, off: 0 }) < 1))) { s = x; crosswalk = true; tile = q; break; }
    }
    if (pp) outsideLux = A.eyeLux(pp, { rel: s - g.x, off });
    // Sprint, prompt entry and hesitation in our lane are game tuning, not measured behaviour.
    // Waiting on the shoulder until arrival would hide bodies from narrow long-throw lamps.
    const spd = person ? 1.3 : 3.5 + r(), delay = .3;
    const h = { id: ++g.spawned, born: g.t, kind: person ? 'person' : 'deer', s0: s, off0: off, ds: 0, doff: -side, spd, len: Math.abs(off) + .15, delay, side, crosswalk, noHiViz: r() < .5, jaywalking: person && (!crosswalk || A.signalState(tile, g.t).lit !== 'red'), lit: null, reaction: null, resolved: false, outsideLux };
    g.hazards.push(h); g.next += 10 + 10 * r(); return h;
  }
  const pose = (g, h, t) => RF.DriveAnim.actorPose(h, Math.max(0, t - h.born));
  const box = (ps, kind) => ({ x: ps.s, y: ps.off, hx: kind === 'person' ? 0.2 : 0.32, hy: kind === 'person' ? 0.2 : 0.95 });
  const car = (x) => ({ x: x - 2.2, y: 0, hx: 2.2, hy: 0.9 });
  function resolve(g, h, hit, speed, fraction) {
    if (h.resolved) return; h.resolved = true;
    const s = score({ hit, speed, fraction, verdict: g.verdict, person: h.kind === 'person', noHiViz: h.noHiViz, jaywalking: h.jaywalking, crosswalk: h.crosswalk, highMisuse: g.highBeam && (g.flashes > 0 || ['urban', 'intersection', 't-junction'].includes(RF.DriveAnim.roadTile(g.seed, Math.floor(g.x / 200)).kind)) });
    g.results.push(Object.assign({ id: h.id, kind: h.kind, hit, speed, reaction: h.reaction, fraction }, s));
    if (s.lost || g.results.length >= g.limit) g.done = true;
    else if (g.v === 0 || hit) { g.v = 0; g.resume = g.t + 2; }
  }
  function step(g, dt, lane, p) {
    if (g.done) return; g.accumulator += dt;
    while (g.accumulator + 1e-10 >= STEP && !g.done) {
      g.accumulator -= STEP;
      if (g.resume !== null && g.t >= g.resume && !g.brake) { g.v = g.speed / 3.6; g.resume = null; }
      if (g.spawned < g.limit && g.t + 1e-9 >= g.next) spawn(g, lane, p);
      const oldX = g.x, oldV = g.v, oldT = g.t, m = motion(g.v, STEP, g.brake, g.wet); g.x += m.dx; g.v = m.v; g.t += STEP;
      for (const h of g.hazards) if (!h.resolved) {
        const a = box(pose(g, h, oldT), h.kind), b = box(pose(g, h, g.t), h.kind), f = sweep(car(oldX), a, car(g.x), b);
        if (f !== null) {
          const frac = Math.max(0.01, overlap(car(g.x), b)); resolve(g, h, true, motion(oldV, STEP * f, g.brake, g.wet).v * 3.6, frac);
        } else if ((g.v === 0 && g.x < b.x - b.hx) || b.x + b.hx < g.x - 4.4) resolve(g, h, false, 0, 0);
      }
    }
  }
  function press(g, held, now) {
    if (g.done) return;
    if (held && !g.brake) for (const h of g.hazards) if (!h.resolved && h.lit !== null && h.reaction === null) { h.reaction = Math.max(0, (now - h.lit) / 1000); g.reactions.push(h.reaction); }
    g.brake = held;
  }
  RF.DriveGame = { G, STEP, mu, stoppingDistance, motion, overlap, sweep, score, VISIBILITY, firstLit, legacyFirstLit, create, spawn, pose, box, car, step, press, resolve };
})(typeof globalThis !== 'undefined' ? globalThis : this);
