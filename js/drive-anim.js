/* drive-anim.js — the animated Drive view: the car drives down the road, the scenery comes at it. Opt-in; the still view (drive.js) stays the default.
 *
 * No new photometric model. Everything the picture is made of still comes from RF.Drive.render (the beam lookup, the BRDFs, the materials):
 *   ground   The car-frame geometry of the road never changes while the car drives (a straight road, or the constant-radius bends of RF.Road.arc), so the lit
 *            ground is rendered ONCE (drive.js, no objects). Only the phase of patterned markings (the EU centre dashes) moves: that stripe is a second
 *            render (the dash drawn solid minus the dash left out) that the compose shader fades by the stripe's coverage at s + dist, exactly as covLon does.
 *   objects  Posts, signs, people, deer, trees, bushes, crates are placed relative to the car every frame (the scenery repeats every PERIOD metres) and
 *            traced by RF.Drive.render in its `layer: 'objects'` mode: only the pixels they can touch, written as (luminance·coverage, coverage).
 *   GPU      compose (objects over ground + dash) → glare (Gaussian pyramid, shared levels with Drive.tonemap) → ACES + sRGB → the canvas.
 * Frame = objects·(coverage) + (1 − coverage)·(ground + stripe·dash), then the same tone map. composeCPU() is that sum in plain JS (tests, parity).
 * The ground and the objects are rendered at the "sim" size (the canvas, 640..1600 px wide); the canvas itself is css px × devicePixelRatio (≤ 2).
 *
 * Road frame as drive.js: x ahead of the lamps, y left, z up. The scenery is built on a straight road in (s, off) = (x, y); on a bend each piece is moved to
 * A.at(s − dist, off) and turned with the tangent (ellipsoids keep their axes, as in the still view).                                                       */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {}), D = RF.Drive;
  const PERIOD = 300, EYE = [-2.0, 0.37, 1.2], MIN_SIM = 640, MAX_SIM = 1600, HEAVY_SIM = { forest: 960, city: 960 }, ANIM_SCENES = { road: 1, forest: 1, city: 1 }, ACT = 110, CULL = 230, TEX_WRAP = 76.8, TEX_AMP = 0.4;
  const CLASSES = [['posts', 'posts', 'Delineator posts with reflectors'], ['signs', 'signs', 'Road signs (retroreflective sheeting)'], ['people', 'people', 'Pedestrians'], ['animals', 'deer', 'Deer, with retroreflecting eyes'], ['veg', 'trees', 'Trees and bushes at the roadside'], ['obstacle', 'crates', 'A dark crate on the road every 150 m (the hard target: 3 % reflectance, nothing retroreflective)'], ['rpm', 'studs', 'Raised reflective pavement markers on the centre and edge lines (random scenery only)'], ['tex', 'grain', 'Asphalt grain: a subtle texture on the road surface that moves with the drive'], ['mt', 'threads', 'Trace the objects on several CPU threads (Web Workers), so big scenes keep up. Off: this thread only. Needs the page served over http(s) (browsers block workers on file://)'], ['wild', 'random', 'Random scenery from a seed: denser, different every 300 m, walkers and deer that move. Off: the original fixed scenery, repeating every 300 m']];

  // ---------------------------------------------------------------- CPU: scenery, ground, composition (pure; tests use these)
  // the scenery on a straight road, in (s, off) coordinates
  // opts (the view's settings; none = the original scenery, as the tests build it): { wild: random scenery from `seed` (chunks of PERIOD m, `density`), cline: 'broken' = a US passing-zone centre line }
  function source(name, lane, us, flags, opts) {
    if (opts && opts.tiles) opts = Object.assign({}, opts, { flags: flags || {}, us });
    if (opts && opts.tiles && name === 'intersection') name = 'road';
    const broken = !!(opts && us && opts.cline === 'broken');
    if (!(opts && opts.wild) || name !== 'road') {
      const sc = D.buildScene(name, { Lw: lane, A: null, us, seed: 7 }, flags), src = { objects: sc.objects, markings: sc.markings.map((m) => m.pat && m.pat.period >= 1e5 ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { period: PERIOD }) }) : m), verge: sc.verge, lane };      // a crossing or stop line that is there once on the still road comes round every lap, like the buildings
      if (broken && name === 'road') src.markings = D.laneMarkings(lane, { us, broken });
      return trafficSource(src, opts);
    }
    const mix = (k) => (Math.imul((+opts.seed || 0) | 0, 2654435761) ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0, chunks = new Map();
    const src = { wild: true, lane, markings: D.laneMarkings(lane, { us, broken }), verge: ['gravel', 1.6, 'grass'], chunk(k) {
      let c = chunks.get(k); if (!c) { c = D.wildChunk({ Lw: lane, us, seed: mix(k), density: opts.density === undefined ? 1.5 : +opts.density, broken }, flags); chunks.set(k, c); if (chunks.size > 8) chunks.delete(chunks.keys().next().value); } return c;
    } };
    src.objects = src.chunk(0).objects; return trafficSource(src, opts);
  }
  // Traffic has its own stream of the scenery RNG: switching a class off never moves another class. Constant speeds (m/s) keep spacing steady.
  const TRAFFIC_SPEED = { oncoming: 50 / 3.6, preceding: 40 / 3.6 };
  function trafficSource(src, opts) {
    const o = opts || {}, dn = o.trafficDensity === undefined ? 1 : Math.max(0, Math.min(3, +o.trafficDensity || 0));
    src.traffic = { seed: (+o.seed || 0) | 0, density: dn, oncoming: !!o.oncoming, preceding: !!o.preceding, models: {} };
    src.traffic.onMode = o.onMode || (o.onKcd === undefined ? 'symmetric' : 'manual'); src.traffic.onKcd = o.onKcd === undefined ? 30 : +o.onKcd;
    src.traffic.logic = !!o.trafficLogic; src.traffic.safeGap = o.safeGap !== false; src.traffic.speed = o.speed === undefined ? 50 : +o.speed;
    if (o.tiles) src.markings = D.laneMarkings(src.lane, { us: o.us, broken: o.us && o.cline === 'broken' });
    if (o.tiles) src.tiles = { seed: (+o.seed || 0) | 0, flags: o.flags || {}, lamps: o.streetLamps || 'sodium', grain: o.tex !== false, wet: !!o.wet, groundCache: o.tileCache ? {} : null };
    for (const kind of ['oncoming', 'preceding']) if (src.traffic[kind]) {
      const K = D.kit({ Lw: src.lane, A: null, rand: () => 0.5 });
      K.car(0, 0, kind === 'oncoming' ? { face: -1, lamps: 'head', kcd: +o.onKcd || 30 } : { face: 1, lamps: 'tail' }); src.traffic.models[kind] = K.O;
    }
    return src;
  }
  // One car in each seeded interval of road, then translated by its own travel and ours. Look up only the intervals in view: bounded work even after hours.
  function trafficCars(src, dist, t) {
    const tr = src.traffic, out = []; if (!tr || !tr.density) return out;
    if (tr.logic) return logicCars(src, dist, t);
    const gap = PERIOD / tr.density;
    for (const kind of ['oncoming', 'preceding']) if (tr[kind]) {
      const shift = dist + (kind === 'oncoming' ? 1 : -1) * TRAFFIC_SPEED[kind] * t;
      for (let k = Math.floor((shift - 6) / gap); k <= Math.floor((shift + CULL) / gap); k++) {
        const R = D.rng((Math.imul(tr.seed, 2654435761) ^ Math.imul(k, 0x9E3779B1) ^ (kind === 'oncoming' ? 0x51ED270B : 0x165667B1)) >>> 0);
        const rel = (k + 0.2 + 0.6 * R()) * gap - shift;
        const min = kind === 'preceding' && tr.safeGap ? Math.max(25, 2 * tr.speed / 3.6) : -6;
        if (rel >= min && rel <= CULL) out.push({ id: kind + ':' + k, kind, rel, off: kind === 'oncoming' ? src.lane : 0 });
      }
    }
    return out;
  }
  // IDM: Treiber, Hennecke & Helbing (2000), Phys. Rev. E 62, 1805. SI units; s is bumper-to-bumper.
  const IDM = { T: 1.5, s0: 2, a: 1, b: 1.5, delta: 4, length: 4.4, dt: 0.05 };
  function idmAcceleration(v, dv, s, v0, params) {
    const q = Object.assign({}, IDM, params), star = q.s0 + Math.max(0, v * q.T + v * dv / (2 * Math.sqrt(q.a * q.b)));
    return q.a * (1 - Math.pow(v / Math.max(0.1, v0), q.delta) - (s === Infinity ? 0 : Math.pow(star / Math.max(0.01, s), 2)));
  }
  // Longitudinal coordinates increase in the direction of travel. A virtual stop has zero length and speed.
  // Ballistic integration stops within the step; the final constraint is a numerical safety guard, not extra IDM braking.
  function idmStep(car, leader, dt, v0, stop, params) {
    const q = Object.assign({}, IDM, params), half = q.length / 2;
    let gap = leader ? leader.x - car.x - q.length : Infinity, dv = leader ? car.v - leader.v : 0, bound = leader ? leader.x - q.length - q.s0 : Infinity;
    if (stop !== undefined && stop - car.x - half < gap) { gap = stop - car.x - half; dv = car.v; bound = Math.min(bound, stop - half - q.s0); }
    let requested = Math.min(q.maxAccel === undefined ? Infinity : q.maxAccel, idmAcceleration(car.v, dv, gap, v0, q));
    if (q.maxBrake !== undefined && stop !== undefined && stop - car.x - half - q.s0 > 0) {
      const required = car.v * car.v / (2 * (stop - car.x - half - q.s0));
      if (required >= q.b / 2 || car.v * dt >= (stop - car.x - half - q.s0) / 2) requested = Math.min(requested, -required);
    }
    const a = Math.max(q.maxBrake === undefined ? -Infinity : -q.maxBrake, requested), h = a < 0 ? Math.min(dt, -car.v / a) : dt;
    let x = car.x + car.v * h + 0.5 * a * h * h, v = Math.max(0, car.v + a * dt);
    if (x > bound) { x = Math.max(car.x, bound); v = Math.min(v, leader && bound === leader.x - q.length - q.s0 ? leader.v : 0); }
    return Object.assign({}, car, { x, v, a });
  }
  const isJunction = (tile) => tile.kind === 'intersection' || tile.kind === 't-junction';
  function speedLimit(src, x) {
    if (!src.tiles) return 80 / 3.6;
    const tile = roadTile(src.tiles.seed, Math.floor(x / TILE_LEN));
    return (isJunction(tile) || tile.kind === 'urban' ? 50 : tile.curvature ? 60 : 80) / 3.6;
  }
  // Both directions are through traffic on the same road, so their heads share the main-road green (not the cross-road phase).
  function trafficSignal(src, car, t) {
    if (!src.tiles) return null;
    const dir = car.kind === 'oncoming' ? -1 : 1, k0 = Math.floor(car.x / TILE_LEN); let best = null;
    for (let k = k0 - 2; k <= k0 + 2; k++) {
      const tile = roadTile(src.tiles.seed, k); if (!isJunction(tile)) continue;
      const line = tile.s0 + 100 + dir * (-src.lane - 5.7), gap = dir * (line - car.x) - IDM.length / 2;
      if (gap >= -1e-7 && (!best || gap < best.gap)) best = { tile, line, gap, lit: signalState(tile, t).lit };
    }
    return best;
  }
  function trafficSeed(tr, kind, k) {
    return D.rng((Math.imul(tr.seed, 2654435761) ^ Math.imul(k, 0x9E3779B1) ^ (kind === 'oncoming' ? 0x51ED270B : 0x165667B1)) >>> 0)();
  }
  function seedTraffic(src, state, dist, t, initial) {
    const tr = src.traffic, spacing = PERIOD / tr.density;
    for (const kind of ['oncoming', 'preceding']) {
      const dir = kind === 'oncoming' ? -1 : 1, ahead = kind === 'oncoming' ? 1900 : 1400, shift = dist - dir * TRAFFIC_SPEED[kind] * t, lo = Math.floor((shift - 400) / spacing), hi = Math.ceil((shift + ahead) / spacing);
      for (let k = lo; k <= hi; k++) {
        const id = kind + ':' + k; if (state.seen.has(id)) continue;
        const x = (k + 0.2 + 0.6 * trafficSeed(tr, kind, k)) * spacing + dir * TRAFFIC_SPEED[kind] * t;
        if (x > dist + ahead) continue; state.seen.add(id);
        if ((!initial && x < dist + CULL + 100) || x < dist - 100) continue;
        if (kind === 'preceding' && x < dist + Math.max(25, 2 * tr.speed / 3.6)) continue;
        // Reject insertion into an existing driver's braking space; nominal stream positions are not a safe merge.
        if (state.cars.some((c) => c.kind === kind && Math.abs(c.x - x) < IDM.length + IDM.s0 + Math.pow(Math.max(c.v, TRAFFIC_SPEED[kind]), 2) / (2 * TRAFFIC_BRAKE) + IDM.T * Math.max(c.v, TRAFFIC_SPEED[kind]))) continue;
        const car = { id, kind, x, v: TRAFFIC_SPEED[kind] }, sig = trafficSignal(src, car, t);
        const route = junctionPlan(src, car);
        car.v = Math.min(car.v, approachSpeed(src, car));
        if (route && route.take) car.v = Math.min(car.v, Math.sqrt(TURN_SPEED * TURN_SPEED + 2 * IDM.b * Math.max(0, route.start - car.x)));
        if (sig && sig.lit !== 'green') {
          car.v = Math.min(car.v, Math.sqrt(2 * IDM.b * Math.max(0, sig.gap - IDM.s0)));
          if (sig.gap < IDM.s0) { car.x = sig.line - dir * (IDM.length / 2 + IDM.s0); car.v = 0; }
        }
        state.cars.push(car);
      }
      for (const id of state.seen) if (id.startsWith(kind + ':') && (+id.split(':')[1] < lo - 8 || +id.split(':')[1] > hi + 8)) state.seen.delete(id);
    }
  }
  // Task's comfortable-stop design bound (3–4 m/s²), separate from IDM's desired b=1.5.
  const TRAFFIC_BRAKE = 3.5, TURN_SPEED = 4, TURN_PROBABILITY = 0.25, TURN_GAP = 5;
  function approachSpeed(src, car) {
    const dir = car.kind === 'oncoming' ? -1 : 1, k0 = Math.floor(car.x / TILE_LEN);
    let v = speedLimit(src, car.x);
    if (src.tiles) for (let i = 1; i <= 3; i++) {
      const k = k0 + dir * i, edge = dir > 0 ? k * TILE_LEN : (k + 1) * TILE_LEN, limit = speedLimit(src, k * TILE_LEN + 1);
      v = Math.min(v, Math.sqrt(limit * limit + 2 * IDM.b * Math.max(0, dir * (edge - car.x))));
    }
    return v;
  }
  function approachAcceleration(src, car, route) {
    const dir = car.kind === 'oncoming' ? -1 : 1, k0 = Math.floor(car.x / TILE_LEN); let a = IDM.a;
    const brakeTo = (v, distance) => { if (car.v > v && distance > 0) a = Math.min(a, (v * v - car.v * car.v) / (2 * distance)); };
    if (src.tiles) for (let i = 1; i <= 3; i++) {
      const k = k0 + dir * i, edge = dir > 0 ? k * TILE_LEN : (k + 1) * TILE_LEN;
      brakeTo(speedLimit(src, k * TILE_LEN + 1), dir * (edge - car.x));
    }
    if (route && route.take) brakeTo(TURN_SPEED, route.start - car.x);
    return a;
  }
  function signalStop(src, car, t) {
    const sig = trafficSignal(src, car, t);
    if (!sig) return undefined;
    if (sig.lit === 'green') { car.signalK = undefined; car.commit = undefined; return undefined; }
    if (car.signalK !== sig.tile.k) {
      car.signalK = sig.tile.k;
      // Decide once at onset/first encounter. A committed car clears this line even after red begins.
      car.commit = car.v * car.v / (2 * TRAFFIC_BRAKE) > Math.max(0, sig.gap - IDM.s0) ? sig.tile.k : undefined;
    }
    return car.commit === sig.tile.k ? undefined : (car.kind === 'oncoming' ? -1 : 1) * sig.line;
  }
  function junctionPlan(src, car) {
    if (!src.tiles || car.kind !== 'preceding') return null;
    if (car.route && car.x <= car.route.mid + 10) return car.route;
    const k0 = Math.floor(car.x / TILE_LEN);
    for (let k = k0; k <= k0 + 3; k++) {
      const tile = roadTile(src.tiles.seed, k), mid = tile.s0 + 100;
      if (!isJunction(tile) || mid - 3 < car.x - 1e-7) continue;
      let hash = src.traffic.seed ^ Math.imul(k + 1, 0x85EBCA6B);
      for (let i = 0; i < car.id.length; i++) hash = Math.imul(hash ^ car.id.charCodeAt(i), 16777619);
      car.route = { k, mid, start: mid - 3, side: tile.kind === 't-junction' ? tile.side : -1, take: D.rng(hash >>> 0)() < TURN_PROBABILITY };
      return car.route;
    }
    return null;
  }
  function turnPose(car) {
    const q = car.turn, angle = Math.min(Math.PI / 2, q.s / q.radius), tail = Math.max(0, q.s - q.radius * Math.PI / 2);
    return { x: q.x + q.radius * Math.sin(angle), off: q.side * (q.radius * (1 - Math.cos(angle)) + tail), yaw: q.side * angle };
  }
  function turnClear(src, cars, route, id, approachTime, t) {
    for (const c of cars) {
      if (c.id === id) continue;
      if (c.turn && c.turn.k === route.k && Math.abs(turnPose(c).off) < 10) return false;
      if (!c.turn && c.route && c.route.k === route.k && c.route.enter) return false;
      // Worst reachable position under +1 m/s² up to 80 km/h; include bodies already in the conflict area.
      const horizon = TURN_GAP + (approachTime || 0), free = Math.max(c.v, 80 / 3.6), accelerating = Math.min(horizon, Math.max(0, (free - c.v) / IDM.a));
      const reach = c.v * accelerating + IDM.a * accelerating * accelerating / 2 + free * (horizon - accelerating);
      if (route.side > 0 && c.kind === 'oncoming') {
        const sig = trafficSignal(src, c, t), phase = sig && signalState(sig.tile, t).phase;
        // Opposing cars that can stop at a red lasting the entire manoeuvre cannot enter its path.
        if (sig && sig.tile.k === route.k && sig.lit !== 'green' && c.commit !== sig.tile.k && c.v * c.v / (2 * TRAFFIC_BRAKE) <= sig.gap - IDM.s0 + 1e-7 && (sig.lit === 'red' ? 24 - phase : 74 - phase) > horizon) continue;
      }
      if (route.side > 0 && c.kind === 'oncoming' && c.x >= route.mid - 8 && c.x <= route.mid + 8 + reach) return false;
    }
    return true;
  }
  function advanceTraffic(src, state, own, t) {
    const next = [];
    for (const kind of ['oncoming', 'preceding']) {
      const dir = kind === 'oncoming' ? -1 : 1, cars = state.cars.filter((c) => c.kind === kind).sort((a,b) => dir * (b.x - a.x)); let leader = null;
      for (const c of cars) {
        if (c.turn) {
          const v = c.v + Math.max(-TRAFFIC_BRAKE * IDM.dt, Math.min(IDM.a * IDM.dt, TURN_SPEED - c.v));
          c.turn.s += (c.v + v) * IDM.dt / 2; c.a = (v - c.v) / IDM.dt; c.v = v;
          const pose = turnPose(c); c.x = pose.x; next.push(c);
          if (Math.abs(pose.off) < 3.2) leader = { x: c.x, v: c.v * Math.cos(pose.yaw) };
          continue;
        }
        const route = junctionPlan(src, c), turning = route && route.take;
        let desired = approachSpeed(src, c), stop = signalStop(src, c, t);
        if (turning) {
          desired = Math.min(desired, Math.sqrt(TURN_SPEED * TURN_SPEED + 2 * IDM.b * Math.max(0, route.start - c.x)));
          const distance = Math.max(0, route.start - c.x), eta = 2 * distance / Math.max(1, c.v + TURN_SPEED);
          // Reserve only after this car has cleared its signal: a red wait must not consume the accepted gap.
          if (!route.enter && distance < 8 && turnClear(src, state.cars, route, c.id, eta, t)) route.enter = true;
          if (!route.enter) stop = Math.min(stop === undefined ? Infinity : stop, route.start + IDM.length / 2 + IDM.s0);
        }
        const n = idmStep(Object.assign({}, c, { x: dir * c.x }), leader, IDM.dt, desired, stop, { maxBrake: TRAFFIC_BRAKE, maxAccel: approachAcceleration(src, c, route) });
        n.x *= dir;
        if (turning && n.x >= route.start - 1e-7 && route.enter) {
          n.turn = { k: route.k, t, x: route.start, side: route.side, radius: route.side > 0 ? 5.1 : 3, s: Math.max(0, n.x - route.start) };
          n.x = turnPose(n).x;
        }
        next.push(n); leader = { x: dir * n.x, v: n.v };
      }
    }
    state.cars = next.filter((c) => c.x > own - 100 && c.x < own + 2100 && (!c.turn || Math.abs(turnPose(c).off) < 35));
  }
  // The live camera is a through driver. Following replaces the old queue-pushing escape; slider speed remains its target.
  function cameraStep(src, camera, dt, t) {
    const desired = Math.max(0, src.traffic.speed / 3.6);
    if (!src.traffic.logic) return Object.assign({}, camera, { x: camera.x + desired * dt, v: desired });
    trafficCars(src, camera.x, t);
    let leader = null;
    if (src.traffic.preceding) for (const c of src.traffic.state ? src.traffic.state.cars : []) {
      if (c.kind !== 'preceding' || c.x <= camera.x || (c.turn && Math.abs(turnPose(c).off) >= 3.2)) continue;
      if (!leader || c.x < leader.x) leader = { x: c.x, v: c.turn ? c.v * Math.cos(turnPose(c).yaw) : c.v };
    }
    const c = Object.assign({}, camera, { id: 'camera', kind: 'preceding' }), stop = signalStop(src, c, t);
    return idmStep(c, leader, dt, Math.min(desired, approachSpeed(src, c)), stop, { maxBrake: TRAFFIC_BRAKE, maxAccel: approachAcceleration(src, c) });
  }
  function logicCars(src, dist, t) {
    const tr = src.traffic; if (tr.frame && tr.frame.dist === dist && tr.frame.t === t) return tr.frame.cars;
    let st = tr.state;
    // Enabling, seeking backwards or jumping the camera starts a new seeded local stream; normal play never reinitialises.
    if (!st || t < st.time - 1e-8 || (t === st.time && dist !== st.dist) || Math.abs(dist - st.dist) > 200 || t - st.time > 5) {
      st = tr.state = { time: t, tick: 0, epoch: t, dist, cars: [], seen: new Set() }; seedTraffic(src, st, dist, t, true);
    }
    const tick = Math.floor((t - st.epoch) / IDM.dt + 1e-8);
    for (; st.tick < tick; st.tick++) {
      const time = st.epoch + (st.tick + 1) * IDM.dt, f = t === st.time ? 1 : (time - st.time) / (t - st.time), own = st.dist + (dist - st.dist) * f;
      seedTraffic(src, st, own, time, false); advanceTraffic(src, st, own, time);
    }
    st.time = t; st.dist = dist;
    const cars = [];
    for (const c of st.cars) {
      if (!tr[c.kind]) continue;
      const pose = c.turn ? turnPose(c, t) : { x: c.x, off: 0, yaw: 0 }, rel = pose.x - dist;
      if (rel < -6 || rel > CULL) continue;
      cars.push({ id: c.id, kind: c.kind, rel, off: (c.kind === 'oncoming' ? src.lane : 0) + pose.off, yaw: pose.yaw, v: c.v, turning: !!c.turn });
    }
    return cars;
  }
  const copyTraffic = (s) => s && Object.assign({}, s, { cars: s.cars.map((c) => Object.assign({}, c, { route: c.route && Object.assign({}, c.route) }, c.turn ? { turn: Object.assign({}, c.turn) } : {})), seen: new Set(s.seen) });
  // Rotate the whole car around its centre (including emitter normals), so it stays rigid on a bend.
  function trafficObjects(src, cars, A, p) {
    const out = [];
    for (const car of cars) {
      const q = A ? A.at(car.rel, car.off) : { p: [car.rel, car.off], t: [1, 0] }, yaw = Math.atan2(q.t[1], q.t[0]) + (car.yaw || 0), c = car.yaw ? Math.cos(yaw) : q.t[0], sn = car.yaw ? Math.sin(yaw) : q.t[1];
      for (const ob of src.traffic.models[car.kind]) {
        const n = Object.assign({}, ob, { x: q.p[0] + ob.x * c - ob.y * sn, y: q.p[1] + ob.x * sn + ob.y * c, bs: undefined, traffic: car.id });
        if (ob.k === 'box') n.yaw = (ob.yaw || 0) + yaw;
        if (ob.k === 'disc') { n.nx = ob.nx * c - ob.ny * sn; n.ny = ob.nx * sn + ob.ny * c; }
        out.push(n);
      }
    }
    if (p && src.traffic && src.traffic.onMode !== 'manual') D.Headlamp.apply(out, { mode: src.traffic.onMode, kcd: src.traffic.onKcd, lut: p.lut, conv: p.conv });
    return out;
  }
  const placedObjects = (p, dist, t, tauOf) => place(p.src, dist, p.A, tauOf, dimFoliage(p)).concat(trafficObjects(p.src, trafficCars(p.src, dist, t), p.A, p));
  // Same eye illuminance as Road.model.lux: far-field intensity / distance² × incidence cosine. Driver faces back along their lane, eye 1.1 m up.
  function eyeLux(p, car) {
    const q = p.A ? p.A.at(car.rel, car.off) : { p: [car.rel, car.off], t: [1, 0] }; let E = 0;
    for (const L of p.lamps) {
      const dx = q.p[0] - L[0], dy = q.p[1] - L[1], dz = 1.1 - L[2], r2 = dx * dx + dy * dy + dz * dz, cos = (dx * q.t[0] + dy * q.t[1]) / Math.sqrt(r2);
      if (!(cos > 0) || !(dx > 0)) continue;
      D.hvFast(dx, dy, dz, p.conv || 'A'); E += D.lutAt(p.lut, D.hv()[0], D.hv()[1]) * cos / r2;
    }
    return E;
  }
  const flashState = () => ({ n: 0, seen: new Set() });
  function countFlashes(state, p, dist, t) {
    if (p.src.tiles) p = Object.assign({}, p, { A: tileRoute(p.src.tiles.seed, dist) });
    const cars = trafficCars(p.src, dist, t);
    for (const car of cars) if (car.kind === 'oncoming' && car.rel > 0 && eyeLux(p, car) > 1 && !state.seen.has(car.id)) { state.seen.add(car.id); state.n++; }
    // IDs behind this monotonically advancing stream can never return; keep only the small visible window.
    if (p.src.traffic && p.src.traffic.density) {
      const k0 = p.src.traffic.logic ? -Infinity : Math.floor((dist + TRAFFIC_SPEED.oncoming * t - 6) / (PERIOD / p.src.traffic.density));
      const active = p.src.traffic.logic && new Set((p.src.traffic.state ? p.src.traffic.state.cars.filter((c) => c.x - dist >= -6) : cars).map((c) => c.id));
      for (const id of state.seen) if (+id.split(':')[1] < k0 || (active && !active.has(id))) state.seen.delete(id);
    }
    return state.n;
  }
  // ---------------------------------------------------------------- optional route tiles (200 m each, bends only in the middle 100 m)
  const TILE_LEN = 200, TILE_KINDS = ['straight', '250R', '250L', '150R', '150L', 'intersection', 't-junction', 'urban'];
  function roadTile(seed, k) {
    const R = D.rng((Math.imul(seed | 0, 2654435761) ^ Math.imul(k + 1, 0x85EBCA6B)) >>> 0), kind = TILE_KINDS[Math.floor(R() * TILE_KINDS.length)];
    return { k, s0: k * TILE_LEN, kind, curvature: /[RL]$/.test(kind) ? (kind.endsWith('L') ? 1 : -1) / parseInt(kind, 10) : 0, side: R() < 0.5 ? -1 : 1, phase: Math.floor(R() * 50) };
  }
  // Integrate only a local window, then put the camera at (0,0), facing its tangent. No accumulated drift or growing route history.
  function tileRoute(seed, dist, cached) {
    const parts = [], tiles = [], k0 = Math.floor(dist / TILE_LEN); let x = 0, y = 0, a = 0;
    const point = (q, u) => {
      const b = q.a + q.c * u;
      return q.c ? { p: [q.x + (Math.sin(b) - Math.sin(q.a)) / q.c, q.y + (Math.cos(q.a) - Math.cos(b)) / q.c], t: [Math.cos(b), Math.sin(b)] }
        : { p: [q.x + u * Math.cos(q.a), q.y + u * Math.sin(q.a)], t: [Math.cos(q.a), Math.sin(q.a)] };
    };
    for (let k = k0 - 1; k <= k0 + 2; k++) {
      const tile = roadTile(seed, k); tiles.push(tile);
      for (const [u, len, c] of tile.curvature ? [[0, 50, 0], [50, 100, tile.curvature], [150, 50, 0]] : [[0, TILE_LEN, 0]]) {
        const q = { s: tile.s0 + u, len, c, x, y, a }, end = point(q, len); parts.push(q); x = end.p[0]; y = end.p[1]; a += c * len;
      }
    }
    const find = (s) => parts.find((q) => s >= q.s && s < q.s + q.len) || (s < parts[0].s ? parts[0] : parts[parts.length - 1]);
    const origin = find(dist), cam = point(origin, dist - origin.s), ca = cam.t[0], sn = cam.t[1];
    for (const q of parts) { const dx = q.x - cam.p[0], dy = q.y - cam.p[1]; q.x = dx * ca + dy * sn; q.y = -dx * sn + dy * ca; q.a -= Math.atan2(sn, ca); q.ca = Math.cos(q.a); q.sn = Math.sin(q.a); }
    if (cached) for (let i = 1; i < parts.length - 1; i++) {
      const q = parts[i], end = point(q, q.len), pad = Math.abs(q.c) * q.len * q.len / 8 + 1e-7;
      // An arc is inside its chord's box plus its sagitta (<= curvature * length² / 8).
      q.bounds = [Math.min(q.x, end.p[0]) - pad, Math.max(q.x, end.p[0]) + pad, Math.min(q.y, end.p[1]) - pad, Math.max(q.y, end.p[1]) + pad];
    }
    const at = (s, off) => { const q = find(s + dist), p = point(q, s + dist - q.s), o = off || 0; p.p[0] -= o * p.t[1]; p.p[1] += o * p.t[0]; return p; };
    const frame = (px, py) => {
      let best = Infinity, ans;
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i];
        if (q.bounds) {
          const b = q.bounds, bx = Math.max(b[0] - px, px - b[1], 0), by = Math.max(b[2] - py, py - b[3], 0);
          if (bx * bx + by * by > best * (1 + 1e-12) + 1e-9) continue;
        }
        const dx = px - q.x, dy = py - q.y, lx = dx * q.ca + dy * q.sn, ly = -dx * q.sn + dy * q.ca;
        if (cached && !q.c && ly * ly > best * (1 + 1e-12) + 1e-9) continue;
        let u = q.c ? Math.atan2(q.c * lx, 1 - q.c * ly) / q.c : lx;
        u = Math.max(i === 0 ? -1e5 : 0, Math.min(i === parts.length - 1 ? 1e5 : q.len, u));
        const p = point(q, u), ex = px - p.p[0], ey = py - p.p[1], d = ex * ex + ey * ey;
        if (d < best) { best = d; ans = { s: q.s + u - dist, off: -ex * p.t[1] + ey * p.t[0], t: p.t }; }
      }
      return ans;
    };
    return { at, frame, tiles };
  }
  function signalState(tile, t) {
    const phase = ((t + tile.phase) % 50 + 50) % 50;
    return { lit: phase < 24 ? 'red' : phase < 47 ? 'green' : 'amber', phase };
  }
  // A frame's markings stay in route coordinates, objects and light positions use the very same route transform.
  function tileWorld(p, dist, t, tauOf) {
    const src = p.src, cfg = src.tiles, lane = p.lane, A = tileRoute(cfg.seed, dist, !!cfg.groundCache), edgeR = -lane / 2, edgeL = 1.5 * lane, crossings = [], lights = [], extra = [], skip = [], marks = [];
    const pp = Object.assign({}, p, { A });
    // Street lights can reach foliage outside our beam: keep it for actual per-point shading.
    const obs = place(src, dist, A, tauOf, cfg.lamps === 'off' ? dimFoliage(pp) : null).concat(trafficObjects(src, trafficCars(src, dist, t), A, pp));
    for (const tile of A.tiles) {
      const mid = tile.s0 + 100 - dist, junction = tile.kind === 'intersection' || tile.kind === 't-junction';
      if (mid < -110 || mid > CULL + 110) continue;
      if (junction) {
        const c0 = mid - lane - 0.2, c1 = mid + lane + 0.2, both = tile.kind === 'intersection', o0 = both || tile.side < 0 ? -35 : edgeR, o1 = both || tile.side > 0 ? 35 : edgeL;
        crossings.push({ s0: c0, s1: c1, o0, o1 }); skip.push([c0 - 5, c1 + 5]);
        const paint = (s, len, b0, b1) => marks.push({ o0: b0, o1: b1, mat: 'white-paint', pat: { s0: s, s1: s + len, period: 1e9, on: len } });
        for (const s of [c0 - 4, c1 + 1]) for (let b = edgeR + 0.35; b < edgeL - 0.3; b += 1) paint(s, 3, b, Math.min(b + 0.5, edgeL));
        paint(c0 - 5.5, 0.4, edgeR + 0.15, lane / 2); paint(c1 + 5.1, 0.4, lane / 2, edgeL - 0.15);
        for (const side of [-1, 1]) if (both || side === tile.side) {
          const b = side < 0 ? edgeR - 4 : edgeL + 1;
          for (let s = c0 + 0.3; s < c1 - 0.3; s += 1) paint(s, 0.5, b, b + 3);
          paint(c0 + 0.3, c1 - c0 - 0.6, side < 0 ? edgeR - 5 : edgeL + 4.6, side < 0 ? edgeR - 4.6 : edgeL + 5);
        }
        const K = D.kit({ Lw: lane, A: null, rand: () => 0.5 });
        for (const s of [c0 - 1, c1 + 1]) for (const b of [edgeR - 0.8, edgeL + 0.8]) if (cfg.flags.posts !== false) K.post(s, b);
        if (cfg.flags.signs !== false) K.sign(c0 - 10, edgeR - 1.5, 'yellow', { w: 0.7 });
        K.add({ k: 'cyl', x: c1 + 1, y: edgeR - 1, r: 0.07, z0: 0, z1: 5.8, mat: 'pole', cls: 'signal' });
        K.add({ k: 'box', x: c1 + 1, y: (edgeR - 1) / 2, hx: 0.05, hy: Math.abs(edgeR - 1) / 2, z0: 5.65, z1: 5.75, mat: 'pole', cls: 'signal' });
        const sig = signalState(tile, t); K.signal(c1 + 1, 0, 5.25, sig.lit);
        if (src.traffic.logic) {
          const first = K.O.length, x = c0 - 1; K.signal(x, lane, 5.25, sig.lit);
          for (const ob of K.O.slice(first)) {
            ob.x = 2 * x - ob.x; ob.y = 2 * lane - ob.y;
            if (ob.k === 'box') ob.yaw = (ob.yaw || 0) + Math.PI;
            if (ob.k === 'disc') { ob.nx = -ob.nx; ob.ny = -ob.ny; }
          }
        }
        // A deterministic crossing during red, with a fresh actor each cycle. This does not control the car or other traffic.
        if (cfg.flags.people !== false && sig.lit === 'red') {
          const off = edgeR - 0.7 + (2 * lane + 1.4) * Math.min(1, sig.phase / 12);
          K.person(c0 - 2.5, off, 'dark', { dir: [0, 1], gait: 0.11 * Math.sin(t * 11) });
        }
        for (const ob of K.O) { const n = move(Object.assign({}, ob), ob, ob.x, A); n.tile = tile.k; extra.push(n); }
      }
      if ((junction || tile.kind === 'urban') && cfg.lamps !== 'off') {
        const rgb = cfg.lamps === 'led' ? [1, 0.85, 0.66] : [1, 0.43, 0.10], K = D.kit({ Lw: lane, A: null, rand: () => 0.5 });
        for (let u = 25, i = 0; u < TILE_LEN; u += 50, i++) {
          const s = tile.s0 + u - dist, side = i % 2 ? 1 : -1, b = side < 0 ? edgeR - 1 : edgeL + 1, head = b - side * 0.8;
          if (s < -65 || s > CULL) continue;
          K.add({ k: 'cyl', x: s, y: b, r: 0.065, z0: 0, z1: 7, mat: 'pole', cls: 'street-lamp' });
          K.add({ k: 'box', x: s, y: (b + head) / 2, hx: 0.08, hy: 0.5, z0: 6.9, z1: 7, mat: 'pole', cls: 'street-lamp' });
          K.add({ k: 'ell', x: s, y: head, z: 6.9, rx: 0.3, ry: 0.18, rz: 0.05, mat: 'lamp-head', emit: rgb.map((v) => 9000 * v), cls: 'street-lamp' });
          const q = A.at(s, head); lights.push({ x: q.p[0], y: q.p[1], z: 6.85, cd: 900, rgb });
        }
        for (const ob of K.O) extra.push(move(Object.assign({}, ob), ob, ob.x, A));
      }
    }
    for (const m of src.markings) { const n = Object.assign({}, m, { skip }); if (m.pat) n.pat = Object.assign({}, m.pat, { s0: m.pat.s0 - dist, s1: m.pat.s1 - dist }); marks.push(n); }
    // Clear the side-road openings of fixed roadside props (actors and moving traffic retain their own behaviour).
    const filtered = obs.filter((ob) => {
      if (ob.traffic || ob.cls === 'person' || ob.cls === 'deer') return true;
      const f = A.frame(ob.x, ob.y), a = (ob.yaw || 0) - Math.atan2(f.t[1], f.t[0]), c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
      const hs = ob.k === 'box' ? c * ob.hx + sn * ob.hy : Math.max(ob.r || 0, ob.rx || 0, ob.ry || 0), ho = ob.k === 'box' ? sn * ob.hx + c * ob.hy : hs;
      return !crossings.some((q) => f.s + hs >= q.s0 - 1 && f.s - hs <= q.s1 + 1 && f.off + ho >= q.o0 && f.off - ho <= q.o1);
    });
    return { A, objects: filtered.concat(extra), markings: marks, crossings, lights };
  }
  // Filtered asphalt grain for the dynamic ground; no screen-space noise or moving texture on objects.
  function tileGrain(dist, wet) {
    return (s, off, h) => {
      let n = 0;
      for (const [scale, weight] of [[0.15, 0.45], [0.6, 0.35], [2.4, 0.2]]) {
        const f = Math.max(0, Math.min(1, (h / scale - 0.4) / 0.8)), fade = 1 - f * f * (3 - 2 * f);
        n += weight * fade * Math.sin((s + dist) / scale * 2.7 + Math.sin(off / scale * 3.1)) * Math.sin(off / scale * 2.3 + 0.7);
      }
      return 1 + TEX_AMP * (wet ? 0.5 : 1) * n;
    };
  }
  function tileFrame(p, dist, t, rgba, ss, tauOf, tileRow, world) {
    const sc = world || tileWorld(p, dist, t, tauOf), r = D.render(Object.assign({}, camOf(p), { arc: sc.A, layer: 'frame', rgba, ss: ss || 2, tight: true, tileRow, groundCache: p.src.tiles.groundCache, hazardMask: p.hazardMask, hazardBodyMask: p.hazardBodyMask, sampleTiles: p.sampleTiles, pointLights: sc.lights, crossings: sc.crossings,
      grain: p.src.tiles.grain ? tileGrain(dist, p.src.tiles.wet) : null, scene: { objects: sc.objects, markings: sc.markings, verge: p.src.verge } }));
    r.rows.trows = r.trows; r.rows.TS = r.TS; return r.rows;
  }
  // a pose of a walker or deer `tau` s after it started moving: where it is along the road (s) and across it (off), and its leg swing
  function actorPose(a, tau) {
    const run = a.mode === 'graze' ? 0 : Math.max(0, tau - (a.delay || 0)), d = Math.min(a.spd * run, a.len), moving = run > 0 && d < a.len;
    return { s: a.s0 + a.ds * d, off: a.off0 + a.doff * d, gait: moving ? (a.kind === 'deer' ? 0.14 : 0.11) * Math.sin(2 * Math.PI * (a.kind === 'deer' ? 1.4 : 1.8) * run) : 0 };
  }
  // the objects as the car at distance `dist` sees them (car frame). Every object appears once, at s ∈ [dist − 6, dist − 6 + PERIOD); A: RF.Road.arc or null
  // ob copied to n, moved to `rel` m ahead of the car (on a bend: along the lane, turned with the tangent)
  function move(n, ob, rel, A) {
    n.bs = undefined;
    if (A) {
      const q = A.at(rel, ob.y), psi = Math.atan2(q.t[1], q.t[0]), c = Math.cos(psi), sn = Math.sin(psi);
      n.x = q.p[0]; n.y = q.p[1];
      if (ob.k === 'box') n.yaw = (ob.yaw || 0) + psi;
      else if (ob.k === 'disc') { n.nx = ob.nx * c - ob.ny * sn; n.ny = ob.nx * sn + ob.ny * c; }
    } else n.x = rel;
    return n;
  }
  /* tauOf(id, rel0) → seconds since that walker/deer started moving (0 without it: they stand where they start). Random scenery: the chunks around the car, each object once */
  function place(src, dist, A, tauOf, skip) {
    const out = [];
    if (src.chunk) {
      const k0 = Math.floor((dist - 6) / PERIOD), K = D.kit({ Lw: src.lane, A: null, rand: () => 0.5 });
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        const base = k * PERIOD, ch = src.chunk(k);
        if (k >= k0) for (const ob of ch.objects) { const rel = ob.x + base - dist; if (rel >= -6 && rel <= CULL) { const n = move(Object.assign({}, ob), ob, rel, A); if (!skip || !skip(n)) out.push(n); } }
        for (const a of ch.actors) {
          const id = k + ':' + a.id, tau = tauOf ? tauOf(id, base + a.s0 - dist) : 0, ps = actorPose(a, tau), rel = base + ps.s - dist; if (rel < -6 || rel > CULL) continue;
          const n0 = K.O.length;
          if (a.kind === 'deer') K.deer(rel, ps.off, { face: a.side > 0 ? 1 : -1, gait: ps.gait }); else K.person(rel, ps.off, a.ptype, { dir: [a.ds, a.doff], gait: ps.gait });
          for (let i = n0; i < K.O.length; i++) out.push(move(Object.assign({}, K.O[i]), K.O[i], K.O[i].x, A));
        }
      }
      return out;
    }
    for (const ob of src.objects) { const n = move(Object.assign({}, ob), ob, ob.x - dist - Math.floor((ob.x - dist + 6) / PERIOD) * PERIOD, A); if (!skip || !skip(n)) out.push(n); }
    return out;
  }
  const camOf = (p) => ({ w: p.w, h: p.h, hfov: p.hfov, eye: EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, arc: p.A, lane: p.lane, look: p.look, profile: p.profile });
  /* the lit ground: A = everything that does not move; each patterned marking (the dashes, a crossing, a stop line) is a layer: the markings that share one pattern are drawn solid and what they add over A is its B,
   * which the compose shader fades by the pattern's coverage at s + dist. Lit paint adds linearly, so layers sum (where two overlap the sum is a little more than the still view's first-marking-wins: city's crossing over the dash).
   * layers = [{ pat, B }] (at most MAX_PAT; more patterned markings than that stay in A as they are at dist 0); B and pat = the first layer's (null: nothing patterned)  */
  const MAX_PAT = 4;
  function ground(p) {
    const cam = camOf(p), t0 = Date.now(), groups = new Map();
    for (const m of p.src.markings) if (m.pat) { const k = JSON.stringify(m.pat); if (groups.has(k) || groups.size < MAX_PAT) (groups.get(k) || groups.set(k, []).get(k)).push(m); }
    const moving = new Set([].concat(...groups.values())), stat = p.src.markings.filter((m) => !moving.has(m));
    const A = D.render(Object.assign({ ss: 1, scene: { objects: [], markings: stat, verge: p.src.verge } }, cam)).rgb, layers = [];
    for (const ms of groups.values()) {
      const S = D.render(Object.assign({ ss: 1, scene: { objects: [], markings: stat.concat(ms.map((m) => Object.assign({}, m, { pat: null }))), verge: p.src.verge } }, cam)).rgb, B = new Float32Array(S.length);
      for (let i = 0; i < S.length; i++) B[i] = S[i] - A[i];
      layers.push({ pat: ms[0].pat, B });
    }
    return { A, B: layers.length ? layers[0].B : null, pat: layers.length ? layers[0].pat : null, layers, ms: Date.now() - t0 };
  }
  // the shader's per-pattern inputs at a drive distance: each pattern's phase is dist mod its own period
  const patArgs = (g, dist) => g.layers.map((L) => ({ pat: L.pat, dist: dist % L.pat.period }));
  // the objects at `dist`, rendered into rgba (4·w·h, cleared by the caller where it was written last); → rows [y0, y1) touched
  /* Foliage and bark (reflectance ≤ 0.08, nothing retroreflective) the beam cannot reach is black on the screen whether or not it is traced, and the trees are what makes a
   * dense roadside slow (huge ellipsoids). An upper bound of its luminance, from the beam's largest intensity over the object's bounding cube and the nearest distance, below
   * 1e-3 cd/m² (a third of one 8-bit step at EV 0, black at any EV in range): not traced. Not with ambient light (it lights diffuse surfaces by itself).                       */
  function dimFoliage(p) {
    if (p.look && p.look.ambient > 0) return null;
    return (n) => {
      if (n.cls !== 'veg') return false;
      D.boundOf(n); const b = n.bs, R = b[3], rho = typeof n.mat === 'string' && D.MAT_DEF[n.mat] ? Math.max(...D.MAT_DEF[n.mat].rho, 0.08) : 0.08; let I = 0;     // (birch bark reflects 0.45, not 0.08)
      for (const L of p.lamps) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        D.hvFast(b[0] + i * R - L[0], b[1] + j * R - L[1], b[2] + k * R - L[2], p.conv || 'A'); const q = D.lutAt(p.lut, D.hv()[0], D.hv()[1]); if (q > I) I = q;
      }
      if (!(I > 0)) return true;
      const d = Math.max(Math.hypot(b[0] - p.lamps[0][0], b[1] - p.lamps[0][1], b[2] - p.lamps[0][2]) - R, 0.5);
      return 3 * p.lamps.length * rho / Math.PI * I / (d * d) < 1e-3;
    };
  }
  // tileRow(ty) → true: trace only these 16-px tile rows (a worker's share); the rows come back with .trows = the tile rows that were traced
  function objects(p, dist, rgba, ss, tauOf, tileRow, placed, t) {
    if (p.src.tiles) return tileFrame(p, dist, t || 0, rgba, ss, tauOf, tileRow, placed);
    if (p.look.wet && p.look.wetSheen) {
      const markings = p.src.markings.map((m) => m.pat ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { s0: m.pat.s0 - dist % m.pat.period, s1: m.pat.s1 - dist % m.pat.period }) }) : m);
      const r = D.render(Object.assign({}, camOf(p), { ss: ss || 2, layer: 'frame', tight: true, rgba, tileRow, grain: p.look.grain ? tileGrain(dist, true) : null, scene: { objects: placed || placedObjects(p, dist, t || 0, tauOf), markings, verge: p.src.verge } }));
      r.rows.trows = r.trows; r.rows.TS = r.TS; return r.rows;
    }
    const r = D.render(Object.assign({ ss: ss || 2, layer: 'objects', tight: true, rgba, tileRow, scene: { objects: placed || placedObjects(p, dist, t || 0, tauOf), markings: [], verge: p.src.verge } }, camOf(p)));
    r.rows.trows = r.trows; r.rows.TS = r.TS; return r.rows;
  }
  // walkers and deer start to move when the car is ACT m from where they stood: act = id → the clock (s) at that moment. Pure state, so every thread that sees the same frames keeps the same copy
  const tauFor = (act, t) => (id) => { const t0 = act.get(id); return t0 === undefined ? 0 : t - t0; };
  // start the walkers and deer the car has come within ACT m of (the page does this once per frame and hands the result to every thread, so they all pose the same actor the same way)
  function activate(src, dist, t, act) {
    if (!src.chunk) return;
    const k0 = Math.floor((dist - 6) / PERIOD);
    for (let k = k0 - 1; k <= k0 + 1; k++) for (const a of src.chunk(k).actors) { const id = k + ':' + a.id; if (!act.has(id) && k * PERIOD + a.s0 - dist <= ACT) act.set(id, t); }
  }
  function pruneAct(act, dist) { if (act.size > 80) { const k0 = Math.floor((dist - 6) / PERIOD); for (const id of act.keys()) if (+id.split(':')[0] < k0 - 2) act.delete(id); } }
  /* The object trace of one worker thread (js/drive-worker.js; the page can run one too, tests do). It rebuilds the scenery itself from parameters (materials are functions: they cannot cross postMessage),
   * and for every frame traces its share of the picture: tile rows ty with ty % n === i, packed into one Float32Array (the rows of each traced tile row, in order). Same code as the page's own trace, so the pixels are the same. */
  function tracer() {
    let p = null, rgba = null, prev = [], cfgId = 0, seq = -1, placed = null;
    return {
      cfg(m) {
        const q = m.p; p = Object.assign({}, q, { A: m.arc ? RF.Road.arc(m.arc.R, m.arc.dir) : null }); p.src = source(m.src[0], m.src[1], m.src[2], m.src[3], m.src[4]);
        rgba = new Float32Array(4 * p.w * p.h); prev = []; cfgId = m.id; seq = -1; placed = null;
      },
      // job m: { seq, dist, t, ss, act (id, clock pairs), c, K (the tile rows ty % K === c), ret (a buffer to reuse), wid }
      job(m) {
        const t0 = performance.now(), W = p.w, H = p.h, TS = 16; p.profile = m.profile ? {} : null;
        for (const ty of prev) rgba.fill(0, ty * TS * W * 4, Math.min(H, (ty + 1) * TS) * W * 4);
        if (m.seq !== seq) { seq = m.seq; if (m.speed !== undefined) p.src.traffic.speed = m.speed; p.src.traffic.frame = m.traffic ? { dist: m.dist, t: m.t, cars: m.traffic } : null; placed = (p.src.tiles ? tileWorld : placedObjects)(p, m.dist, m.t, tauFor(new Map(m.act), m.t)); }          // the scenery of this frame, placed once for all this thread's jobs
        const rows = objects(p, m.dist, rgba, m.ss, null, m.K > 1 ? (ty) => ty % m.K === m.c : null, placed), tr = rows.trows;
        let len = 0; for (const ty of tr) len += (Math.min(H, (ty + 1) * TS) - ty * TS) * W * 4;
        const f = m.ret && m.ret.byteLength >= len * 4 ? new Float32Array(m.ret) : new Float32Array(len); let off = 0;
        for (const ty of tr) { const a = ty * TS * W * 4, b = Math.min(H, (ty + 1) * TS) * W * 4; f.set(rgba.subarray(a, b), off); off += b - a; }
        prev = tr;
        return { type: 'rows', seq: m.seq, cfg: cfgId, wid: m.wid, c: m.c, trows: tr, buf: f.buffer, len, ms: performance.now() - t0, profile: p.profile };
      },
    };
  }
  // coverage of a pixel's footprint [s − h, s + h] by the stripe pattern at s + dist (drive.js covLon with the pattern shifted)
  const stripe = (pat, s, h) => D.covLon(s, h, pat);
  // the sum the shader computes, in plain JS: rgb (cd/m²) of the whole picture at `dist`. g = ground(p), rgba = objects(...)'s buffer
  function composeCPU(p, g, rgba, dist) {
    const w = p.w, h = p.h, tanH = Math.tan(p.hfov * Math.PI / 360), tanV = tanH * h / w, d0 = 2 * tanH / w, A = p.A, out = new Float32Array(3 * w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const q = y * w + x, u = (x + 0.5) / w * 2 - 1, v = 1 - (y + 0.5) / h * 2; const ks = [];
      if (g.layers && g.layers.length) {
        let dx = 1, dy = -u * tanH, dz = v * tanV; const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
        if (dz < -1e-6) {
          const tg = -EYE[2] / dz, px = EYE[0] + tg * dx, py = EYE[1] + tg * dy, s = A ? A.frame(px, py).s : px, hl = Math.max(0.5 * tg * d0, 1e-4) / Math.max(-dz, 0.003);
          for (const L of g.layers) ks.push(stripe(L.pat, s + dist, hl));
        }
      }
      const cov = rgba ? rgba[4 * q + 3] : 0;
      for (let c = 0; c < 3; c++) { let gr = g.A[3 * q + c]; for (let j = 0; j < ks.length; j++) gr += ks[j] * g.layers[j].B[3 * q + c]; out[3 * q + c] = (rgba ? rgba[4 * q + c] : 0) + (1 - cov) * gr; }
    }
    return out;
  }

  // ---------------------------------------------------------------- GPU
  const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const FS_COMPOSE = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uA, uO; uniform highp sampler2DArray uB; uniform vec2 uSize; uniform vec3 uEye; uniform float uTanH, uTanV, uDelta0, uR, uSg, uTex, uTexDist, uLw, uVw; uniform int uNP; uniform vec4 uPat[4]; uniform float uPd[4];
out vec4 o;
float F(float x, vec4 pt) { float u = x - pt.x; float n = floor(u / pt.z); return n * pt.w + min(u - n * pt.z, pt.w); }
// asphalt grain: value noise in road coordinates (s along, off across), three scales (15 cm, 60 cm, 2.4 m), each faded out where a pixel's footprint F (m) is as big as its cells: no shimmer, same mean
float hsh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 c, float N) { vec2 i = floor(c), f = fract(c); f = f * f * (3.0 - 2.0 * f); float x0 = mod(i.x, N), x1 = mod(i.x + 1.0, N);
  return mix(mix(hsh(vec2(x0, i.y)), hsh(vec2(x1, i.y)), f.x), mix(hsh(vec2(x0, i.y + 1.0)), hsh(vec2(x1, i.y + 1.0)), f.x), f.y); }
float grain(float s, float off, float F) {
  float a = 1.0 - smoothstep(0.4, 1.2, F / 0.15), b = 1.0 - smoothstep(0.4, 1.2, F / 0.6), c = 1.0 - smoothstep(0.4, 1.2, F / 2.4);
  return 0.45 * a * (vn(vec2(s / 0.15, off / 0.15), 512.0) * 2.0 - 1.0) + 0.35 * b * (vn(vec2(s / 0.6, off / 0.6), 128.0) * 2.0 - 1.0) + 0.2 * c * (vn(vec2(s / 2.4, off / 2.4), 32.0) * 2.0 - 1.0);
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy); vec3 g = texelFetch(uA, ip, 0).rgb; vec4 ob = texelFetch(uO, ip, 0);
  if (uNP > 0 || uTex > 0.0) {
    float u = gl_FragCoord.x / uSize.x * 2.0 - 1.0, v = 1.0 - gl_FragCoord.y / uSize.y * 2.0;
    vec3 d = normalize(vec3(1.0, -u * uTanH, v * uTanV));
    if (d.z < -1e-6) {
      float tg = -uEye.z / d.z; vec3 P = uEye + tg * d; float s = P.x, off = P.y;
      if (uR > 0.0) { float ry = P.y - uSg * uR; s = atan(P.x, -uSg * ry) * uR; float rr = length(vec2(P.x, ry)); off = uSg > 0.0 ? uR - rr : rr - uR; }
      float h = max(0.5 * tg * uDelta0, 1e-4) / max(-d.z, 0.003);
      for (int k = 0; k < 4; k++) { if (k >= uNP) break; vec4 pt = uPat[k]; float sw = s + uPd[k], a = max(sw - h, pt.x), b = min(sw + h, pt.y); if (b > a) g += (F(b, pt) - F(a, pt)) / (2.0 * h) * texelFetch(uB, ivec3(ip, k), 0).rgb; }
      if (uTex > 0.0 && off > -0.5 * uLw - uVw && off < 1.5 * uLw + uVw) g *= max(0.25, 1.0 + uTex * grain(s + uTexDist, off, h));
    }
  }
  o = vec4(min(vec3(65504.0), max(vec3(0.0), ob.rgb + (1.0 - ob.a) * g)), 1.0);
}`;
  const FS_BRIGHT = `#version 300 es
precision highp float; uniform sampler2D uT; uniform float uK; uniform vec2 uSize; out vec4 o;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2, sz = textureSize(uT, 0); vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) { vec3 x = max(texelFetch(uT, min(base + ivec2(i,j), sz-1), 0).rgb * uK - 1.0, 0.0); s += 64.0 * x / (64.0 + x); }
  o = vec4(s * 0.25, 1.0);
}`;
  const FS_REDUCE = `#version 300 es
precision highp float; uniform sampler2D uT; out vec4 o;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2, sz = textureSize(uT, 0); vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) s += texelFetch(uT, min(base + ivec2(i,j), sz-1), 0).rgb;
  o = vec4(s * 0.25, 1.0);
}`;
  const FS_BLUR = `#version 300 es
precision highp float; uniform sampler2D uT; uniform vec2 uSize, uDir, uSourceSize; uniform float uScale, uSigma; uniform int uRad; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize; vec3 s = vec3(0.0); float norm = 0.0;
  for (int i = -uRad; i <= uRad; i++) { float wt = exp(-0.5 * pow(float(i) / uSigma, 2.0)); s += texture(uT, uv + float(i) * uDir / uSourceSize).rgb * wt; norm += wt; }
  o = vec4(s / norm * uScale, 1.0);
}`;
  const FS_FINAL = `#version 300 es
precision highp float; uniform sampler2D uHdr, uGlare; uniform vec2 uSize; uniform float uK, uFlip, uGl, uVeil, uTanH, uTanV; uniform int uNS; uniform vec4 uSources[32]; out vec4 o;
vec3 aces(vec3 x) { x = max(x, 0.0); return min((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 1.0); }
vec3 srgb(vec3 c) { return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize; uv.y = 1.0 - uv.y; if (uFlip > 0.5) uv.x = 1.0 - uv.x;
  vec3 dir = normalize(vec3(1.0, -(2.0 * uv.x - 1.0) * uTanH, (1.0 - 2.0 * uv.y) * uTanV));
  float veil = 0.0;
  if (uVeil > 0.0) for (int i = 0; i < 32; i++) { if (i >= uNS) break; float theta = max(1.0, degrees(acos(clamp(dot(dir, uSources[i].xyz), -1.0, 1.0)))); veil += 10.0 * uSources[i].w / (theta * theta); }
  vec3 lin = (texture(uHdr, uv).rgb + uVeil * veil) * uK + (uGl > 0.0 ? texture(uGlare, uv).rgb : vec3(0.0));
  o = vec4(srgb(aces(lin)), 1.0);
}`;

  function makeGL(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    const prog = (fs) => {
      const p = gl.createProgram();
      for (const [t, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('drive-anim shader: ' + gl.getShaderInfoLog(s)); gl.attachShader(p, s); }
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('drive-anim link: ' + gl.getProgramInfoLog(p));
      const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    const P = { compose: prog(FS_COMPOSE), bright: prog(FS_BRIGHT), reduce: prog(FS_REDUCE), blur: prog(FS_BLUR), fin: prog(FS_FINAL) };
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const T = {};                                         // name → { t, f, w, h }
    const mk = (name, w, h, ifmt, filter) => {
      if (T[name]) { gl.deleteTexture(T[name].t); gl.deleteFramebuffer(T[name].f); }
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Drive framebuffer unavailable');
      T[name] = { t, f, w, h }; return T[name];
    };
    const use = (prog_, uni) => { gl.useProgram(prog_.p); for (const k in uni) { const v = uni[k], l = prog_.u[k]; if (l === undefined || l === null) continue; if (Array.isArray(v)) { if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else gl.uniform4fv(l, v); } else if (Number.isInteger(v) && k === 'uRad') gl.uniform1i(l, v); else gl.uniform1f(l, v); } };
    const bindTex = (unit, name, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, T[name].t); gl.uniform1i(loc, unit); };
    const R = {
      gl, W: 0, H: 0, cw: 0, ch: 0,
      // allocate for a sim size and a canvas size
      resize(W, H, cw, ch) {
        R.cw = cw; R.ch = ch; if (W === R.W && H === R.H) return false;
        R.W = W; R.H = H; const hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
        mk('A', W, H, gl.RGBA16F, gl.NEAREST); R.BL = 0; mk('O', W, H, gl.RGBA32F, gl.NEAREST); mk('hdr', W, H, gl.RGBA16F, gl.LINEAR);
        mk('acc', hw, hh, gl.RGBA16F, gl.LINEAR);
        for (const factor of D.GLARE_BANDS) for (const n of ['s', 'p']) mk(n + factor, Math.max(1, Math.ceil(hw / factor)), Math.max(1, Math.ceil(hh / factor)), gl.RGBA16F, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, T.O.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, new Float32Array(4 * W * H));
        return true;
      },
      setGround(g) {
        const up = (name, rgb) => {
          const W = R.W, H = R.H, a = new Float32Array(4 * W * H); if (rgb) for (let i = 0, n = W * H; i < n; i++) { a[4 * i] = rgb[3 * i]; a[4 * i + 1] = rgb[3 * i + 1]; a[4 * i + 2] = rgb[3 * i + 2]; }
          gl.bindTexture(gl.TEXTURE_2D, T[name].t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, a);
        };
        up('A', g.A);
        const n = Math.max(1, g.layers ? g.layers.length : 0);          // the stripe layers: one array texture, a layer each
        if (R.BL < n) { if (T.Bt) gl.deleteTexture(T.Bt); T.Bt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.Bt); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, R.W, R.H, n); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v); R.BL = n; }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.Bt);
        (g.layers || []).forEach((L, i) => { const W = R.W, H = R.H, a = new Float32Array(4 * W * H); for (let j = 0, m = W * H; j < m; j++) { a[4 * j] = L.B[3 * j]; a[4 * j + 1] = L.B[3 * j + 1]; a[4 * j + 2] = L.B[3 * j + 2]; } gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, W, H, 1, gl.RGBA, gl.FLOAT, a); });
      },
      // upload rows [y0, y1) of the object layer (rgba: Float32Array 4·W·H)
      setObjects(rgba, y0, y1) {
        if (y1 <= y0) return; gl.bindTexture(gl.TEXTURE_2D, T.O.t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, R.W, y1 - y0, gl.RGBA, gl.FLOAT, rgba.subarray(y0 * R.W * 4, y1 * R.W * 4));
      },
      /* f: { cam: { tanH, hfov }, dist, A (arc|null), pat, k (exposure), glare (strength), flip } */
      draw(f) {
        const timing = f.profile, t0 = timing ? performance.now() : 0;
        const W = R.W, H = R.H, hw = T.acc.w, hh = T.acc.h, tanH = Math.tan(f.hfov * Math.PI / 360), tanV = tanH * H / W;
        if (f.groundGPU) f.groundGPU(T.A.f, T.O.f);
        gl.bindVertexArray(vao); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.hdr.f); gl.viewport(0, 0, W, H);
        const pats = f.pats || [], U = P.compose.u;
        use(P.compose, { uSize: [W, H], uEye: EYE, uTanH: tanH, uTanV: tanV, uDelta0: 2 * tanH / W, uR: f.A ? f.A.R : 0, uSg: f.A ? f.A.sg : 0, uTex: f.tex || 0, uTexDist: f.texDist || 0, uLw: f.lane || 3.5, uVw: f.vw || 1.6 });
        gl.uniform1i(U.uNP, pats.length); const pa = new Float32Array(16), pd = new Float32Array(4); pats.forEach((q, k) => { pa.set([q.pat.s0, q.pat.s1, q.pat.period, q.pat.on], 4 * k); pd[k] = q.dist; }); gl.uniform4fv(U['uPat[0]'], pa); gl.uniform1fv(U['uPd[0]'], pd);
        bindTex(0, 'A', P.compose.u.uA); bindTex(2, 'O', P.compose.u.uO); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.Bt); gl.uniform1i(P.compose.u.uB, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const tCompose = timing ? performance.now() : 0;
        if (f.glare > 0) {
          const sigma = D.glareSigma(W, f.hfov), rad = Math.ceil(3 * sigma);
          gl.viewport(0, 0, hw, hh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, T.s1.f); use(P.bright, { uK: f.k, uSize: [hw, hh] }); bindTex(0, 'hdr', P.bright.u.uT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, T.acc.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
          let prev = 's1';
          for (const factor of D.GLARE_BANDS) {
            const src = 's' + factor, tmp = 'p' + factor, a = T[src];
            if (factor !== 1) { gl.disable(gl.BLEND); gl.viewport(0, 0, a.w, a.h); gl.bindFramebuffer(gl.FRAMEBUFFER, a.f); use(P.reduce, {}); bindTex(0, prev, P.reduce.u.uT); gl.drawArrays(gl.TRIANGLES, 0, 3); }
            gl.disable(gl.BLEND); gl.viewport(0, 0, a.w, a.h); gl.bindFramebuffer(gl.FRAMEBUFFER, T[tmp].f);
            use(P.blur, { uSize: [a.w, a.h], uSourceSize: [a.w, a.h], uDir: [1, 0], uSigma: sigma, uRad: rad, uScale: 1 }); bindTex(0, src, P.blur.u.uT); gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.viewport(0, 0, hw, hh); gl.bindFramebuffer(gl.FRAMEBUFFER, T.acc.f); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
            use(P.blur, { uSize: [hw, hh], uSourceSize: [a.w, a.h], uDir: [0, 1], uSigma: sigma, uRad: rad, uScale: f.glare * D.GLARE_WEIGHT }); bindTex(0, tmp, P.blur.u.uT); gl.drawArrays(gl.TRIANGLES, 0, 3); prev = src;
          }
          gl.disable(gl.BLEND);
        }
        const tGlare = timing ? performance.now() : 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, R.cw, R.ch);
        use(P.fin, { uSize: [R.cw, R.ch], uK: f.k, uFlip: f.flip ? 1 : 0, uGl: f.glare > 0 ? 1 : 0, uVeil: f.veil || 0, uTanH: tanH, uTanV: tanV });
        const sources = f.sources || [], sa = new Float32Array(128); sources.slice(0, 32).forEach((q, i) => sa.set(q, i * 4)); gl.uniform1i(P.fin.u.uNS, Math.min(32, sources.length)); gl.uniform4fv(P.fin.u['uSources[0]'], sa);
        bindTex(0, 'hdr', P.fin.u.uHdr); bindTex(1, 'acc', P.fin.u.uGlare); gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (timing) Object.assign(timing, { composeMs: tCompose - t0, glareMs: tGlare - tCompose, finalVeilMs: performance.now() - tGlare });
      },
      // the HDR sim image back on the CPU (tests): Float32Array 4·W·H, row 0 = top
      readHdr() { const a = new Float32Array(4 * R.W * R.H); gl.bindFramebuffer(gl.FRAMEBUFFER, T.hdr.f); gl.readPixels(0, 0, R.W, R.H, gl.RGBA, gl.FLOAT, a); return a; },
      readCanvas() { const a = new Uint8Array(4 * R.cw * R.ch); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, R.cw, R.ch, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; },
      sync() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); const a = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); },     // waits for the GPU (benchmarks)
    };
    return R;
  }

  // ---------------------------------------------------------------- the view: state, canvas, loop
  // Scale is separate from samples per pixel. pinSS freezes both for reproducible comparisons.
  const RES_SCALES = [1, 0.85, 0.7, 0.55, 0.4];
  const resolutionState = () => ({ scale: 1, index: 0, slow: 0, fast: 0, cooldown: 0, average: 0 });
  function resolutionStep(state, ms, opts) {
    const o = opts || {}, s = Object.assign(resolutionState(), state), target = Number.isFinite(+o.target) && +o.target > 0 ? +o.target : 33;
    if (!o.enabled || o.pinned) return resolutionState();
    if (!(ms > 0) || !Number.isFinite(ms)) return s;
    s.average = s.average ? 0.8 * s.average + 0.2 * ms : ms;
    if (s.cooldown > 0) { s.cooldown--; return s; }
    if (s.average > target * 1.15) { s.slow++; s.fast = 0; }
    else if (s.average < target * 0.7) { s.fast++; s.slow = 0; }
    else s.slow = s.fast = 0;
    if (s.slow >= 6 && s.index < RES_SCALES.length - 1) { s.index++; s.slow = s.fast = 0; s.cooldown = 20; s.average = 0; }
    else if (s.fast >= 60 && s.index > 0) { s.index--; s.slow = s.fast = 0; s.cooldown = 20; s.average = 0; }
    s.scale = RES_SCALES[s.index]; return s;
  }
  function resolutionPrepare() {
    const o = info().o;
    if (!o.dynamicResolution || V.pinSS) V.resolution = resolutionState();
    const scale = o.dynamicResolution && !V.pinSS ? (V.resolution || resolutionState()).scale : 1;
    if (scale !== (V.renderScale || 1)) { prepare(layout()); if (Wk.list.length) workerCfg(); }
  }
  const profileOn = () => !!(V.info && V.info.o.debugTimings);
  function recordFrame(start, values, trace, cache, worker) {
    const now = performance.now(), o = info().o, elapsed = now - start;
    const live = S(V.ui).playing && V.last && !Wk.afterFrame, cadenceMs = live && V.completedAt ? now - V.completedAt : elapsed;
    V.completedAt = live ? now : 0;
    V.times.push(now); while (V.times.length > 2 && V.times[1] < now - 1000) V.times.shift();
    V.resolution = resolutionStep(V.resolution, Math.max(elapsed, cadenceMs), { enabled: !!o.dynamicResolution, pinned: !!V.pinSS, target: o.frameTargetMs });
    if (profileOn()) {
      const sample = { at: now, frameMs: Math.max(elapsed, cadenceMs), workMs: elapsed, cadenceMs, pacingMs: Math.max(0, cadenceMs - elapsed), workerOtherMs: Math.max(0, (values.workerCpuMs || 0) - (trace && trace.traceMs || 0)), mainMs: worker ? Math.max(0, elapsed - (values.workerRoundTripMs || 0)) + (values.dispatchMs || 0) : elapsed, worker: !!worker, ...values,
        objectMs: trace && trace.objectMs || 0, groundMs: trace && trace.groundMs || 0, wetMs: trace && trace.wetMs || 0, traceCpuMs: trace && trace.traceMs || 0,
        cacheHits: cache && cache.cacheHits || 0, cacheMisses: cache && cache.cacheMisses || 0, sampledRays: trace && trace.sampledRays || 0 };
      (V.profiles || (V.profiles = [])).push(sample); if (V.profiles.length > 600) V.profiles.shift();
    }
    if ((o.fpsCounter || o.debugTimings) && now - (V.perfLabelAt || 0) >= 500) { V.perfLabelAt = now; perfLabel(); }
  }
  const V = { ui: null, cv: null, info: null, gl: null, canvas: null, pop: null, g: null, gkey: '', src: null, skey: '', lut: null, rgba: null, band: [0, 0], frames: 0, raf: 0, last: 0, times: [], cpu: { obj: 0, up: 0, gl: 0, n: 0 }, kAuto: null, why: '', act: new Map() };
  const S = (ui) => ui.dvAnim || (ui.dvAnim = { view: 'still', playing: true, popout: false, dist: 0, total: 0, t: 0 });
  const supported = (o) => !!ANIM_SCENES[o.scene] || (o.tiles && o.scene === 'intersection');
  const visible = () => {
    const ui = V.ui; if (!ui || !V.canvas || !V.info || typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return false;
    if (!V.canvas.isConnected || !V.canvas.getClientRects().length) return false;          // collapsed pane, display: none (the canvas itself, not its parent)
    return S(ui).popout || (ui.display === 'drive' && ui.store.scene.mode === 'D');
  };

  function size() {                                           // → { cssW, cssH, dpr, W, H } for the container the canvas lives in
    const par = V.canvas.parentElement, bw = par.clientWidth, bh = par.clientHeight, dpr = Math.min(2, root.devicePixelRatio || 1);
    const cssW = Math.max(16, Math.min(bw, bh * 16 / 9)), cssH = cssW * 9 / 16, baseW = Math.max(MIN_SIM, Math.min(V.info && (V.info.o.tiles || (V.info.o.wet && V.info.o.wetSheen)) ? 640 : V.info && HEAVY_SIM[V.info.o.scene] || MAX_SIM, Math.round(cssW * dpr))) & ~1,       // dynamic tiles redraw the ground: 640 px; forest/city otherwise use their existing cap (canvas size unchanged)
       scale = V.info && V.info.o.dynamicResolution && !V.pinSS ? (V.resolution || resolutionState()).scale : 1, W = Math.max(160, Math.round(baseW * scale)) & ~1, H = Math.round(W * 9 / 16) & ~1;
    return { cssW, cssH, dpr, W, H, baseW, scale, left: (bw - cssW) / 2, top: (bh - cssH) / 2 };
  }
  function ensureCanvas() {
    if (V.lost || V.glFailed) return false;
    if (V.canvas) return !!V.gl;
    const c = document.createElement('canvas'); c.className = 'drive-gl'; c.setAttribute('aria-label', 'Animated drive view'); c.setAttribute('role', 'img');
    c.addEventListener('webglcontextlost', contextLost);
    c.addEventListener('webglcontextrestored', contextRestored);
    try { V.gl = makeGL(c); } catch (e) { V.why = String(e.message || e); }
    if (!V.gl) { say('WebGL2 with float render targets is unavailable; showing the CPU still view.'); return false; }
    V.canvas = c; return true;
  }
  const recovery = () => !RF.SolverHost || RF.SolverHost.recovery();
  function say(message) {
    V.why = message;
    if (!V.cv) return;
    if (!V.notice) V.notice = E('div', { class: 'drive-notice', 'data-anim': 'notice', role: 'status' });
    V.notice.textContent = message; V.notice.hidden = !message;
    const host = V.popStage || V.cv.parentElement; if (V.notice.parentElement !== host) host.append(V.notice);
  }
  function contextFallback(why) {
    clearTimeout(V.restoreTimer); V.restoreTimer = 0; V.glFailed = true; stop(); killWorkers();
    const st = S(V.ui); if (st.gameMode) toggleGame(V.ui); st.playing = false; st.view = 'still';
    if (V.canvas) V.canvas.hidden = true;
    if (st.popout) closePop(V.ui);
    say(why + '; showing the CPU still view. Reload the page to retry animation.'); V.ui.redrawSpec();
  }
  function contextLost(e) {
    if (!recovery()) return;
    e.preventDefault(); if (V.lost || V.glFailed) return;
    if (V.three) { V.three.dispose(); V.three = null; V.gpuFailure = 'context lost; using CPU renderer after restore'; }
    V.lost = true; V.resume = S(V.ui).playing; S(V.ui).playing = false; stop(); killWorkers();
    const game = S(V.ui).game; if (game && !game.done) { game.pauseAt = performance.now(); if (game.inputs) game.inputs.clear(); RF.DriveGame.press(game, false, performance.now()); }
    if (V.canvas) V.canvas.hidden = true;
    say('Drive graphics context lost; paused while waiting for restore.');
    V.restoreTimer = setTimeout(() => contextFallback('Drive graphics did not restore within 8 seconds'), V.restoreMs || 8000);
    if (V.bar) labels(V.ui);
  }
  function contextRestored() {
    if (!V.lost || V.glFailed) return;
    clearTimeout(V.restoreTimer); V.restoreTimer = 0;
    try {
      V.gl = makeGL(V.canvas); if (!V.gl) throw new Error('float render targets unavailable');
      V.lost = false; V.gkey = ''; V.rdRef = null; V.band = [0, 0];
      const g = S(V.ui).game;   // UX1-DP-test: a running minigame stays paused after a restore until the player resumes (same as the hidden-tab path)
      S(V.ui).playing = !!V.resume && !(g && !g.done); say(V.gpuFailure ? 'GPU drive context was lost; using CPU renderer.' : ''); V.ui.redrawSpec();
    } catch (e) { contextFallback('Drive graphics rebuild failed: ' + (e.message || e)); }
  }
  function contextReady() {
    if (V.lost || V.glFailed || !V.gl) return false;
    if (recovery() && V.gl.gl.isContextLost()) { contextLost({ preventDefault() {} }); return false; }
    return true;
  }
  const info = () => V.info;
  // everything the picture depends on except the scenery classes and the car's position
  function prepare(sz) {
    const I = info(), o = I.o, W = sz.W, H = sz.H, key = JSON.stringify([I.groundKey, W, H, I.us && o.cline === 'broken', !!o.tiles, !!V.three]);
    const skey = JSON.stringify([o.scene, I.rd.laneDrive, I.us, o.people, o.animals, o.signs, o.posts, o.veg, o.obstacle, o.rpm, o.wild, o.seed, o.density, o.cline, !!o.tiles]), tkey = JSON.stringify([skey, o.oncoming, o.preceding, o.onKcd, o.onMode, o.trafficDensity, o.safeGap, !!o.trafficLogic, !!o.tileCache, o.tiles && [o.streetLamps, o.tex, o.wet]]);
    if (V.skey !== tkey || !V.src) { if (V.akey !== skey) V.act.clear(); V.akey = skey; V.srcArgs = [o.scene, I.rd.laneDrive, I.us, { people: o.people, animals: o.animals, signs: o.signs, posts: o.posts, veg: o.veg, obstacle: o.obstacle, rpm: o.rpm }, { wild: !!o.wild, seed: o.seed, density: o.density, cline: o.cline, oncoming: o.oncoming, preceding: o.preceding, onKcd: o.onKcd, onMode: o.onMode, trafficDensity: o.trafficDensity, safeGap: o.safeGap, trafficLogic: !!o.trafficLogic, speed: o.speed, tiles: !!o.tiles, tileCache: !!o.tileCache, streetLamps: o.streetLamps, tex: o.tex, wet: o.wet }]; const old = V.src; V.src = source.apply(null, V.srcArgs); if (old && old.traffic.logic && o.trafficLogic && old.traffic.seed === V.src.traffic.seed && old.traffic.density === V.src.traffic.density && !!old.tiles === !!V.src.tiles) V.src.traffic.state = old.traffic.state; V.skey = tkey; if ((old && old.traffic.logic) || V.src.traffic.logic) Wk.busy = null; }
    const fkey = JSON.stringify([o.scene, o.seed, o.trafficDensity, !!o.trafficLogic]);
    if (V.fkey !== fkey) { V.flash = flashState(); V.fkey = fkey; }
    V.renderScale = sz.scale || 1;
    V.p = { w: W, h: H, hfov: o.fov, lamps: I.rd.mdl.lamps, lut: I.lut(), conv: I.conv, A: I.A, lane: I.rd.laneDrive, look: { wet: o.wet, wetSheen: o.wetSheen, grain: o.tex !== false, RL: o.RL / 1000, ambient: o.ambient }, src: V.src };
    if (V.gkey !== key || V.rdRef !== I.rd) {
      V.g = V.three || o.tiles || (o.wet && o.wetSheen) ? { A: new Float32Array(3 * W * H), layers: [], ms: 0 } : ground(V.p); V.gkey = key; V.rdRef = I.rd; V.gl.resize(W, H, Math.round(sz.cssW * sz.dpr), Math.round(sz.cssH * sz.dpr)); V.gl.setGround(V.g);
      V.rgba = new Float32Array(4 * W * H); V.band = [0, H];                    // the object texture may hold an older picture: the next frame rewrites all of it
    }
    V.gl.resize(W, H, Math.round(sz.cssW * sz.dpr), Math.round(sz.cssH * sz.dpr));
  }
  function frameSources(dist, t) {
    let p = V.p; if (p.src.tiles) p = Object.assign({}, p, { A: tileRoute(p.src.tiles.seed, dist) });
    return D.glareSources(trafficObjects(p.src, trafficCars(p.src, dist, t), p.A, p), EYE);
  }
  function exposure(sources) {
    const I = info(), o = I.o;
    if (o.expMode === 'auto' && V.kAuto) return V.kAuto;
    const k = Math.pow(2, o.ev) / D.L_REF;
    return o.expMode === 'adapt' ? 1 / (1 / k + D.veilStrength(o.glare) * D.veilAt([1, 0, 0], sources || frameSources(S(V.ui).dist, S(V.ui).t))) : k;
  }
  function exposureLabel(k) {
    V.white = 1 / k;
    const I = info(), o = I.o, b = V.ui.driveExtras && V.ui.driveExtras.querySelector('[data-dv="ev"]');
    if (o.expMode === 'adapt' && b) b.textContent = 'EV ' + (o.ev >= 0 ? '+' : '−') + Math.abs(o.ev).toFixed(1) + ' · white ' + V.white.toPrecision(3) + ' cd/m²';
    return k;
  }
  const ssNow = () => V.pinSS || (V.p.w > 1100 ? 1 : (V.ss || 2));
  // samples per pixel for the objects: 2×2 where it is cheap; one while a big object is close (the cost is its area) and until things are calm again. ms = what the last frame's trace took
  function adaptSS(ms) {
    V.avg = V.avg === undefined ? ms : V.avg * 0.9 + ms * 0.1;       // a smoothed cost: one slow frame (a big object passing) must not drop the edges to hard 1-sample for a long while
    if (V.p.w <= 1100) { if ((V.ss || 2) === 2 && V.avg > 18) { V.ss = 1; V.calm = 0; } else if (V.ss === 1 && V.avg < 8) { if (++V.calm > 20) V.ss = 2; } else V.calm = 0; }
  }
  // one frame at S.dist
  function frame() {
    if (!contextReady()) return;
    const t0 = performance.now(); resolutionPrepare();
    const ui = V.ui, st = S(ui), I = info(), o = I.o, W = V.p.w, pb = V.band, had = pb[1] > pb[0], profiling = profileOn(), trafficMs = V.cameraMs || 0;
    V.cameraMs = 0; V.p.profile = profiling ? {} : null;
    if (had && !V.three) V.rgba.fill(0, pb[0] * W * 4, pb[1] * W * 4);                       // last frame's rows go back to zero, then this frame's are traced
    V.src.traffic.speed = +info().o.speed || 50; pruneAct(V.act, st.dist); activate(V.src, st.dist, st.t, V.act);
    const placed = (V.src.tiles ? tileWorld : placedObjects)(V.p, st.dist, st.t, tauFor(V.act, st.t));
    if (st.game) {
      const mask = V.p.hazardMask = new Uint8Array(W * V.p.h);
      V.p.hazardBodyMask = new Uint8Array(W * V.p.h); V.p.sampleTiles = new Uint8Array(Math.ceil(W / 16) * Math.ceil(V.p.h / 16));
      gameObjects(st.game, placed); V.gameMask = mask; V.gameBodyMask = V.p.hazardBodyMask;
    } else V.p.sampleTiles = V.p.hazardMask = V.p.hazardBodyMask = null;
    const tPlaced = performance.now(), ss = ssNow(), rows = V.three
      ? [0, V.p.h]
      : objects(V.p, st.dist, V.rgba, ss, null, null, placed, st.t);
    const traceProfile = V.p.profile && Object.assign({}, V.p.profile), t1 = performance.now();
    adaptSS(t1 - t0);
    if (!V.three) V.gl.setObjects(V.rgba, had ? Math.min(pb[0], rows[0]) : rows[0], had ? Math.max(pb[1], rows[1]) : rows[1]); V.band = rows;      // upload the rows either frame touched
    const t2 = performance.now();
    const sources = D.glareSources(V.src.tiles ? placed.objects : placed, EYE);
    const sourceEnd = performance.now(), glProfile = profiling ? {} : null;
    const draw = { profile: glProfile, hfov: o.fov, pats: patArgs(V.g, st.dist), A: I.A, k: exposureLabel(exposure(sources)), glare: D.glareStrength(o.glare), veil: D.veilStrength(o.glare), sources, flip: I.mirrored, tex: o.tex && !o.tiles ? TEX_AMP * (o.wet ? 0.5 : 1) : 0, texDist: st.dist % TEX_WRAP, lane: V.p.lane };
    if (V.three) { const world = V.src.tiles ? placed : { A: V.p.A, objects: placed }; draw.groundGPU = (target, objTarget) => V.three.render(V.p, world, st.dist, target, objTarget, ss); if (V.src.tiles || (o.wet && o.wetSheen)) draw.tex = 0; }
    try { V.gl.draw(draw); } catch (e) { if (!V.three) throw e; gpuFallback(e.message || e); prepare(layout()); frame(); return; }
    if (!contextReady()) return; if (st.game) V.gameRender = { placed, ss, draw };
    const t3 = performance.now(), c = V.cpu; c.obj += t1 - t0; c.up += t2 - t1; c.gl += t3 - t2; c.n++; V.frames++; (V.ring || (V.ring = [])).push(t1 - t0); if (V.ring.length > 600) V.ring.shift();
    flashLabel(st.dist, st.t); const detectorStart = performance.now(); if (st.game) { if (V.three) { const masks = V.three.masks(V.p, ss); V.gameMask = masks.mask; V.gameBodyMask = masks.body; } gameFrame(st.game); } const detectorMs = performance.now() - detectorStart; ui.dvAnimFrames = V.frames;
    recordFrame(t0 - trafficMs, { trafficMs, placementMs: tPlaced - t0, uploadMs: t2 - t1, sourcesMs: sourceEnd - t2, glMs: t3 - sourceEnd, ...(glProfile || {}), detectorMs, workerRoundTripMs: 0, workerCpuMs: 0, assemblyMs: 0 }, traceProfile, traceProfile, false);
  }

  // ---------------------------------------------------------------- the object trace on worker threads
  /* The trace is the whole cost of a frame (the GPU passes and the upload are < 1 ms), and every pixel is independent: n workers (js/drive-worker.js) each trace the tile rows ty % n === i of the same frame and send them
   * back as one packed Float32Array (transferred, and returned to them with the next request, so nothing is allocated per frame). The page assembles the rows, uploads the touched band and draws with the dist the frame
   * was traced at, so the objects, the dashes and the grain are always the same instant. One frame in flight at a time. Off (the "threads" switch), no Worker (file://), or a worker that fails: the page traces itself, as before.  */
  const Wk = { list: [], cfgKey: '', lut: null, cfgId: 0, seq: 0, busy: null, failed: '', pool: [], forced: 0, afterFrame: null, jobs: new Map(), restarts: 0, maxRestarts: 2, deadlineMs: 3000 };
  const nWorkers = () => Wk.forced || Math.max(1, Math.min(6, ((root.navigator && root.navigator.hardwareConcurrency) || 4) - 2));
  function killWorkers() { for (const j of Wk.jobs.values()) clearTimeout(j.timer); Wk.jobs.clear(); for (const w of Wk.list) w.terminate(); Wk.list = []; Wk.cfgKey = ''; Wk.lut = null; Wk.busy = null; Wk.pool = []; if (Wk.afterFrame) { const done = Wk.afterFrame; Wk.afterFrame = null; done(false); } }
  function failWorkers(why) { killWorkers(); Wk.failed = String(why || 'worker error'); say('worker threads unavailable (' + Wk.failed.split('\n')[0].slice(0, 120) + '): the page traces the objects itself'); if (V.ui) { V.last = 0; if (V.info && V.bar) labels(V.ui); go(); } }
  function spawnWorker(i) {
    const w = new Worker('js/drive-worker.js'); Wk.list[i] = w;
    w.onmessage = (e) => { if (Wk.list[i] !== w) return; const d = e.data, j = Wk.jobs.get(i); if (j && d && (d.type === 'err' || (d.seq === j.msg.seq && d.cfg === j.cfg && d.c === j.msg.c))) { clearTimeout(j.timer); Wk.jobs.delete(i); } onWorker(d); };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); if (Wk.list[i] === w) failWorkers(e && e.message); };
    return w;
  }
  // true when this frame is traced on workers (they are started, or stopped, to match the switch)
  function mt() {
    const want = !V.three && !S(V.ui || {}).game && !Wk.failed && typeof Worker !== 'undefined' && !!V.info && V.info.o.mt !== false && Wk.forced !== -1, n = nWorkers();
    if (!want) { if (Wk.list.length) killWorkers(); return false; }
    if (Wk.list.length !== n) {
      killWorkers();
      try { for (let i = 0; i < n; i++) spawnWorker(i); }
      catch (e) { failWorkers(e && e.message); return false; }
    }
    return true;
  }
  // tell the workers what the picture is made of (when that changes): the scenery's recipe, the camera, the beam
  function workerCfg() {
    const I = info(), p = V.p, key = JSON.stringify([V.skey, p.w, p.h, p.hfov, p.lane, p.conv, p.lamps, p.look, I.A && [I.A.R, I.A.dir]]);
    if (key === Wk.cfgKey && Wk.lut === p.lut) return;
    Wk.cfgKey = key; Wk.lut = p.lut; Wk.cfgId++; Wk.busy = null;           // a frame in flight belongs to the old picture: dropped when it arrives
    const m = { type: 'cfg', id: Wk.cfgId, p: { w: p.w, h: p.h, hfov: p.hfov, lamps: p.lamps, lut: p.lut, conv: p.conv, lane: p.lane, look: p.look }, arc: I.A ? { R: I.A.R, dir: I.A.dir } : null, src: V.srcArgs };
    Wk.config = m;
    for (const w of Wk.list) w.postMessage(m);
  }
  // the frame is cut into K jobs (tile rows ty % K === c); every worker gets one, and a worker that finishes gets the next: threads that run slower (efficiency cores, a busy machine) just do fewer
  function sendFrame() {
    const started = performance.now(); resolutionPrepare();
    const trafficMs = V.cameraMs || 0; V.cameraMs = 0;
    const st = S(V.ui), n = Wk.list.length, ss = ssNow(), th = Math.ceil(V.p.h / 16), K = n > 1 ? Math.min(th, 4 * n) : 1; Wk.seq++;
    V.src.traffic.speed = +info().o.speed || 50; pruneAct(V.act, st.dist); activate(V.src, st.dist, st.t, V.act);
    const b = Wk.busy = { seq: Wk.seq, started: started - trafficMs, trafficMs, dist: st.dist, t: st.t, sent: performance.now(), done: 0, next: 0, K, ss, speed: V.src.traffic.speed, traffic: V.src.traffic.logic ? trafficCars(V.src, st.dist, st.t) : null, act: [...V.act], parts: [] };
    b.sent = performance.now(); b.placementMs = b.sent - started; b.dispatchMs = 0;
    for (let i = 0; i < n && b.next < K && Wk.busy === b; i++) sendJob(i, b);
    b.dispatchMs += performance.now() - b.sent;
  }
  function sendJob(i, b) { postJob(i, { type: 'job', seq: b.seq, dist: b.dist, t: b.t, speed: b.speed, traffic: b.traffic, ss: b.ss, profile: profileOn(), act: b.act, c: b.next++, K: b.K, wid: i }); }
  function postJob(i, msg) {
    const old = Wk.jobs.get(i); if (old) clearTimeout(old.timer);
    const j = { msg, cfg: Wk.cfgId, timer: 0 }; Wk.jobs.set(i, j);
    if (recovery()) j.timer = setTimeout(() => {
      if (Wk.jobs.get(i) !== j) return;
      Wk.jobs.delete(i); if (!recovery()) return;
      if (Wk.restarts >= Wk.maxRestarts) { failWorkers('job deadline exceeded; replacement limit reached'); return; }
      Wk.restarts++; Wk.list[i].terminate();
      try {
        const w = spawnWorker(i); w.postMessage(Wk.config);
        say('Drive worker missed its deadline; replaced (' + Wk.restarts + '/' + Wk.maxRestarts + ').');
        if (Wk.busy && Wk.busy.seq === msg.seq && j.cfg === Wk.cfgId) postJob(i, msg);
      } catch (e) { failWorkers(e.message); }
    }, Wk.deadlineMs);
    const ret = Wk.pool.pop();
    try { Wk.list[i].postMessage(Object.assign({}, msg, { ret }), ret ? [ret] : []); } catch (e) { failWorkers(e.message); }
  }
  function onWorker(d) {
    if (!d) return;
    if (d.type === 'err') { failWorkers(d.message); return; }
    if (d.type !== 'rows') return;
    const b = Wk.busy; if (!b || d.seq !== b.seq || d.cfg !== Wk.cfgId) { Wk.pool.push(d.buf); return; }       // an old picture
    const dispatchStart = performance.now(); b.parts.push(d); b.done++;
    if (b.next < b.K) sendJob(d.wid, b);
    b.dispatchMs += performance.now() - dispatchStart;
    if (b.done === b.K) finishFrame(b);
  }
  // all the rows are in: assemble, upload what was touched, draw at the dist they were traced at
  function finishFrame(b) {
    Wk.busy = null; if (!contextReady() || !V.canvas || !V.rgba || !V.ui) { for (const d of b.parts) Wk.pool.push(d.buf); return; }
    const I = info(), o = I.o, W = V.p.w, H = V.p.h, TS = 16, t1 = performance.now(), pb = V.band, had = pb[1] > pb[0]; let y0 = H, y1 = 0;
    if (had) V.rgba.fill(0, pb[0] * W * 4, pb[1] * W * 4);                       // last frame's rows go back to zero, then this frame's are copied in
    for (const d of b.parts) {
      const f = new Float32Array(d.buf, 0, d.len); let off = 0;
      for (const ty of d.trows) { const a = ty * TS, e = Math.min(H, a + TS), n = (e - a) * W * 4; V.rgba.set(f.subarray(off, off + n), a * W * 4); off += n; if (a < y0) y0 = a; if (e > y1) y1 = e; }
      Wk.pool.push(d.buf);
    }
    if (y1 <= y0) { y0 = 0; y1 = 0; }
    const assembled = performance.now();
    V.gl.setObjects(V.rgba, had ? Math.min(pb[0], y0) : y0, had ? Math.max(pb[1], y1) : y1); V.band = [y0, y1];
    const t2 = performance.now();
    const sources = frameSources(b.dist, b.t), sourceEnd = performance.now(), glProfile = profileOn() ? {} : null;
    V.gl.draw({ profile: glProfile, hfov: o.fov, pats: patArgs(V.g, b.dist), A: I.A, k: exposureLabel(exposure(sources)), glare: D.glareStrength(o.glare), veil: D.veilStrength(o.glare), sources, flip: I.mirrored, tex: o.tex && !o.tiles ? TEX_AMP * (o.wet ? 0.5 : 1) : 0, texDist: b.dist % TEX_WRAP, lane: V.p.lane });
    if (!contextReady()) return;
    const t3 = performance.now(), c = V.cpu, rt = t1 - b.sent;
    c.obj += rt; c.up += t2 - t1; c.gl += t3 - t2; c.n++; V.frames++; (V.ring || (V.ring = [])).push(rt); if (V.ring.length > 600) V.ring.shift();
    adaptSS(rt); flashLabel(b.dist, b.t); V.ui.dvAnimFrames = V.frames;
    const trace = {};
    for (const d of b.parts) if (d.profile) for (const k of ['traceMs', 'objectMs', 'groundMs', 'wetMs', 'sampledRays', 'cacheHits', 'cacheMisses']) trace[k] = (trace[k] || 0) + (d.profile[k] || 0);
    recordFrame(b.started, { dispatchMs: b.dispatchMs, trafficMs: b.trafficMs, placementMs: b.placementMs, assemblyMs: assembled - t1, uploadMs: t2 - assembled, sourcesMs: sourceEnd - t2, glMs: t3 - sourceEnd, ...(glProfile || {}), detectorMs: 0, workerRoundTripMs: rt, workerCpuMs: b.parts.reduce((sum, d) => sum + d.ms, 0) }, trace, trace, true);
    if (Wk.afterFrame) Wk.afterFrame(); else pump(t3, 14);
  }
  // advance the drive to `now` and ask for the next frame, unless one is out (called by the display's frame callback, and by a finished frame when the display has already waited `minGap` ms)
  function pump(now, minGap) {
    const ui = V.ui, st = S(ui); if (!V.raf || Wk.busy || !st.playing || now - (Wk.sentAt || 0) < minGap) return;
    const dt = V.last ? Math.min(0.1, (now - V.last) / 1000) : 0; V.last = now; Wk.sentAt = now;
    advanceCamera(st, dt); sendFrame();
  }
  function advanceCamera(st, dt) {
    const start = performance.now(); advanceCameraInner(st, dt); V.cameraMs = (V.cameraMs || 0) + performance.now() - start;
  }
  function advanceCameraInner(st, dt) {
    if (st.game) {
      RF.DriveGame.step(st.game, dt, V.p.lane, V.p); st.total += st.game.x - st.dist; st.dist = st.game.x; st.t = st.game.t; st.camera = { x: st.dist, v: st.game.v };
      if (st.game.done) st.playing = false; return;
    }
    const speed = (+info().o.speed || 50) / 3.6;
    if (!V.src.traffic.logic) { st.total += speed * dt; st.dist += speed * dt; st.t += dt; st.camera = null; return; }
    V.src.traffic.speed = speed * 3.6;
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(IDM.dt, left), old = st.camera;
      const camera = old && Math.abs(old.x - st.dist) < 1e-7 ? old : { x: st.dist, v: Math.min(speed, speedLimit(V.src, st.dist)) };
      st.camera = cameraStep(V.src, camera, h, st.t); st.total += st.camera.x - st.dist; st.dist = st.camera.x; st.t += h; left -= h;
    }
  }
  // n frames back to back on the workers (no display pacing), waiting for each: → a promise of { msPerFrame (fresh frames), ... stats }
  function benchMT(n) {
    return new Promise((resolve) => {
      const ui = V.ui, st = S(ui), d0 = st.dist, t0s = st.t, was = st.playing, flashes = V.flash, traffic = V.src.traffic.state; if (!mt()) { resolve(null); return; }
      V.src.traffic.state = copyTraffic(traffic);
      st.playing = false; V.flash = flashState(); stop(); workerCfg(); resetStats(); const t0 = performance.now(); let i = 0, mid = 0;
      const step = (drawn) => {
        if (drawn === false) { Wk.afterFrame = null; st.dist = d0; st.t = t0s; st.playing = was; V.flash = flashes; V.src.traffic.state = traffic; flashText(); resolve(null); return; }
        if (i === Math.floor(n / 5)) { resetStats(); mid = performance.now(); }       // the first fifth is warm-up (worker start, JIT)
        if (i++ >= n) { V.gl.sync(); const ms = (performance.now() - mid) / (n - Math.floor(n / 5)); Wk.afterFrame = null; st.dist = d0; st.t = t0s; st.playing = was; V.flash = flashes; V.src.traffic.state = traffic; flashText(); resolve(Object.assign({ n, msPerFrame: ms, workers: Wk.list.length }, stats())); return; }
        st.dist += 0.5; st.t += 0.5 / ((+info().o.speed || 50) / 3.6); sendFrame();
      };
      Wk.afterFrame = step; step(); void t0;
    });
  }
  // one frame on the workers at a given dist (tests): → a promise, true when it was drawn
  function frameMT(dist, t) { return new Promise((res) => { if (!mt()) { res(false); return; } workerCfg(); const st = S(V.ui); st.dist = dist; if (t !== undefined) st.t = t; Wk.afterFrame = (drawn) => { Wk.afterFrame = null; res(drawn !== false); }; sendFrame(); }); }
  function layout() {
    const sz = size(), cs = V.canvas.style, cw = Math.round(sz.cssW * sz.dpr), ch = Math.round(sz.cssH * sz.dpr);
    if (V.canvas.width !== cw || V.canvas.height !== ch) { V.canvas.width = cw; V.canvas.height = ch; }
    cs.left = sz.left + 'px'; cs.top = sz.top + 'px'; cs.width = sz.cssW + 'px'; cs.height = sz.cssH + 'px'; return sz;
  }
  // the large view belongs to the Spec Result → Drive view: leave the mode or the display and it goes
  const popValid = (ui) => ui.store && ui.store.scene.mode === 'D' && ui.display === 'drive';
  function tick(t) {
    V.raf = 0; const ui = V.ui, st = S(ui);
    if (!contextReady()) return;
    if (st.popout && !popValid(ui)) { closePop(ui); return; }
    if (!visible() || !st.playing || !(st.view === 'anim' || st.popout)) {
      if (st.game && !st.game.done) { if (st.game.pauseAt === undefined) st.game.pauseAt = performance.now(); st.game.brake = false; if (st.game.inputs) st.game.inputs.clear(); st.playing = false; }
      V.suspended = true; return;
    }
    if (mt()) { workerCfg(); V.raf = requestAnimationFrame(tick); pump(t, 0); return; }
    const dt = V.last ? (st.game ? Math.max(0, (t - V.last) / 1000) : Math.min(0.1, (t - V.last) / 1000)) : 0; V.last = t;
    advanceCamera(st, dt);
    frame(); if (st.playing) V.raf = requestAnimationFrame(tick);
  }
  function stop() { if (V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; } V.last = 0; V.completedAt = 0; }
  function go() { if (!V.lost && !V.glFailed && !V.raf && V.gl && visible() && S(V.ui).playing) { V.last = 0; V.raf = requestAnimationFrame(tick); } }

  // ---------------------------------------------------------------- the controls
  const E = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); e.append(...kids); return e; };
  function bars(ui, setDV) {
    if (V.bar) return V.bar;
    const st = S(ui), bar = E('div', { class: 'drive-anim-tools', 'data-anim': 'bar' }), primary = ui.driveBar.querySelector('.drive-primary'), btn = (k, title, fn, txt) => { const b = E('button', { type: 'button', class: 'toggle', 'data-anim': k, title }, txt || ''); b.addEventListener('click', fn); bar.append(b); return b; };
    btn('play', 'Drive / pause the animation', () => { st.playing = !(st.playing && (st.view === 'anim' || st.popout)); if (st.playing) st.view = 'anim'; ui.redrawSpec(); });
    btn('fit-controls', 'Compact spacing for the wrapping drive controls. Off uses wider spacing.', () => setDV(ui, 'fitControls', info().o.fitControls === false), 'fit controls');
    btn('large-card', 'Open the large Drive view when a game scorecard ends in the inline pane. Off keeps the inline card.', () => setDV(ui, 'largeCard', info().o.largeCard === false), 'large scorecard');
    const sp = E('input', { type: 'range', min: 5, max: 130, step: 5, 'data-anim': 'speed', 'aria-label': 'Speed (km/h)', title: 'Target speed; traffic logic also obeys road limits and queues' }); sp.addEventListener('input', () => { setDV(ui, 'speed', +sp.value, true); speedLabel(ui); });
    const lab = E('span', { class: 'anim-speed', 'data-anim': 'speedlab' }); bar.append(sp, lab);
    const speedBox = E('span', { class: 'drive-speed' }); speedBox.append(sp, lab);
    primary.querySelector('[data-dv=scene]').after(speedBox);
    primary.append(bar.querySelector('[data-anim=play]'));
    btn('traffic-logic', 'IDM car following and red/yellow stops. Cars turn at junctions and yield to oncoming traffic. Speed targets the lower of slider and road limit; actual speed appears when different. Off restores the previous traffic and gap guard.', () => { st.camera = null; setDV(ui, 'trafficLogic', !info().o.trafficLogic); }, 'traffic logic');
    btn('gap', 'Remove a preceding car at max(25 m, 2 seconds of our current speed); the seeded stream supplies the next car ahead. Off = original traffic without a gap guard.', () => setDV(ui, 'safeGap', info().o.safeGap === false), 'gap guard');
    btn('gpu-renderer', 'Render the animated road on the GPU; HTTP required. Off keeps the CPU reference.', () => setDV(ui, 'gpuRenderer', !info().o.gpuRenderer), 'GPU drive renderer');
    btn('fps-counter', 'Small frame-rate badge; no sampled trace profiling.', () => setDV(ui, 'fpsCounter', !info().o.fpsCounter), 'FPS');
    btn('debug-timings', 'Full CPU timing breakdown with sampled trace profiling. GPU execution requires the tester bench.', () => setDV(ui, 'debugTimings', !info().o.debugTimings), 'Debug timings');
    btn('dynamic-resolution', 'Reduce trace/render dimensions when frames exceed the target; restore slowly with headroom. Off restores full resolution. pinSS freezes scale.', () => setDV(ui, 'dynamicResolution', !info().o.dynamicResolution), 'dynamic resolution');
    const target = E('input', { type: 'number', min: 16, max: 200, step: 1, 'data-anim': 'frame-target', 'aria-label': 'Frame target (ms)', title: 'Dynamic resolution target, milliseconds per frame', class: 'anim-seed' });
    target.addEventListener('change', () => setDV(ui, 'frameTargetMs', Math.max(16, Math.min(200, +target.value || 33)))); bar.append(target);
    V.fpsLab = E('output', { class: 'drive-fps', 'data-anim': 'fps-readout', 'aria-live': 'off', hidden: '' });
    V.perfLab = E('output', { class: 'drive-perf', 'data-anim': 'perf-readout', 'aria-live': 'off', hidden: '' });
    btn('tile-cache', 'Reuse beam-lit ground samples across route tiles. Moving markings, grain and street lights still update each frame. Animation with tiles only.', () => setDV(ui, 'tileCache', !info().o.tileCache), 'cache ground');
    const lamps = E('select', { 'data-anim': 'street-lamps', 'aria-label': 'Street lamps on urban tiles', title: 'Downward point lights, diffuse illumination without shadows; approximate sodium / LED colour, not measured fixture photometry' });
    for (const [value, label] of [['off', 'street lamps off'], ['sodium', 'sodium ~2000 K'], ['led', 'LED ~4000 K']]) lamps.append(E('option', { value }, label));
    lamps.addEventListener('change', () => setDV(ui, 'streetLamps', lamps.value)); bar.append(lamps);
    V.tileLab = E('span', { class: 'anim-speed', 'data-anim': 'tile-status', 'aria-live': 'off' }); bar.append(V.tileLab);
    for (const [k, txt, title] of CLASSES) btn('c-' + k, title, () => setDV(ui, k, !info().o[k]), txt);
    // random scenery: the seed (same seed = same road), how dense, and the US centre line (double solid yellow, or the broken line of a passing zone)
    const sd = E('input', { type: 'number', min: 0, max: 99999, step: 1, 'data-anim': 'seed', 'aria-label': 'Scenery seed', title: 'Seed of the random scenery: the same number gives the same road', class: 'anim-seed' }); sd.addEventListener('change', () => setDV(ui, 'seed', Math.max(0, Math.min(99999, Math.round(+sd.value || 0)))));
    const dice = btn('dice', 'A new random seed', () => setDV(ui, 'seed', (Date.now() * 2654435761 >>> 0) % 100000), '⚄');
    const dn = E('input', { type: 'range', min: 0.5, max: 3, step: 0.5, 'data-anim': 'density', 'aria-label': 'Scenery density', title: 'How much roadside scenery (1 = about what the still view has)' }); dn.addEventListener('change', () => setDV(ui, 'density', +dn.value));
    btn('cline', 'US roads: centre line double solid yellow (no passing) or one broken yellow line (passing zone: 3 m line, 9 m gap)', () => setDV(ui, 'cline', info().o.cline === 'broken' ? 'solid' : 'broken'), 'centre');
    bar.append(sd, dice, dn);
    const td = E('input', { type: 'range', min: 0, max: 3, step: 0.5, 'data-anim': 'traffic-density', 'aria-label': 'Traffic density', title: 'Cars per 300 m in each enabled lane. Traffic logic off: oncoming 50 km/h, preceding 40 km/h. On: IDM speeds and signals.' }); td.addEventListener('change', () => setDV(ui, 'trafficDensity', +td.value));
    V.flashLab = E('span', { class: 'anim-speed', 'data-anim': 'flashes' });
    bar.append(E('span', { class: 'anim-speed' }, 'traffic'), td, V.flashLab);
    btn('reset-flashes', 'Start the count again (each driver counts once above 1 lx at their eye)', () => { V.flash = flashState(); V.flashLab.textContent = 'oncoming drivers above 1 lx: 0'; }, 'reset count');
    V.bar = bar; return bar;
  }
  function flashText() { if (V.flashLab) V.flashLab.textContent = 'oncoming drivers above 1 lx: ' + (V.flash ? V.flash.n : 0); }
  function flashLabel(dist, t) {
    if (!V.flash) V.flash = flashState();
    countFlashes(V.flash, V.p, dist, t); flashText();
    speedLabel(V.ui);
    if (V.tileLab && V.src.tiles) { const tile = roadTile(V.src.tiles.seed, Math.floor(dist / TILE_LEN)); V.tileLab.textContent = tile.kind + (['intersection', 't-junction'].includes(tile.kind) ? ' · ' + signalState(tile, t).lit : ''); }
  }
  function topButtons(ui, tb, setDV) {
    if (ui.driveExtras.querySelector('[data-anim="animate"]')) return;
    const a = E('button', { type: 'button', class: 'toggle', 'data-anim': 'animate', title: 'Animate: drive down the road. Off = the still picture.' }, 'animate');
    a.addEventListener('click', () => { const st = S(ui); st.view = st.view === 'anim' ? 'still' : 'anim'; st.playing = true; ui.redrawSpec(); });
    const tiles = E('button', { type: 'button', class: 'toggle', 'data-anim': 'tiles', title: 'Seeded route: straights, bends, intersections, T-junctions and lit urban sections. Off = the original constant road. Animation only; traces at 640 × 360.' }, 'tiles');
    tiles.addEventListener('click', () => setDV(ui, 'tiles', !info().o.tiles));
    const game = E('button', { type: 'button', class: 'toggle', 'data-game': 'toggle', 'aria-pressed': 'false', title: 'Reach > uniformity: five hazards, hold Space or Brake. Game scoring, not legal advice.' }, 'Game');
    game.addEventListener('click', () => toggleGame(ui));
    const primary = tb.querySelector('.drive-primary'); primary.querySelector('.drive-speed') ? primary.querySelector('.drive-speed').after(game) : primary.querySelector('[data-dv=scene]').after(game);
    ui.driveExtras.append(a, tiles);
  }
  function speedLabel(ui) {
    if (!ui.driveBar) return;
    const st = S(ui), o = info().o, lab = ui.driveBar.querySelector('[data-anim=speedlab]');
    if (!lab) return;
    const actual = st.camera && o.trafficLogic && st.view === 'anim' ? st.camera.v * 3.6 : o.speed;
    lab.textContent = o.speed + ' km/h' + (Math.abs(actual - o.speed) >= 0.5 ? ' · actual ' + actual.toFixed(1) + ' km/h' : '');
  }
  function labels(ui) {
    const st = S(ui), I = info(), o = I.o, sup = supported(o), q = (s) => document.querySelectorAll(s);
    for (const b of q('[data-anim="animate"]')) { b.setAttribute('aria-pressed', String(st.view === 'anim')); b.disabled = !sup; b.title = sup ? 'Animate: drive down the road. Off = the still picture.' : 'Animation covers the open road, the forest road and the city street; enable tiles to animate a route from the intersection scene'; }
    for (const b of q('[data-anim="popout"]')) { const label = st.popout ? 'Close large view' : 'Large view'; b.setAttribute('aria-pressed', String(st.popout)); b.setAttribute('aria-label', label); b.title = label; b.disabled = !sup; b.textContent = st.popout ? '⤡' : '⤢'; }
    for (const b of q('[data-anim="tiles"]')) b.setAttribute('aria-pressed', String(!!o.tiles));
    if (!V.bar) return;
    for (const [name, key] of [['gpu-renderer', 'gpuRenderer'], ['fps-counter', 'fpsCounter'], ['debug-timings', 'debugTimings'], ['dynamic-resolution', 'dynamicResolution']]) V.bar.querySelector('[data-anim="' + name + '"]').setAttribute('aria-pressed', String(!!o[key]));
    V.bar.querySelector('[data-anim="frame-target"]').value = o.frameTargetMs || 33;
    if (V.perfLab) { V.perfLab.hidden = !o.debugTimings || !(st.view === 'anim' || st.popout); V.fpsLab.hidden = !o.fpsCounter || !(st.view === 'anim' || st.popout); perfLabel(); }
    for (const [name, key] of [['fit-controls', 'fitControls'], ['large-card', 'largeCard']]) V.bar.querySelector('[data-anim="' + name + '"]').setAttribute('aria-pressed', String(o[key] !== false));
    V.bar.hidden = !(sup && (st.view === 'anim' || st.popout));
    const run = st.playing && (st.view === 'anim' || st.popout), pb = ui.driveBar.querySelector('[data-anim="play"]'); pb.textContent = run ? '⏸ Pause' : '▶ Drive'; pb.setAttribute('aria-pressed', String(run));
    ui.driveBar.querySelector('[data-anim="speed"]').value = o.speed; speedLabel(ui);
    for (const [k] of CLASSES) { const b = V.bar.querySelector('[data-anim="c-' + k + '"]'); b.setAttribute('aria-pressed', String(!!o[k])); }
    V.bar.querySelector('[data-anim="traffic-density"]').value = o.trafficDensity === undefined ? 1 : o.trafficDensity;
    if (V.flashLab) V.flashLab.textContent = 'oncoming drivers above 1 lx: ' + (V.flash ? V.flash.n : 0);
    const trafficOn = o.oncoming || o.preceding;
    if (V.flashLab) V.flashLab.hidden = !trafficOn;
    V.bar.querySelector('[data-anim="reset-flashes"]').hidden = !trafficOn;
    V.bar.querySelector('[data-anim="traffic-logic"]').setAttribute('aria-pressed', String(!!o.trafficLogic));
    V.bar.querySelector('[data-anim="gap"]').setAttribute('aria-pressed', String(o.safeGap !== false)); V.bar.querySelector('[data-anim="gap"]').disabled = !!o.trafficLogic;
    V.bar.querySelector('[data-anim="tile-cache"]').setAttribute('aria-pressed', String(!!o.tileCache)); V.bar.querySelector('[data-anim="tile-cache"]').disabled = !o.tiles;
    V.bar.querySelector('[data-anim="street-lamps"]').value = o.streetLamps || 'sodium'; V.bar.querySelector('[data-anim="street-lamps"]').disabled = !o.tiles;
    V.tileLab.hidden = !o.tiles;
    const wd = o.wild && (o.scene === 'road' || (o.tiles && o.scene === 'intersection'));        // forest and city keep their existing scenery
    V.bar.querySelector('[data-anim="seed"]').value = o.seed; V.bar.querySelector('[data-anim="seed"]').disabled = !(wd || trafficOn || o.tiles); V.bar.querySelector('[data-anim="dice"]').disabled = !(wd || trafficOn || o.tiles);
    V.bar.querySelector('[data-anim="density"]').value = o.density; V.bar.querySelector('[data-anim="density"]').disabled = !wd;
    const cl = V.bar.querySelector('[data-anim="cline"]'); cl.disabled = !I.us; cl.textContent = o.cline === 'broken' && I.us ? 'centre: broken' : 'centre: solid'; cl.setAttribute('aria-pressed', String(o.cline === 'broken' && I.us));
    cl.title = I.us ? 'US roads: centre line double solid yellow (no passing) or one broken yellow line (passing zone: 3 m line, 9 m gap)' : 'Only on the US presets (the EU presets already have a dashed centre line)';
    for (const k of ['rpm']) V.bar.querySelector('[data-anim="c-' + k + '"]').disabled = !wd;
    const mb = V.bar.querySelector('[data-anim="c-mt"]'); mb.disabled = typeof Worker === 'undefined' || !!Wk.failed; if (Wk.failed) mb.title = V.why;
  }

  // ---------------------------------------------------------------- Reach > uniformity (all state is local to this view)
  function toggleGame(ui) {
    const st = S(ui);
    if (st.gameMode) {
      if (V.cardPop && st.popout) closePop(ui);
      stop(); killWorkers(); Object.assign(info().o, st.gameSaved.options); Object.assign(st, st.gameSaved.state);
      st.game = null; st.gameMode = false; st.gameOptions = null; V.p.hazardMask = null; V.last = 0; ui.redrawSpec(); V.flash = st.gameSaved.flash; V.src.traffic.state = st.gameSaved.traffic; V.act = st.gameSaved.act; flashText(); if (!st.playing && visible() && st.view === 'anim') frame(); return;
    }
    st.gameSaved = { options: Object.assign({}, info().o), state: { view: st.view, playing: st.playing, dist: st.dist, total: st.total, t: st.t, camera: st.camera }, flash: V.flash, traffic: V.src && V.src.traffic.state, act: new Map(V.act) };
    st.gameMode = true; st.playing = false; st.view = 'anim'; ui.redrawSpec();
  }
  function startGame(ui) {
    const st = S(ui), box = V.gameBar, speed = +box.querySelector('[data-game="speed"]').value, wet = box.querySelector('[data-game="wet"]').value === 'wet', seed = +box.querySelector('[data-game="seed"]').value;
    if (!(speed >= 5 && speed <= 130) || !Number.isInteger(seed) || seed < 0 || seed > 99999) { V.gameStatus.textContent = 'Choose 5–130 km/h and a whole seed from 0–99999.'; return; }
    if (!ui.spec || !ui.spec.full || !ui.spec.ev || ui.spec.ctx !== (ui.run && ui.run.ctx)) { V.gameStatus.textContent = 'Finish the lamp’s Spec trace before starting.'; return; }
    stop(); killWorkers();
    st.game = RF.DriveGame.create({ seed, speed, wet, verdict: ui.spec.ev.verdict, rules: box.querySelector('[data-game=rules]').value, clearLane: box.querySelector('[data-game=clear-lane]').checked, highBeam: /(?:^fmvss-ub|-drive$)/.test(ui.store.scene.modeD.preset || '') }); st.game.ctx = ui.spec.ctx; st.game.judge = ui.spec.ev; st.game.road = info().rd;
    st.gameOptions = { scene: 'road', tiles: true, wild: true, seed, speed, wet, people: false, animals: false, obstacle: false, trafficLogic: false, oncoming: true, preceding: false };
    // MG2-test: 'symmetric' oncoming lamps carry the PLAYER's design, so a high-reach lamp blinds itself (real GPU, 130 km/h wet: 7in-high first seen 48 m vs default 65 m; with a fixed generic dipped oncoming lamp: 114 m vs 63 m). The lesson needs the lamp under test to be the only variable. Original rules keep the old behaviour.
    if (st.game.rules !== 'legacy') st.gameOptions.onMode = 'generic';
    st.dist = st.total = st.t = 0; st.camera = { x: 0, v: speed / 3.6 }; st.view = 'anim'; st.playing = true;
    V.act.clear(); V.flash = flashState(); V.fkey = ''; V.last = 0; ui.redrawSpec();
  }
  function gameObjects(g, world, lane) {
    const A = world.A, K = D.kit({ Lw: lane || V.p.lane, A: null, rand: () => 0.5 });
    for (const h of g.hazards) if (g.rules !== 'legacy' || !h.resolved) {
      const ps = RF.DriveGame.pose(g, h, g.t), first = K.O.length, rel = ps.s - g.x;
      if (h.kind === 'deer') K.deer(rel, ps.off, { face: h.side > 0 ? 1 : -1, gait: ps.gait });
      else K.person(rel, ps.off, h.noHiViz ? 'dark' : 'hivis', { dir: [h.ds, h.doff], gait: ps.gait });
      for (const ob of K.O.slice(first)) { ob.gameHazard = h.id; world.objects.push(move(Object.assign({}, ob), ob, ob.x, A)); }
    }
  }
  // Counterfactual frame at the exact same pose, samples, exposure, glare and canvas size.
  // Retrace only tile rows touched by this hazard. Restore the displayed frame before returning.
  function gameBackground(id) {
    const st = S(V.ui), { placed, ss } = V.gameRender, draw = Object.assign({}, V.gameRender.draw, { profile: null }), bit = 1 << (id - 1), tileRows = new Set();
    for (let q = 0; q < V.gameMask.length; q++) if (V.gameMask[q] & bit) tileRows.add(Math.floor(q / V.p.w / 16));
    if (!tileRows.size) return null;
    const y0 = Math.min(...tileRows) * 16, y1 = Math.min(V.p.h, (Math.max(...tileRows) + 1) * 16), rgba = new Float32Array(V.rgba);
    const world = Object.assign({}, placed, { objects: placed.objects.filter((ob) => ob.gameHazard !== id) });
    if (V.three) {
      try { V.gl.draw(Object.assign({}, draw, { groundGPU: (target, objTarget) => V.three.render(V.p, world, st.dist, target, objTarget, ss) })); return V.gl.readCanvas(); }
      finally { V.gl.draw(draw); }
    }
    try {
      objects(Object.assign({}, V.p, { profile: null, hazardMask: null, hazardBodyMask: null }), st.dist, rgba, ss, null, (ty) => tileRows.has(ty), world, st.t);
      V.gl.setObjects(rgba, y0, y1); V.gl.draw(draw); return V.gl.readCanvas();
    } finally { V.gl.setObjects(V.rgba, y0, y1); V.gl.draw(draw); }
  }
  function gameFrame(g) {
    const now = performance.now(), st = S(V.ui);
    if (g.pauseAt !== undefined && st.playing) { for (const h of g.hazards) if (h.lit !== null) h.lit += now - Math.max(g.pauseAt, h.lit); delete g.pauseAt; }
    if (!st.playing && !g.done && g.pauseAt === undefined) g.pauseAt = now;
    const unseen = g.hazards.filter((h) => !h.resolved && h.lit === null);
    const bits = unseen.reduce((b, h) => b | (1 << (h.id - 1)), 0);
    if (unseen.length && !g.done && V.gameMask.some((v) => v & bits)) {
      const rgba = V.gl.readCanvas(), rect = V.canvas.getBoundingClientRect(), exclude = [];
      V.gameBackgrounds = {};
      for (const el of [V.gameBar, V.perfLab, V.fpsLab, V.ui.driveExtras, ...info().toolbar.querySelectorAll('button,select')]) if (el && !el.hidden && el.getClientRects().length) {
        const r = el.getBoundingClientRect(); exclude.push([(r.left - rect.left) / rect.width * V.gl.cw, (r.top - rect.top) / rect.height * V.gl.ch, (r.right - rect.left) / rect.width * V.gl.cw, (r.bottom - rect.top) / rect.height * V.gl.ch]);
      }
      for (const h of unseen) {
        const legacy = g.rules === 'legacy', background = legacy ? null : gameBackground(h.id);
        V.gameBackgrounds[h.id] = background;
        const pixel = RF.DriveGame.firstLit({ rgba, background, legacy, cssW: rect.width, cssH: rect.height, exclude, mask: legacy ? V.gameMask : V.gameBodyMask, id: h.id, w: V.gl.cw, h: V.gl.ch, mw: V.p.w, mh: V.p.h, flip: info().mirrored });
        if (pixel) { h.lit = performance.now(); h.litAt = g.t; h.firstRange = RF.DriveGame.pose(g, h, g.t).s - g.x; h.firstPixel = pixel; g.seen++; }
      }
    }
    g.flashes = V.flash.n; gameText(g);
  }
  function gameText(g) {
    if (!V.gameStatus) return;
    const hits = g.results.filter((r) => r.hit).length, passes = g.results.length - hits, mean = g.reactions.length ? (g.reactions.reduce((a, b) => a + b, 0) / g.reactions.length).toFixed(2) + ' s' : 'not measured';
    const ticket = RF.DriveGame.score({ verdict: g.verdict, flashes: g.flashes }).tickets, last = g.results[g.results.length - 1];
    V.gameStatus.textContent = (g.done ? 'Run ended' : g.resume !== null ? g.clearLane && g.rules !== 'legacy' ? 'Waiting for clear lane · release Brake to resume' : 'Release Brake · cruise resumes after 2 s' : g.brake ? 'BRAKING' : 'Hold Space or Brake') + ' · ' + (g.v * 3.6).toFixed(1) + ' km/h · ' + g.results.length + '/5 resolved';
    V.gameCard.hidden = !g.done;
    if (g.done) {
      V.gameBar.classList.remove('running');
      if (info().o.largeCard !== false && !S(V.ui).popout && V.largeCardRun !== g) { V.largeCardRun = g; requestAnimationFrame(() => { if (S(V.ui).game === g && g.done && S(V.ui).gameMode) { V.cardPop = true; openPop(V.ui); } }); }
      V.gameBar.querySelector('[data-game="brake"]').hidden = true; V.gameBar.querySelector('[data-game="pause"]').hidden = true;
      for (const e of V.gameBar.querySelectorAll('input,select')) e.disabled = false;
      const repair = g.results.reduce((sum, r) => sum + r.repair, 0);
      V.gameCard.textContent = 'GAME SCORECARD — ' + (g.reason || (g.results.some((r) => r.conscience) ? 'Person hit: run lost · conscience cost 100' : last && last.lost ? last.tier : 'Run complete')) + '\nHazards seen: ' + g.seen + ' / ' + g.spawned + ' · mean reaction: ' + mean + ' (' + g.reactions.length + ' measured presses)\nHits: ' + hits + ' · passes: ' + passes + ' · flashed ' + g.flashes + ' cops: $' + ticket + '\nLamp Spec verdict: ' + g.verdict.toUpperCase() + (g.verdict === 'unsure' || g.verdict === 'empty' ? ' (compliance not established)' : '') + ' · repair bands total: $' + repair + '\n' + g.results.map((r) => '#' + r.id + ' ' + r.kind + ': ' + (r.hit ? r.speed.toFixed(1) + ' km/h impact · ' + r.damage + ' $' + r.repair + ' · liability ' + r.liability.toFixed(1) + ' (' + Math.round(r.mitigation * 100) + '% mitigation) · ' + r.tier : 'pass')).join('\n') + '\nAbsolute reach beats foreground width. Earlier light buys braking distance.\nGame flavour, not legal advice. 1500 kg energy proxy; costs and liability are invented game bands.';
      const restart = V.gameBar.querySelector('[data-game="start"]'); restart.hidden = false; restart.textContent = 'Run again'; V.gameBar.querySelector('[data-game="exit"]').hidden = false;
    }
  }
  function gameControls(ui) {
    const st = S(ui);
    if (!V.gameBar) {
      const box = V.gameBar = E('div', { class: 'drive-game', 'data-game': 'panel', hidden: '' });
      const speed = E('input', { 'data-game': 'speed', type: 'number', min: 5, max: 130, step: 5, 'aria-label': 'Game speed km/h' }), wet = E('select', { 'data-game': 'wet', 'aria-label': 'Game road condition' }), seed = E('input', { 'data-game': 'seed', type: 'number', min: 0, max: 99999, step: 1, 'aria-label': 'Game seed' });
      wet.append(E('option', { value: 'dry' }, 'dry'), E('option', { value: 'wet' }, 'wet'));
      const rules = E('select', { 'data-game': 'rules', 'aria-label': 'Hazard rules' });
      rules.append(E('option', { value: 'visible' }, 'Visible hazard'), E('option', { value: 'legacy' }, 'Original rules'));
      const clearLane = E('input', { 'data-game': 'clear-lane', type: 'checkbox', checked: '' });
      const pause = E('button', { type: 'button', 'data-game': 'pause' }, 'Pause');
      pause.addEventListener('click', () => { st.playing = !st.playing; ui.redrawSpec(); });
      const start = E('button', { type: 'button', 'data-game': 'start' }, 'Start run'), brake = E('button', { type: 'button', 'data-game': 'brake', 'aria-label': 'Hold to brake', 'aria-pressed': 'false' }, 'Hold: BRAKE');
      start.addEventListener('click', () => startGame(ui));
      // The lobby and scorecard also carry their own exit control.
      const exit = E('button', { type: 'button', 'data-game': 'exit' }, 'Exit game'); exit.addEventListener('click', () => toggleGame(ui));
      const active = () => st.game && !st.game.done && st.playing && visible();
      const hold = (held, source) => { if (!st.game) return; const now = performance.now();
        // Integrate the interval BEFORE this input with the previous brake state; never brake retroactively over a slow frame.
        if (active() && V.last) { advanceCamera(st, Math.max(0, (now - V.last) / 1000)); V.last = now; }
        const inputs = st.game.inputs || (st.game.inputs = new Set()); source = source || 'pointer'; if (!active() || source === 'all') inputs.clear(); else if (held) inputs.add(source); else inputs.delete(source); RF.DriveGame.press(st.game, inputs.size > 0, now); brake.setAttribute('aria-pressed', String(st.game.brake)); gameText(st.game); };
      brake.addEventListener('pointerdown', (e) => { e.preventDefault(); brake.setPointerCapture(e.pointerId); hold(true); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) brake.addEventListener(event, () => hold(false));
      // Non-passive touch listeners suppress iOS selection/callout without losing hold-to-brake.
      brake.addEventListener('touchstart', (e) => { e.preventDefault(); hold(true, 'touch'); }, { passive: false });
      for (const event of ['touchend', 'touchcancel']) brake.addEventListener(event, (e) => { e.preventDefault(); hold(false, 'touch'); }, { passive: false });
      box.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('keydown', (e) => { if (e.code === 'Space' && active() && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); if (!e.repeat) hold(true, 'keyboard'); } });
      document.addEventListener('keyup', (e) => { if (e.code === 'Space' && st.game) { e.preventDefault(); hold(false, 'keyboard'); } });
      const suspend = () => { if (st.game && !st.game.done) { hold(false, 'all'); if (st.game.pauseAt === undefined) st.game.pauseAt = performance.now(); st.playing = false; stop(); ui.redrawSpec(); } };
      root.addEventListener('blur', suspend); document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
      V.gameStatus = E('div', { 'data-game': 'status', role: 'status' }); V.gameCard = E('div', { 'data-game': 'card', class: 'game-card', hidden: '' });
      box.append(E('strong', {}, 'REACH > UNIFORMITY · game'), E('div', { class: 'game-setup' }, E('label', {}, 'km/h ', speed), wet, E('label', {}, 'seed ', seed), rules, E('label', {}, clearLane, ' Wait for clear lane'), start, exit, pause, brake), V.gameStatus, V.gameCard, E('small', {}, 'Five hazards. Hold to brake; release coasts. After a stop, hazards leave the road before cruise resumes (at least 2 s). Uncheck Wait for clear lane or choose Original rules for the previous resume. Game flavour, not legal advice.'));
      V.cv.parentElement.append(box); speed.value = info().o.speed; seed.value = info().o.seed; wet.value = info().o.wet ? 'wet' : 'dry';
    }
    if (V.notice) V.notice.hidden = !V.why || (st.gameMode && !V.lost);
    V.gameBar.hidden = !st.gameMode; V.gameBar.classList.toggle('running', !!st.game && !st.game.done); mount(ui);
    if (st.gameMode) V.bar.hidden = true;
    const toggle = info().toolbar.querySelector('[data-game="toggle"]'); if (toggle) { toggle.setAttribute('aria-pressed', String(!!st.gameMode)); toggle.textContent = st.gameMode ? 'Exit game' : 'Game'; }
    // Freeze run inputs and the underlying toolbar; exit restores the owner's preferences in memory.
    for (const bar of [V.bar, ui.driveBar, ui.driveExtras]) if (bar) for (const e of bar.querySelectorAll('button,input,select')) {
      if (e.matches('[data-game="toggle"],[data-anim="popout"],[data-anim="play"]')) continue;
      if (st.gameMode) { if (e.dataset.gameWasDisabled === undefined) e.dataset.gameWasDisabled = String(e.disabled); e.disabled = true; }
      else if (e.dataset.gameWasDisabled !== undefined) { e.disabled = e.dataset.gameWasDisabled === 'true'; delete e.dataset.gameWasDisabled; }
    }
    for (const e of V.gameBar.querySelectorAll('input,select')) e.disabled = !!st.game && !st.game.done;
    V.gameBar.querySelector('[data-game="brake"]').hidden = !st.game || st.game.done;
    V.gameBar.querySelector('[data-game="pause"]').hidden = !st.game || st.game.done;
    V.gameBar.querySelector('[data-game="pause"]').textContent = st.playing ? 'Pause' : 'Resume';
    V.gameBar.querySelector('[data-game="start"]').hidden = !!st.game && !st.game.done;
    V.gameBar.querySelector('[data-game="exit"]').hidden = !!st.game && !st.game.done;
    if (st.game) {
      if (!st.playing && !st.game.done && st.game.pauseAt === undefined) { st.game.pauseAt = performance.now(); if (st.game.inputs) st.game.inputs.clear(); RF.DriveGame.press(st.game, false, performance.now()); }
      if (st.game.ctx !== (ui.run && ui.run.ctx) || st.game.judge !== (ui.spec && ui.spec.ev) || st.game.road !== info().rd) { st.game.done = true; st.game.reason = 'Lamp changed; start a new run'; st.playing = false; }
      gameText(st.game);
    } else { V.gameStatus.textContent = 'Choose speed, surface and seed before the run. Earlier light buys braking distance.'; V.gameCard.hidden = true; }
  }

  // ---------------------------------------------------------------- popout
  function openPop(ui) {
    const st = S(ui); if (st.popout) return;
    const pop = E('div', { class: 'drive-popout', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Drive view, large' }), head = E('div', { class: 'dp-head' }, E('strong', {}, 'Drive view')), stage = E('div', { class: 'dp-stage' });
    const close = E('button', { type: 'button', class: 'dp-close', title: 'Close (Esc)' }, '✕ Close'); close.addEventListener('click', () => closePop(ui)); head.append(E('span', { class: 'dp-hint' }, 'Esc closes'), close);
    V.popScroll = { x: root.scrollX, y: root.scrollY, focus: document.activeElement, style: document.body.getAttribute('style') };
    pop.append(head, stage); document.body.append(pop); V.pop = pop; V.popStage = stage;
    Object.assign(document.body.style, { position: 'fixed', top: -V.popScroll.y + 'px', left: -V.popScroll.x + 'px', width: '100%', overflow: 'hidden' });
    st.popout = true; if (st.view !== 'anim') st.playing = false;          // opened from the still view: the same picture, large, paused
    V.onKey = (e) => {
      if (e.key === 'Escape' && S(ui).popout) { e.preventDefault(); e.stopPropagation(); closePop(ui); }
      if (e.key === 'Tab' && S(ui).popout) {
        const items = [...pop.querySelectorAll('button,input,select,summary,[tabindex]')].filter(b => !b.disabled && b.checkVisibility() && b.tabIndex >= 0), i = items.indexOf(document.activeElement);
        if (e.shiftKey ? i <= 0 : i < 0 || i === items.length - 1) { e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus(); }
      }
    };
    document.addEventListener('keydown', V.onKey, true);
    if (root.ResizeObserver) { V.ro = new ResizeObserver(() => { if (S(ui).popout) { ui.redrawSpec(); } }); V.ro.observe(stage); }
    mount(ui); close.focus(); ui.redrawSpec();
  }
  function closePop(ui) {
    const st = S(ui); if (!st.popout) return; st.popout = false; V.cardPop = false;
    document.removeEventListener('keydown', V.onKey, true); if (V.ro) { V.ro.disconnect(); V.ro = null; }
    const pop = V.pop, saved = V.popScroll; V.pop = null; V.popStage = null;
    if (st.view !== 'anim') st.playing = true;
    mount(ui); if (pop) pop.remove();
    if (saved) { if (saved.style === null) document.body.removeAttribute('style'); else document.body.setAttribute('style', saved.style); }
    ui.redrawSpec();
    const b = saved && saved.focus && saved.focus.isConnected && saved.focus !== document.body ? saved.focus : document.querySelector('[data-anim="popout"]'); if (b) b.focus({ preventScroll: true });
    if (saved) root.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' }); V.popScroll = null;
  }
  // More and debug are ordinary page content on phones; desktop keeps the overlay.
  const mobileControls = () => root.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  function layoutControls(ui, scroll) {
    const st = S(ui), host = st.popout && V.popStage ? V.popStage : V.cv && V.cv.parentElement;
    if (!host || !ui.driveExtras) return;
    const mobile = mobileControls(), more = ui.driveBar.querySelector('.drive-more');
    if (!V.below) V.below = E('div', { class: 'drive-below' });
    if (host.nextElementSibling !== V.below) host.after(V.below);
    V.below.hidden = !st.popout && ui.display !== 'drive';
    const extrasHost = mobile ? V.below : more;
    if (ui.driveExtras.parentElement !== extrasHost) extrasHost.append(ui.driveExtras);
    ui.driveExtras.hidden = !more.open;
    if (V.perfLab && V.perfLab.parentElement !== (mobile ? V.below : host)) (mobile ? V.below : host).append(V.perfLab);
    if (V.gameBar && V.gameBar.parentElement !== V.below) V.below.prepend(V.gameBar);
    if (V.fpsLab && V.fpsLab.parentElement !== host) host.append(V.fpsLab);
    const h = ui.driveBar.getBoundingClientRect().height;
    host.style.setProperty('--drive-toolbar-bottom', (h + 8) + 'px');
    host.style.setProperty('--drive-extra-height', Math.max(40, host.clientHeight - h - 16) + 'px');
    if (mobile && scroll && more.open) requestAnimationFrame(() => ui.driveExtras.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  function mount(ui) {
    const st = S(ui), host = st.popout && V.popStage ? V.popStage : (V.cv ? V.cv.parentElement : null); if (!host) return;
    host.classList.toggle('drive-fit', info().o.fitControls !== false);
    for (const e of [V.canvas, ui.driveBar, V.notice, document.querySelector('[data-reset=heat]')]) if (e && e.parentElement !== host) host.append(e);
    const primary = ui.driveBar.querySelector('.drive-primary');
    for (const selector of ['[data-dv=scene]', '.drive-speed', '[data-anim=play]', '[data-game=toggle]', '[data-dv=glare]', '.drive-more']) {
      const e = primary.querySelector(selector); if (e && primary.lastElementChild !== e) primary.append(e);
    }
    if (!V.controlsRO && root.ResizeObserver) {
      V.controlsRO = new ResizeObserver(() => layoutControls(ui)); V.controlsRO.observe(ui.driveBar);
      const query = root.matchMedia('(max-width: 760px), (pointer: coarse)'); query.addEventListener('change', () => { layoutControls(ui); ui.redrawSpec(); });
    }
    layoutControls(ui);
  }

  // The optional ES module is loaded only on HTTP; the classic CPU app still opens from file://.
  let threeModule, threeLoading;
  function gpuFallback(why) {
    if (V.three) { V.three.dispose(); V.three = null; }
    V.gkey = ''; V.gpuFailure = String(why); say('GPU drive unavailable (' + V.gpuFailure.split('\n')[0].slice(0, 160) + '); using CPU renderer.');
  }
  function gpuRenderer() {
    if (!info().o.gpuRenderer) { if (V.three) { V.three.dispose(); V.three = null; V.gkey = ''; } if (V.gpuFailure) { V.gpuFailure = ''; say(''); } return; }
    if (V.three || V.gpuFailure) return;
    if (root.location && root.location.protocol === 'file:') { gpuFallback('ES modules need HTTP'); return; }
    if (threeModule) { try { V.three = threeModule.create(V.canvas, V.gl.gl); V.gkey = ''; killWorkers(); } catch (e) { gpuFallback(e.message || e); } return; }
    if (!threeLoading) threeLoading = import('./drive-three.js').then(m => { threeModule = m; threeLoading = null; if (V.ui) V.ui.redrawSpec(); }).catch(e => { threeLoading = null; if (V.info && info().o.gpuRenderer) gpuFallback(e.message || e); });
  }

  // ---------------------------------------------------------------- hook from drawDrive
  /* I: { rd, o (dvOpts), A (arc|null), mirrored, us, conv, lut () → the beam lookup, tm (the still picture's tone map), groundKey, setDV, toolbar } */
  function sync(ui, cv, I) {
    V.ui = ui; V.cv = cv; V.info = I; const st = S(ui);
    if (st.game) Object.assign(I.o, st.gameOptions);
    if (st.popout && !popValid(ui)) closePop(ui);
    topButtons(ui, I.toolbar, I.setDV); bars(ui, I.setDV);
    if (!V.bar.parentElement) ui.driveExtras.append(V.bar);
    if (!st.popout) mount(ui);
    if (!supported(I.o)) { if (st.popout) closePop(ui); st.view = 'still'; }
    labels(ui); gameControls(ui);
    const want = supported(I.o) && (st.view === 'anim' || st.popout);
    if (!want) { stop(); killWorkers(); if (V.canvas) V.canvas.hidden = true; return; }
    if (V.lost && !V.glFailed) { stop(); return; }
    if (!ensureCanvas()) { st.view = 'still'; if (V.canvas) V.canvas.hidden = true; if (st.popout) closePop(ui); labels(ui); return; }
    V.canvas.hidden = false; mount(ui);
    if (!visible()) { stop(); return; }
    try {
      gpuRenderer();
      const sz = layout();
      if (I.o.expMode === 'auto' && I.tm) { const ak = I.groundKey + '|' + I.o.ev; if (!V.kAuto || V.autoKey !== ak) { V.kAuto = I.tm.k; V.autoKey = ak; } } else V.kAuto = null;      // auto exposure would flicker as the scene moves: frozen at the still picture's
      prepare(sz);
      if (st.playing && mt()) workerCfg();      // playing on the workers: the loop draws the next frame
      else frame();
      if (st.playing) go(); else stop();
    } catch (e) {
      if (!recovery()) throw e;
      if (V.gl.gl.isContextLost()) contextLost({ preventDefault() {} });
      else contextFallback('Drive graphics failed: ' + (e.message || e));
    }
  }
  // a hidden tab stops the loop; showing it again redraws (which restarts it)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (V.ui) { if (document.visibilityState === 'hidden') stop(); else if (V.info) { if (S(V.ui).popout && !popValid(V.ui)) closePop(V.ui); else V.ui.redrawSpec(); } } });

  // ---------------------------------------------------------------- numbers for tests and the report
  const pct = (a, q) => { if (!a || !a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
  function stats() {
    const t = V.times, iv = []; for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]); iv.sort((a, b) => a - b);
    const med = iv.length ? iv[iv.length >> 1] : 0, c = V.cpu;
    const all = V.profiles || [], recent = all.filter((r) => r.at >= (all.length ? all[all.length - 1].at : 0) - 1000);
    return { renderer: V.three ? 'three' : 'cpu', gpuFailure: V.gpuFailure || '', profiling: profileOn(), renderScale: V.renderScale || 1, resolution: V.resolution || resolutionState(), frameTargetMs: V.info && V.info.o.frameTargetMs || 33, breakdown: breakdown(recent), breakdownMean: breakdown(all), lastFrame: all.length ? all[all.length - 1] : null, white: V.white, frames: V.frames, running: !!V.raf, rafMedianMs: med, fps: med ? 1000 / med : 0, p95Ms: iv.length ? iv[Math.floor(iv.length * 0.95)] : 0, cpuObjMs: c.n ? c.obj / c.n : 0, cpuUploadMs: c.n ? c.up / c.n : 0, cpuGlMs: c.n ? c.gl / c.n : 0, sim: V.p && [V.p.w, V.p.h], canvasPx: V.gl && [V.gl.cw, V.gl.ch], groundMs: V.g && V.g.ms, objP95Ms: pct(V.ring, 0.95), objMaxMs: pct(V.ring, 1), workers: Wk.list.length, mtFail: Wk.failed, workerRestarts: Wk.restarts, contextLost: !!V.lost, contextFailed: !!V.glFailed, ss: V.pinSS || (V.p && V.p.w > 1100 ? 1 : (V.ss || 2)) };
  }
  function breakdown(samples) {
    const rows = samples || [], n = rows.length, mean = (key) => n ? rows.reduce((s, r) => s + (r[key] || 0), 0) / n : 0, frameMs = mean('frameMs'), components = {};
    for (const key of ['objectMs', 'groundMs', 'wetMs', 'workerOtherMs', 'pacingMs', 'dispatchMs', 'trafficMs', 'placementMs', 'assemblyMs', 'uploadMs', 'sourcesMs', 'composeMs', 'glareMs', 'finalVeilMs', 'detectorMs', 'workerRoundTripMs']) {
      components[key] = { ms: mean(key), pct: frameMs ? mean(key) / frameMs * 100 : 0,
        basis: ['objectMs', 'groundMs', 'wetMs'].includes(key) ? 'sampled estimate' : 'measured elapsed', scope: key === 'workerOtherMs' ? 'summed worker CPU setup/packing (overlaps round-trip)' : key === 'dispatchMs' ? 'main CPU inside worker round-trip' : rows.some((r) => r.worker) && ['objectMs', 'groundMs', 'wetMs'].includes(key) ? 'trace CPU; worker sums overlap round-trip' : 'frame wall time' };
    }
    const other = n ? rows.reduce((sum, r) => {
      const accounted = ['trafficMs', 'placementMs', 'assemblyMs', 'uploadMs', 'sourcesMs', 'glMs', 'detectorMs', 'workerRoundTripMs', 'pacingMs'].reduce((s, k) => s + (r[k] || 0), 0) + (r.worker ? 0 : r.traceCpuMs || 0);
      return sum + Math.max(0, r.frameMs - accounted);
    }, 0) / n : 0;
    components.otherMs = { ms: other, pct: frameMs ? other / frameMs * 100 : 0, basis: 'measured residual', scope: 'frame wall time' };
    return { frames: n, frameMs, workMs: mean('workMs'), mainMs: mean('mainMs'), workerCpuMs: mean('workerCpuMs'), traceCpuMs: mean('traceCpuMs'), components,
      cache: { hits: rows.reduce((s, r) => s + (r.cacheHits || 0), 0), misses: rows.reduce((s, r) => s + (r.cacheMisses || 0), 0) }, sampledRays: rows.reduce((s, r) => s + (r.sampledRays || 0), 0), gpuMs: null,
      notes: 'GL stages time CPU submission, not GPU execution. Final pass includes veil and tone map. Trace components partition trace CPU; worker sums and main dispatch overlap round-trip. Wet measures lobe evaluation only. Static ground setup is groundMs at stats root.' };
  }
  function perfLabel() {
    if (V.fpsLab && V.info && V.info.o.fpsCounter) V.fpsLab.textContent = Math.round(stats().fps) + ' fps';
    if (!V.perfLab || !profileOn()) return;
    const s = stats(), b = s.breakdown, c = b.components, ms = (k) => c[k].ms.toFixed(1), scope = s.workers ? 'worker CPU sum' : 'CPU';
    V.perfLab.textContent = s.fps.toFixed(1) + ' fps · p95 ' + s.p95Ms.toFixed(1) + ' ms · scale ' + s.renderScale.toFixed(2) + ' · SS ' + s.ss + '\n' +
      'frame ' + b.frameMs.toFixed(1) + ' · main ' + b.mainMs.toFixed(1) + ' · worker RT ' + ms('workerRoundTripMs') + ' ms\n' +
      scope + ' ≈ object/rays ' + ms('objectMs') + ' · ground ' + ms('groundMs') + ' · wet ' + ms('wetMs') + ' · worker setup/pack ' + ms('workerOtherMs') + ' ms\n' +
      'cache ' + b.cache.hits + ' hit / ' + b.cache.misses + ' miss · upload ' + ms('uploadMs') + ' ms\n' +
      'GL submit: compose ' + ms('composeMs') + ' · glare ' + ms('glareMs') + ' · final/veil ' + ms('finalVeilMs') + ' ms\n' +
      'traffic ' + ms('trafficMs') + ' · placement ' + ms('placementMs') + ' · dispatch ' + ms('dispatchMs') + ' · detector ' + ms('detectorMs') + ' · pacing ' + ms('pacingMs') + ' · other ' + ms('otherMs') + ' ms';
  }
  function resetStats() { V.profiles = []; V.completedAt = 0; V.cameraMs = 0; V.times = []; V.ring = []; V.cpu = { obj: 0, up: 0, gl: 0, n: 0 }; }
  // render n frames back to back (no vsync), waiting for the GPU at the end: ms per frame
  function bench(n) {
    const ui = V.ui, st = S(ui), d0 = st.dist, t0s = st.t, flashes = V.flash, traffic = V.src.traffic.state; V.src.traffic.state = copyTraffic(traffic); V.flash = flashState(); resetStats(); const t0 = performance.now();
    for (let i = 0; i < n; i++) { st.dist += 0.5; st.t += 0.5 / ((+info().o.speed || 50) / 3.6); frame(); }
    V.gl.sync(); const ms = (performance.now() - t0) / n; st.dist = d0; st.t = t0s; V.flash = flashes; V.src.traffic.state = traffic; flashText(); return Object.assign({ n, msPerFrame: ms }, stats());
  }
  RF.DriveAnim = { layoutControls, resolutionState, resolutionStep, breakdown, TRAFFIC_BRAKE, TURN_SPEED, TURN_PROBABILITY, TURN_GAP, approachSpeed, approachAcceleration, signalStop, junctionPlan, turnPose, turnClear, cameraStep, IDM, idmAcceleration, idmStep, speedLimit, trafficSignal, advanceTraffic, TILE_LEN, TILE_KINDS, roadTile, tileRoute, signalState, tileWorld, tileFrame, TRAFFIC_SPEED, trafficCars, trafficObjects, eyeLux, flashState, countFlashes, placedObjects, PERIOD, EYE, ANIM_SCENES, CLASSES, source, place, dimFoliage, actorPose, ground, objects, composeCPU, makeGL, tracer, activate, sync, stats, resetStats, bench, benchMT, closePop, openPop,
    // test hooks
    _: { V, S, Wk, postJob, killWorkers, contextLost, contextRestored, toggleGame, gameFrame, gameBackground, gameObjects, advanceCamera, frame, frameMT, mt, size, prepare, exposure, frameSources, readHdr: () => V.gl.gl && V.gl.readHdr(), readCanvas: () => V.gl.readCanvas(), setDist: (d) => { S(V.ui).dist = d; frame(); } } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
