/* drive-anim.js — the animated Drive view: the car drives down the road, the scenery comes at it. Play advances the world; Pause freezes distance and time. drive.js remains the CPU reference and recovery renderer.
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
  const PERIOD = 300, EYE = [-2.0, 0.37, 1.2], MIN_SIM = 640, ANIM_SCENES = { road: 1, forest: 1, city: 1 }, ACT = 110, CULL = 230, TEX_WRAP = 76.8, TEX_AMP = 0.4;
  // Traffic-car window (m), owner option 'trafficRange'. CULL above is still the window for scenery, street lamps, crossings and actors.
  const TRAFFIC_RANGES = [230, 400, 600, 800], trafficCullOf = (v) => (TRAFFIC_RANGES.includes(+v) ? +v : 400);
  // TL2: road-light range (m) and nearest-car count. 'cars' = as far as cars spawn (the traffic range). Never beyond the traffic range.
  const LIGHT_RANGES = ['150', '250', '400', 'cars'], LIGHT_CARS = ['8', '16', '32'];
  const lightRangeOf = (o) => { const cull = trafficCullOf(o.trafficRange), v = String(o.trafficLightRange); return Math.min(v === 'cars' ? cull : LIGHT_RANGES.includes(v) ? +v : 150, cull); };
  const lightCarsOf = (o) => (LIGHT_CARS.includes(String(o.trafficNearest)) ? +o.trafficNearest : 8);
  // The camera eye: the fixed EYE, carried on the frame (drive.js eyeFor). Every consumer goes through here.
  const eyeOf = (p) => (p && p.eye) || EYE;
  const CLASSES = [['posts', 'posts', 'Delineator posts with reflectors'], ['signs', 'signs', 'Road signs (retroreflective sheeting)'], ['people', 'people', 'Pedestrians'], ['animals', 'deer', 'Deer, with retroreflecting eyes'], ['veg', 'trees', 'Trees and bushes at the roadside'], ['obstacle', 'crates', 'A dark crate on the road every 150 m (the hard target: 3 % reflectance, nothing retroreflective)'], ['rpm', 'studs', 'Raised reflective pavement markers on the centre and edge lines (random scenery only)'], ['tex', 'grain', 'Asphalt grain: a subtle texture on the road surface that moves with the drive'], ['mt', 'threads', 'Trace the objects on several CPU threads (Web Workers), so big scenes keep up. Off: this thread only. Needs the page served over http(s) (browsers block workers on file://)'], ['wild', 'random', 'Random scenery from a seed: denser, different every 300 m, walkers and deer that move. Off: the original fixed scenery, repeating every 300 m']];

  // ---------------------------------------------------------------- CPU: scenery, ground, composition (pure; tests use these)
  // the scenery on a straight road, in (s, off) coordinates
  // opts (the view's settings; none = the original scenery, as the tests build it): { wild: random scenery from `seed` (chunks of PERIOD m, `density`), cline: 'broken' = a US passing-zone centre line }
  function source(name, lane, us, flags, opts) {
    if (opts && opts.mountainPass) { opts = Object.assign({}, opts, { tiles: true, wild: false }); name = 'road'; }
    if (opts && opts.tiles) opts = Object.assign({}, opts, { flags: flags || {}, us });
    if (opts && opts.leafyFoliage && !opts.mountainPass && (name === 'road' || name === 'forest')) flags = { ...flags, leafyFoliage: true };
    const broken = !!(opts && us && opts.cline === 'broken');
    if (!(opts && opts.wild) || name !== 'road') {
      const sc = D.buildScene(name, { Lw: lane, A: null, us, seed: 7, reflectiveClothing: opts && opts.reflectiveClothing, foliageSeed: opts && opts.seed, density: opts && opts.density, kerbPeople: !!(opts && opts.tiles), broken, scenery: opts && opts.scenery }, flags), src = { objects: sc.objects, markings: sc.markings.map((m) => m.pat && m.pat.period >= 1e5 ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { period: PERIOD }) }) : m), verge: sc.verge, cross: sc.cross, lane, pedMode: opts && opts.reflectiveClothing };      // a crossing or stop line that is there once on the still road comes round every lap, like the buildings
      if (broken && name === 'road') src.markings = D.laneMarkings(lane, { us, broken });
      return trafficSource(src, opts);
    }
    const mix = (k) => (Math.imul((+opts.seed || 0) | 0, 2654435761) ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0, chunks = new Map();
    const src = { wild: true, lane, markings: D.laneMarkings(lane, { us, broken }), verge: ['gravel', 1.6, 'grass'], chunk(k) {
      let c = chunks.get(k); if (!c) { c = D.wildChunk({ Lw: lane, us, seed: mix(k), density: opts.density === undefined ? 1.5 : +opts.density, broken, reflectiveClothing: opts.reflectiveClothing }, flags); chunks.set(k, c); if (chunks.size > 8) chunks.delete(chunks.keys().next().value); } return c;
    }, pedMode: opts.reflectiveClothing };
    src.objects = src.chunk(0).objects; return trafficSource(src, opts);
  }
  // Traffic has its own stream of the scenery RNG: switching a class off never moves another class. Constant speeds (m/s) keep spacing steady.
  const TRAFFIC_SPEED = { oncoming: 50 / 3.6, preceding: 40 / 3.6 };
  function trafficSource(src, opts) {
    const o = opts || {}, dn = o.trafficDensity === undefined ? 1 : Math.max(0, Math.min(3, +o.trafficDensity || 0));
    src.traffic = { seed: (+o.seed || 0) | 0, density: dn, oncoming: !!o.oncoming, preceding: !!o.preceding, models: {} };
    src.traffic.cull = trafficCullOf(o.trafficRange);
    src.traffic.onMode = o.onMode || (o.onKcd === undefined ? 'symmetric' : 'manual'); src.traffic.onKcd = o.onKcd === undefined ? 30 : +o.onKcd;
    src.traffic.logic = !!o.trafficLogic; src.traffic.pedStop = o.pedStop !== false; src.traffic.safeGap = o.safeGap !== false; src.traffic.speed = o.speed === undefined ? 50 : +o.speed;
    if (o.tiles) src.markings = D.laneMarkings(src.lane, { us: o.us, broken: o.us && o.cline === 'broken' });
    if (o.tiles) src.tiles = { pedMode: o.reflectiveClothing, mountain: !!o.mountainPass, density: o.density, seed: (+o.seed || 0) | 0, flags: o.flags || {}, lamps: o.streetLamps || 'sodium', lampRule: o.lampRule, broken: !!(o.us && o.cline === 'broken'), grain: o.tex !== false, wet: D.wetnessOf(o) > 0, groundCache: o.tileCache ? {} : null };
    for (const kind of ['oncoming', 'preceding']) if (src.traffic[kind]) {
      const K = D.kit({ Lw: src.lane, A: null, rand: () => 0.5 });
      K.car(0, 0, kind === 'oncoming' ? { face: -1, lamps: 'head', kcd: +o.onKcd || 30 } : { face: 1, lamps: 'tail' }); src.traffic.models[kind] = K.O;
    }
    return src;
  }
  // One car in each seeded interval of road, then translated by its own travel and ours. Look up only the intervals in view: bounded work even after hours.
  function trafficCars(src, dist, t) {
    const tr = src.traffic, out = []; if (!tr || !tr.density) return out;
    if (tr.logic || src.tiles && src.tiles.mountain) return logicCars(src, dist, t);
    const gap = PERIOD / tr.density, cull = tr.cull || CULL;
    for (const kind of ['oncoming', 'preceding']) if (tr[kind]) {
      const shift = dist + (kind === 'oncoming' ? 1 : -1) * TRAFFIC_SPEED[kind] * t;
      for (let k = Math.floor((shift - 6) / gap); k <= Math.floor((shift + cull) / gap); k++) {
        const R = D.rng((Math.imul(tr.seed, 2654435761) ^ Math.imul(k, 0x9E3779B1) ^ (kind === 'oncoming' ? 0x51ED270B : 0x165667B1)) >>> 0);
        const rel = (k + 0.2 + 0.6 * R()) * gap - shift;
        const min = kind === 'preceding' && tr.safeGap ? Math.max(25, 2 * tr.speed / 3.6) : -6;
        if (rel >= min && rel <= cull) out.push({ id: kind + ':' + k, kind, rel, off: kind === 'oncoming' ? src.lane : 0 });
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
    if (src.tiles && src.tiles.mountain) return Math.min(80 / 3.6, curveSpeed(curvatureAt(src, x)));
    if (!src.tiles) return 80 / 3.6;
    const tile = roadTile(src.tiles.seed, Math.floor(x / TILE_LEN));
    return (isJunction(tile) || tile.kind === 'urban' ? 50 : tile.curvature ? 60 : 80) / 3.6;
  }
  // Both directions are through traffic on the same road, so their heads share the main-road green (not the cross-road phase).
  function trafficSignal(src, car, t) {
    if (!src.tiles || src.tiles.mountain) return null;
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
        if ((!initial && x < dist + (tr.cull || CULL) + 100) || x < dist - 100) continue;
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
  // Same sections as the drawn route, in horizontal station metres. Shared with Touge.curvature.
  function curveSections(tile) {
    return tile.curvature ? [[tile.s0, 50, 0], [tile.s0 + 50, 100, tile.curvature], [tile.s0 + 150, 50, 0]] : [[tile.s0, TILE_LEN, 0]];
  }
  function curveSpeed(c) { return Math.abs(c) > 1e-6 ? Math.sqrt(3 / Math.abs(c)) : Infinity; }
  function curvatureAt(src, x, off = 0) {
    if (!src) return 0;
    if (!src.tiles) {
      // Tiles off: the drive-bar shape arc (V.info.A, a constant bend) is the only road curvature. No shape = straight = 0.
      const A = V.info && V.info.A; if (!A || !A.R) return 0;
      const c = (A.dir === 'left' ? 1 : -1) / A.R;
      return c / (1 - off * c);
    }
    const tile = (src.tiles.mountain ? RF.Touge.tile : roadTile)(src.tiles.seed, Math.floor(x / TILE_LEN));
    const c = curveSections(tile).find(q => x >= q[0] && x < q[0] + q[1])[2];
    return c / (1 - off * c);
  }
  // An offset lane has ds_lane = (1 - off * curvature) ds_center. Keep v in actual lane m/s.
  function laneDistance(src, x, end, off) {
    let length = 0;
    for (let k = Math.floor(Math.min(x,end)/TILE_LEN); k <= Math.floor(Math.max(x,end)/TILE_LEN); k++)
      for (const [s,len,c] of curveSections(RF.Touge.tile(src.tiles.seed,k)))
        length += Math.max(0,Math.min(Math.max(x,end),s+len)-Math.max(Math.min(x,end),s)) * (1-off*c);
    return length;
  }
  function laneAdvance(src, x, travel, off) {
    const dir = Math.sign(travel); let left = Math.abs(travel);
    while (left > 1e-9) {
      // Sample just inside the section in our travel direction to resolve exact joins.
      const probe = x + dir * 1e-7, tile = RF.Touge.tile(src.tiles.seed,Math.floor(probe/TILE_LEN));
      const q = curveSections(tile).find(q => probe >= q[0] && probe < q[0]+q[1]);
      const edge = dir > 0 ? q[0]+q[1] : q[0], scale = 1-off*q[2], distance = Math.abs(edge-x)*scale;
      if (left <= distance) return x + dir*left/scale;
      x = edge; left -= distance;
    }
    return x;
  }
  // Exact section edges, with 2 m of settling space before discontinuous curvature starts.
  // Braking envelope v² = v_bend² + 2 b distance; no metre-grid sampling can miss a short bend.
  function curveEnvelope(src, car) {
    const dir = car.kind === 'oncoming' ? -1 : 1, off = dir < 0 ? src.lane : 0;
    let cap = 80 / 3.6, acceleration = IDM.a;
    const k0 = Math.floor(car.x / TILE_LEN);
    for (let i = -1; i <= 4; i++) {
      const tile = RF.Touge.tile(src.tiles.seed, k0 + dir * i);
      for (const [s, len, c] of curveSections(tile)) {
        if (!c || dir * ((dir > 0 ? s + len : s) - car.x) < 0) continue;
        const v = curveSpeed(c / (1 - off * c));
        const edge = dir > 0 ? s : s + len;
        const gap = dir * (edge-car.x) > 0 ? Math.max(0,laneDistance(src,car.x,edge,off)-2) : 0;
        cap = Math.min(cap, Math.sqrt(v * v + 2 * IDM.b * gap));
        // Bound the next 50 ms step against the moving braking envelope. Far bends allow acceleration;
        // braking from the moment a bend enters the horizon would keep the whole pass at crawl speed.
        const travel = car.v * IDM.dt + .5 * IDM.a * IDM.dt * IDM.dt;
        const nextCap = Math.sqrt(v * v + 2 * IDM.b * Math.max(0, gap - travel));
        acceleration = Math.min(acceleration, (nextCap - car.v) / IDM.dt);
      }
    }
    return { cap, acceleration };
  }
  function approachSpeed(src, car) {
    if (src.tiles && src.tiles.mountain) return curveEnvelope(src, car).cap;
    const dir = car.kind === 'oncoming' ? -1 : 1, k0 = Math.floor(car.x / TILE_LEN);
    let v = speedLimit(src, car.x);
    if (src.tiles) for (let i = 1; i <= 3; i++) {
      const k = k0 + dir * i, edge = dir > 0 ? k * TILE_LEN : (k + 1) * TILE_LEN, limit = speedLimit(src, k * TILE_LEN + 1);
      v = Math.min(v, Math.sqrt(limit * limit + 2 * IDM.b * Math.max(0, dir * (edge - car.x))));
    }
    return v;
  }
  function approachAcceleration(src, car, route) {
    if (src.tiles && src.tiles.mountain) return curveEnvelope(src, car).acceleration;
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
    if (!src.tiles || src.tiles.mountain || car.kind !== 'preceding') return null;
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
        let desired = Math.min(approachSpeed(src, c), src.traffic.logic || !(src.tiles && src.tiles.mountain) ? Infinity : TRAFFIC_SPEED[c.kind]), stop = stopFor(src, c, t);
        if (turning) {
          desired = Math.min(desired, Math.sqrt(TURN_SPEED * TURN_SPEED + 2 * IDM.b * Math.max(0, route.start - c.x)));
          const distance = Math.max(0, route.start - c.x), eta = 2 * distance / Math.max(1, c.v + TURN_SPEED);
          // Reserve only after this car has cleared its signal: a red wait must not consume the accepted gap.
          if (!route.enter && distance < 8 && turnClear(src, state.cars, route, c.id, eta, t)) route.enter = true;
          if (!route.enter) stop = Math.min(stop === undefined ? Infinity : stop, route.start + IDM.length / 2 + IDM.s0);
        }
        const n = idmStep(Object.assign({}, c, { x: dir * c.x }), leader, IDM.dt, desired, stop, { maxBrake: TRAFFIC_BRAKE, maxAccel: approachAcceleration(src, c, route) });
        n.x *= dir;
        if (src.tiles && src.tiles.mountain && dir < 0) n.x = laneAdvance(src,c.x,n.x-c.x,src.lane);
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
    if (!src.traffic.logic && !(src.tiles && src.tiles.mountain)) return Object.assign({}, camera, { x: camera.x + desired * dt, v: desired });
    trafficCars(src, camera.x, t);
    let leader = null;
    if (src.traffic.logic && src.traffic.preceding) for (const c of src.traffic.state ? src.traffic.state.cars : []) {
      if (c.kind !== 'preceding' || c.x <= camera.x || (c.turn && Math.abs(turnPose(c).off) >= 3.2)) continue;
      if (!leader || c.x < leader.x) leader = { x: c.x, v: c.turn ? c.v * Math.cos(turnPose(c).yaw) : c.v };
    }
    const c = Object.assign({}, camera, { id: 'camera', kind: 'preceding' }), stop = src.traffic.logic ? stopFor(src, c, t) : undefined;
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
      if (rel < -6 || rel > (tr.cull || CULL)) continue;
      cars.push({ id: c.id, kind: c.kind, rel, off: (c.kind === 'oncoming' ? src.lane : 0) + pose.off, yaw: pose.yaw, v: c.v, turning: !!c.turn });
    }
    return cars;
  }
  const copyTraffic = (s) => s && Object.assign({}, s, { cars: s.cars.map((c) => Object.assign({}, c, { route: c.route && Object.assign({}, c.route) }, c.turn ? { turn: Object.assign({}, c.turn) } : {})), seen: new Set(s.seen) });
  // Rotate the whole car around its centre (including emitter normals), so it stays rigid on a bend.
  // BT: the headlamp table per car. A car with a pick from the shuffle pool gets its own beam and colour; every other car gets the
  // one Headlamp.apply call the built-in path always made, so with no pool the output is unchanged.
  function applyTrafficHeadlamps(out, src, p) {
    const base = { mode: src.traffic.onMode, kcd: src.traffic.onKcd, lut: p.lowLut || p.lut, conv: p.conv, seed: src.traffic.seed };
    if (!p.trafficPool) { D.Headlamp.apply(out, base); return; }
    const plain = [], byPick = new Map();
    for (const ob of out) { if (!ob.headlamp) continue; const pk = D.trafficPickOf(p, ob.traffic); if (!pk) plain.push(ob); else { if (!byPick.has(pk)) byPick.set(pk, []); byPick.get(pk).push(ob); } }
    D.Headlamp.apply(plain, base);
    for (const [pk, obs] of byPick) { D.Headlamp.apply(obs, { ...base, lut: pk.lut, conv: pk.conv }); for (const ob of obs) ob.emit = ob.emit.map((v, i) => v * pk.tint[i]); }
  }
  function trafficObjects(src, cars, A, p) {
    const out = [];
    for (const car of cars) {
      const q = A ? A.at(car.rel, car.off) : { p: [car.rel, car.off], t: [1, 0] }, yaw = Math.atan2(q.t[1], q.t[0]) + (car.yaw || 0), c = car.yaw ? Math.cos(yaw) : q.t[0], sn = car.yaw ? Math.sin(yaw) : q.t[1];
      for (const ob of src.traffic.models[car.kind]) {
        const n = Object.assign({}, ob, { x: q.p[0] + ob.x * c - ob.y * sn, y: q.p[1] + ob.x * sn + ob.y * c, bs: undefined, traffic: car.id, modelId:car.id });
        if (ob.detail) n.detail = {...ob.detail,x:q.p[0]+ob.detail.x*c-ob.detail.y*sn,y:q.p[1]+ob.detail.x*sn+ob.detail.y*c,yaw:ob.detail.yaw+yaw,id:car.id};
        if (ob.k === 'box') n.yaw = (ob.yaw || 0) + yaw;
        if (ob.k === 'disc') { n.nx = ob.nx * c - ob.ny * sn; n.ny = ob.nx * sn + ob.ny * c; }
        out.push(n);
      }
    }
    if (p && src.traffic && src.traffic.onMode !== 'manual') applyTrafficHeadlamps(out, src, p);
    return out;
  }
  const placedObjects = (p, dist, t, tauOf) => D.Models.actors(place(p.src, dist, p.A, tauOf, p.detailedModels?null:dimFoliage(p), D.Models.deerEnabled(p)).concat(trafficObjects(p.src, trafficCars(p.src, dist, t), p.A, p)),p.detailedModels);
  // Same eye illuminance as Road.model.lux: far-field intensity / distance² × incidence cosine. Driver faces back along their lane, eye 1.1 m up.
  function eyeLux(p, car) {
    if (p.touge && p.A && p.A.touge) return RF.Touge.eyeLux(p, car);
    const q = p.A ? p.A.at(car.rel, car.off) : { p: [car.rel, car.off], t: [1, 0] }; let E = 0;
    for (const L of p.lamps) {
      const dx = q.p[0] - L[0], dy = q.p[1] - L[1], dz = 1.1 - L[2], r2 = dx * dx + dy * dy + dz * dz, cos = (dx * q.t[0] + dy * q.t[1]) / Math.sqrt(r2);
      if (!(cos > 0) || !(dx > 0)) continue;
      E += D.ownBeamAt(p, dx, dy, dz, L[1]) * cos / r2;
    }
    return E;
  }
  const flashState = () => ({ n: 0, seen: new Set() });
  function countFlashes(state, p, dist, t) {
    if (p.src.tiles) p = Object.assign({}, p, { A: p.src.tiles.mountain ? RF.Touge.route(dist,p.lane,!!p.touge) : tileRoute(p.src.tiles.seed, dist) });
    const cars = trafficCars(p.src, dist, t); state.cars = cars; state.p = p;      // scene details reads these (pointers only)
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
  // weights (SP3, optional): a multiplier per kind; a kind not named counts 1. Absent, or every weight 1, is the old pick floor(R x 8), byte for byte.
  // The kind takes one draw either way, so side and phase never move with the weights.
  function pickKind(R, weights) {
    if (!weights) return TILE_KINDS[Math.floor(R() * TILE_KINDS.length)];
    let total = 0; const cum = TILE_KINDS.map((kd) => (total += weights[kd] === undefined ? 1 : Math.max(0, +weights[kd] || 0)));
    if (!(total > 0)) return TILE_KINDS[Math.floor(R() * TILE_KINDS.length)];
    const u = R() * total, i = cum.findIndex((c) => u < c);
    return i < 0 ? TILE_KINDS[TILE_KINDS.length - 1] : TILE_KINDS[i];
  }
  function roadTile(seed, k, weights) {
    const R = D.rng((Math.imul(seed | 0, 2654435761) ^ Math.imul(k + 1, 0x85EBCA6B)) >>> 0), kind = pickKind(R, weights);
    return { k, s0: k * TILE_LEN, kind, curvature: /[RL]$/.test(kind) ? (kind.endsWith('L') ? 1 : -1) / parseInt(kind, 10) : 0, side: R() < 0.5 ? -1 : 1, phase: Math.floor(R() * 50) };
  }
  // Integrate only a local window, then put the camera at (0,0), facing its tangent. No accumulated drift or growing route history.
  function tileRoute(seed, dist, cached, recipe) {
    const parts = [], tiles = [], k0 = Math.floor(dist / TILE_LEN); let x = 0, y = 0, a = 0;
    const point = (q, u) => {
      const b = q.a + q.c * u;
      return q.c ? { p: [q.x + (Math.sin(b) - Math.sin(q.a)) / q.c, q.y + (Math.cos(q.a) - Math.cos(b)) / q.c], t: [Math.cos(b), Math.sin(b)] }
        : { p: [q.x + u * Math.cos(q.a), q.y + u * Math.sin(q.a)], t: [Math.cos(q.a), Math.sin(q.a)] };
    };
    for (let k = k0 - 1; k <= k0 + (recipe ? 7 : 2); k++) {
      const tile = (recipe || roadTile)(seed, k); tiles.push(tile);
      for (const [s, len, c] of curveSections(tile)) {
        const q = { s, len, c, x, y, a }, end = point(q, len); parts.push(q); x = end.p[0]; y = end.p[1]; a += c * len;
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
  // the crosswalk walker at a red light: sigPhase (s into the red) walks it across in 12 s, then it stands on the far kerb. Off = its offset; motion/gait from its distance
  function crossingPose(lane, edgeR, sigPhase) {
    const d = (2 * lane + 1.4) * Math.min(1, sigPhase / 12), p = D.Models.pedestrian(d, sigPhase >= 12 ? sigPhase - 12 : null);
    return { off: edgeR - 0.7 + d, motion: p.motion, gait: p.gait };
  }
  // City crossers: at most one walker per urban tile per 50 s cycle, seeded by (seed, tile, cycle). It starts 5-30 s into the cycle,
  // walks the whole carriageway at 1.4 m/s, then stands on the far kerb until the cycle ends (no despawn inside the cycle).
  // lead: the stop window opens this long before the walker starts. Fixed, not speed-based: a longer lead made cars already on approach stop for ~12 s (measured), past the 9 s bound
  const PED = { cycle: 50, speed: 1.4, p: 0.5, walkStart: 5, walkSpread: 25, lead: 2.5, clear: 0.5 };
  function pedCrossing(seed, k, cyc) {
    const R = D.rng((Math.imul(seed | 0, 2654435761) ^ Math.imul(k + 1, 0x27D4EB2F) ^ Math.imul(cyc + 1, 0x165667B1)) >>> 0);
    if (R() >= PED.p) return null;
    const dir = R() < 0.5 ? 1 : -1, start = cyc * PED.cycle + PED.walkStart + R() * PED.walkSpread, s = k * TILE_LEN + 25 + R() * 50;
    return { k, s, dir, start, end: (cyc + 1) * PED.cycle };
  }
  // Pose at time t (only inside [start, end)): offset walks from one kerb to the other; gait from the distance walked, as the red-light walker.
  function pedCrossingPose(lane, ev, t) {
    const span = 2 * lane + 1.4, tau = t - ev.start, walked = Math.min(PED.speed * Math.max(0, tau), span), arrive = span / PED.speed;
    const off = ev.dir > 0 ? -lane / 2 - 0.7 + walked : 1.5 * lane + 0.7 - walked, p = D.Models.pedestrian(walked, tau > arrive ? tau - arrive : null);
    return { s: ev.s, off, dir: ev.dir, motion: p.motion, gait: p.gait };
  }
  // A pedestrian stop, in the same direction-space as signalStop: the car stops short of a walker who is on, or about to step onto, the carriageway.
  // The window opens PED.lead before the walker starts, and closes once the walker is across.
  // Off when people are off (the walkers do not exist), when traffic logic is off, or when the pedStop option is false (a test control).
  function pedestrianStop(src, car, t) {
    const tc = src.tiles, tr = src.traffic;
    if (!tc || tc.mountain || !tr.logic || tr.pedStop === false || tc.flags.people === false || car.turn) return undefined;
    const dir = car.kind === 'oncoming' ? -1 : 1, k0 = Math.floor(car.x / TILE_LEN), lead = PED.lead;
    let best;
    const consider = (s, from, to) => {
      // not yet in the window, or too close to stop short of it (a stop line closer than half a car plus s0 cannot be reached: the car would sit on it)
      if (t < from || t > to || dir * (s - car.x) < IDM.length / 2 + IDM.s0) return;
      if (best === undefined || dir * s < best) best = dir * s;
    };
    const cur = Math.floor(t / PED.cycle);
    for (let k = k0 - 2; k <= k0 + 3; k++) {
      const tile = roadTile(tc.seed, k);
      if (tile.kind === 'urban') for (const cyc of [cur, cur + 1]) {
        const ev = pedCrossing(tc.seed, k, cyc);
        if (ev) consider(ev.s, ev.start - lead, ev.start + (2 * src.lane + 1.4) / PED.speed + PED.clear);
      }
      if (isJunction(tile)) {                                        // the red-light walker: crosses in the first 12 s of red
        const sig = signalState(tile, t);
        if (sig.lit === 'red' && sig.phase < 12.5) consider(tile.s0 + 100 - src.lane - 2.7, t, t);
      }
    }
    return best;
  }
  // The nearer of the signal and pedestrian stops (both in direction-space, so the smaller one is nearer).
  function stopFor(src, car, t) {
    const sig = signalStop(src, car, t), ped = pedestrianStop(src, car, t);
    return ped === undefined ? sig : sig === undefined ? ped : Math.min(sig, ped);
  }
  // A frame's markings stay in route coordinates, objects and light positions use the very same route transform.
  function tileWorld(p, dist, t, tauOf) {
    if (p.src.tiles.mountain) return RF.Touge.world(p, dist, t, tauOf);
    const src = p.src, cfg = src.tiles, lane = p.lane, A = tileRoute(cfg.seed, dist, !!cfg.groundCache), edgeR = -lane / 2, edgeL = 1.5 * lane, crossings = [], lights = [], extra = [], skip = [], marks = [];
    const pp = Object.assign({}, p, { A });
    // Street lights can reach foliage outside our beam: keep it for actual per-point shading.
    const obs = place(src, dist, A, tauOf, cfg.lamps === 'off' && !p.detailedModels ? dimFoliage(pp) : null, D.Models.deerEnabled(p)).concat(trafficObjects(src, trafficCars(src, dist, t), A, pp));
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
          const w = crossingPose(lane, edgeR, sig.phase);
          K.person(c0 - 2.5, w.off, 'dark', { dir: [0, 1], gait: w.gait, motion: w.motion });
        }
        for (const ob of K.O) { const n = move(Object.assign({}, ob), ob, ob.x, A); n.tile = tile.k; extra.push(n); }
      }
      // lamp rule (SP3): urban-only (the default, today) = junction and urban tiles, a lamp every 50 m; sparse = the same tiles, every 100 m; all = every tile, every 50 m; off = none
      const lampRule = cfg.lampRule || 'urban-only', lampTile = lampRule === 'all' || (lampRule !== 'off' && (junction || tile.kind === 'urban'));
      if (lampTile && cfg.lamps !== 'off') {
        const rgb = cfg.lamps === 'led' ? [1, 0.85, 0.66] : [1, 0.43, 0.10], K = D.kit({ Lw: lane, A: null, rand: () => 0.5 });
        for (let u = 25, i = 0; u < TILE_LEN; u += lampRule === 'sparse' ? 100 : 50, i++) {
          const s = tile.s0 + u - dist, side = i % 2 ? 1 : -1, b = side < 0 ? edgeR - 1 : edgeL + 1, head = b - side * 0.8;
          if (s < -65 || s > CULL) continue;
          K.add({ k: 'cyl', x: s, y: b, r: 0.065, z0: 0, z1: 7, mat: 'pole', cls: 'street-lamp' });
          K.add({ k: 'box', x: s, y: (b + head) / 2, hx: 0.08, hy: 0.5, z0: 6.9, z1: 7, mat: 'pole', cls: 'street-lamp' });
          K.add({ k: 'ell', x: s, y: head, z: 6.9, rx: 0.3, ry: 0.18, rz: 0.05, mat: 'lamp-head', emit: rgb.map((v) => 9000 * v), cls: 'street-lamp' });
          const q = A.at(s, head); lights.push({ x: q.p[0], y: q.p[1], z: 6.85, cd: 900, rgb });
        }
        for (const ob of K.O) extra.push(move(Object.assign({}, ob), ob, ob.x, A));
      }
      // The city crosser (see pedCrossing): one walker per cycle, placed in the tile's own s range, so the stop line and the walker agree.
      if (tile.kind === 'urban' && cfg.flags.people !== false) {
        const ev = pedCrossing(cfg.seed, tile.k, Math.floor(t / PED.cycle));
        if (ev && t >= ev.start && t < ev.end && ev.s - dist > -65 && ev.s - dist < CULL) {
          const w = pedCrossingPose(lane, ev, t), K = D.kit({ Lw: lane, A: null, rand: () => 0.5, reflectiveClothing: cfg.pedMode });
          K.person(ev.s - dist, w.off, 'dark', { dir: [0, w.dir], gait: w.gait, motion: w.motion, id: 'cross:' + tile.k + ':' + ev.start });
          for (const ob of K.O) extra.push(move(Object.assign({}, ob), ob, ob.x, A));
        }
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
    return { A, objects: D.Models.actors(filtered.concat(extra),p.detailedModels), markings: marks, crossings, lights };
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
    if (a.kind === 'person') {   // legs follow the distance walked, and settle when it stops (D.Models.pedestrian)
      const stoppedFor = run > 0 && d >= a.len ? run - a.len / a.spd : null, p = D.Models.pedestrian(d, stoppedFor);
      return { s: a.s0 + a.ds * d, off: a.off0 + a.doff * d, motion: p.motion, gait: p.gait };
    }
    return { s: a.s0 + a.ds * d, off: a.off0 + a.doff * d, motion:D.Models.locomotion(a.kind,d,a.spd,moving,a.gaitState), gait: moving ? (a.kind === 'deer' ? 0.14 : 0.11) * Math.sin(2 * Math.PI * (a.kind === 'deer' ? 1.4 : 1.8) * run) : 0 };
  }
  // the objects as the car at distance `dist` sees them (car frame). Every object appears once, at s ∈ [dist − 6, dist − 6 + PERIOD); A: RF.Road.arc or null
  // ob copied to n, moved to `rel` m ahead of the car (on a bend: along the lane, turned with the tangent)
  function move(n, ob, rel, A) {
    n.bs = undefined;
    if (A) {
      const q = A.at(rel, ob.y), psi = Math.atan2(q.t[1], q.t[0]), c = Math.cos(psi), sn = Math.sin(psi);
      n.x = q.p[0]; n.y = q.p[1];
      if(ob.detail){const a=A.at(rel+ob.detail.x-ob.x,ob.detail.y);n.detail={...ob.detail,x:a.p[0],y:a.p[1],yaw:ob.detail.yaw+psi};}
      if (ob.k === 'box') n.yaw = (ob.yaw || 0) + psi;
      else if (ob.k === 'disc') { n.nx = ob.nx * c - ob.ny * sn; n.ny = ob.nx * sn + ob.ny * c; }
    } else { n.x = rel; if(ob.detail)n.detail={...ob.detail,x:ob.detail.x+rel-ob.x}; }
    return n;
  }
  /* tauOf(id, rel0) → seconds since that walker/deer started moving (0 without it: they stand where they start). Random scenery: the chunks around the car, each object once */
  function place(src, dist, A, tauOf, skip, deerBehaviour) {
    const out = [];
    if (src.chunk) {
      const k0 = Math.floor((dist - 6) / PERIOD), K = D.kit({ Lw: src.lane, A: null, rand: () => 0.5, reflectiveClothing: src.pedMode });
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        const base = k * PERIOD, ch = src.chunk(k);
        if (k >= k0) for (const ob of ch.objects) { const rel = ob.x + base - dist; if (rel >= -6 && rel <= CULL) { const n = move(Object.assign({}, ob), ob, rel, A); if (!skip || !skip(n)) out.push(n); } }
        for (const a of ch.actors) {
          const id = k + ':' + a.id, tau = tauOf ? tauOf(id, base + a.s0 - dist) : 0, ps = actorPose(a, tau), rel = base + ps.s - dist; if (rel < -6 || rel > CULL) continue;
          const n0 = K.O.length, attention=deerBehaviour&&a.kind==='deer'?D.Models.deerAttention((src.traffic?.seed||0)+':'+id,tauOf?tauOf('@'+id):-1):null;
          // Behaviour on: the walk runs as it does with behaviour off until the bolt; the bolt starts from where the deer is then (walk clock frozen at bolt onset), so a deer that has stepped onto the carriageway bounds off it.
          if(attention&&attention.state==='bolt')Object.assign(ps,actorPose(a,Math.max(0,tau-(attention.elapsed-attention.bolt))));
          if (attention && attention.state==='bolt') { const d=Math.max(0,attention.elapsed-attention.bolt)*3.8;ps.off+=a.side*d;ps.motion=D.Models.locomotion('deer',d,3.8,true,'bound'); }
          if (a.kind === 'deer') K.deer(rel, ps.off, { face: (a.side > 0 ? 1 : -1)*(attention?.state==='bolt'?-1:1), gait: ps.gait, motion:ps.motion, attention }); else K.person(rel, ps.off, a.ptype, { dir: [a.ds, a.doff], gait: ps.gait, motion:ps.motion, id: a.id });
          for (let i = n0; i < K.O.length; i++) out.push(move(Object.assign({}, K.O[i]), K.O[i], K.O[i].x, A));
        }
      }
      return out;
    }
    for (const ob of src.objects) {
      const cycle=-Math.floor((ob.x-dist+6)/PERIOD),rel=ob.x-dist+cycle*PERIOD,n=move(Object.assign({},ob),ob,rel,A);
      if(deerBehaviour&&ob.detailPart==='deer'){
        if(!ob.detail)continue;
        const id=cycle+':static:'+ob.modelId,attention=D.Models.deerAttention((src.traffic?.seed||0)+':'+id,tauOf?tauOf('@'+id):-1),d=attention.state==='bolt'?Math.max(0,attention.elapsed-attention.bolt)*3.8:0,side=ob.y>src.lane/2?1:-1,K=D.kit({Lw:src.lane,A,rand:()=>.5});
        K.deer(rel,ob.detail.y+side*d,{attention,motion:D.Models.locomotion('deer',d,3.8,d>0,'bound'),face:d>0?-side:ob.detail.face});out.push(...K.O);continue;
      }
      if(!skip||!skip(n))out.push(n);
    }
    return out;
  }
  // Tuning, not an OEM control law: swivel follows the curvature under the car (a stand-in for steering angle; the sim has no
  // separate steering or yaw), 8..30 m gain, 15° clamp, 12°/s out into a bend, 30°/s back to centre.
  const AFS_MAX = Math.PI / 12, AFS_RATE = Math.PI / 15, AFS_RETURN = Math.PI / 6;
  function steeringSignal(src, x, v) {
    const c = curvatureAt(src, x), ahead = curvatureAt(src, x + Math.max(8, Math.min(30, v * .8)));
    // Straightening road ahead wins over the bend under the car, so the beam starts coming back as the wheels do.
    return { current: c, preview: Math.abs(ahead) < Math.abs(c) ? ahead : c };
  }
  function afsTarget(src, x, v) {
    const c = steeringSignal(src, x, v).preview;
    return Math.max(-AFS_MAX, Math.min(AFS_MAX, c * Math.max(8, Math.min(30, v * .8)) * Math.min(1, Math.max(0, v) / 3)));
  }
  function lightingStep(state, src, x, v, dt, afs, cornering) {
    state = state || { yaw: 0, left: 0, right: 0 };
    const slew = (a,b,rate) => a + Math.max(-rate * dt, Math.min(rate * dt, b-a));
    const swivel = (a,b) => slew(a, b, Math.abs(b) < Math.abs(a) ? AFS_RETURN : AFS_RATE);
    const c = steeringSignal(src,x,v).current;
    // Current curvature only: do not fire a discrete lamp early on a straight or through junctions we do not turn at.
    const strength = cornering ? Math.max(0, Math.min(1, (Math.abs(c)-.008)/.012)) * Math.max(0, Math.min(1,(40-v*3.6)/5)) : 0;
    return { yaw: afs ? swivel(state.yaw, RF.DriveAnim.afsTarget(src,x,v)) : 0,
      left: cornering ? slew(state.left,c>0?strength:0,2) : 0, right: cornering ? slew(state.right,c<0?strength:0,2) : 0 };
  }
  // Advance the lighting over dt in fixed ~1/60 s substeps (at most 12), so the swivel and the sampled target stay fps-independent.
  // dt <= 1/60 is one call with the original dt, so frames at 60+ fps are unchanged. x and v are the same for every substep.
  function lightingSubsteps(state, src, x, v, dt, afs, cornering) {
    const n = dt > 0 ? Math.max(1, Math.min(12, Math.ceil(dt * 60 - 1e-9))) : 1, h = dt / n;
    let s = state;
    for (let i = 0; i < n; i++) s = lightingStep(s, src, x, v, h, afs, cornering);
    return s;
  }
  const lightingExtras = p => !!(p.trafficBeams || p.surfaceSheen || p.lampPitch || p.pitch || p.afs || p.corneringLamps || p.yaw || p.cornerLeft || p.cornerRight);
  // Tuning, not a passenger-car measurement: 0.12 deg/(m/s²), critically damped 1.5 Hz.
  // Exact constant-input solution stays stable at low frame rates. Positive acceleration lifts the beam.
  function pitchStep(state, acceleration, dt) {
    const q = state || { angle: 0, rate: 0 }, target = Math.max(-2, Math.min(2, 0.12 * acceleration)) * Math.PI / 180, w = 2 * Math.PI * 1.5;
    const x = q.angle - target, b = q.rate + w * x, e = Math.exp(-w * Math.max(0, dt));
    return { angle: target + (x + b * dt) * e, rate: (q.rate - w * b * dt) * e };
  }
  const camOf = (p) => ({ w: p.w, h: p.h, hfov: p.hfov, eye: eyeOf(p), lamps: p.lamps, lut: p.lut, conv: p.conv, arc: p.A, lane: p.lane, look: p.look, profile: p.profile, src: p.src, trafficBeams: p.trafficBeams, lightRange: p.lightRange, lightCars: p.lightCars, surfaceSheen: p.surfaceSheen, pitch: p.pitch, yaw: p.yaw, cornerLeft: p.cornerLeft, cornerRight: p.cornerRight, lampRGB: p.lampRGB });
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
    if (lightingExtras(p)) return null;
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
  // Fixed intersections use the same repeating world as their objects. Move finite
  // cross-street markings and lane openings together; ordinary lane dashes retain their phase.
  function fixedIntersection(src, dist) {
    const shift = Math.ceil((dist - src.cross.s1) / PERIOD) * PERIOD - dist;
    const cross = { s0: src.cross.s0 + shift, s1: src.cross.s1 + shift };
    const markings = src.markings.map(m => Object.assign({}, m, m.skip
      ? { skip: m.skip.map(([a, b]) => [a + shift, b + shift]), ...(m.pat ? { pat: { ...m.pat, s0: m.pat.s0 - dist % m.pat.period, s1: m.pat.s1 - dist % m.pat.period } } : {}) }
      : m.pat ? { pat: { ...m.pat, s0: m.pat.s0 + shift, s1: m.pat.s1 + shift } } : {}));
    return { markings, crossings: [{ ...cross, o0: -1e5, o1: 1e5 }] };
  }
  // tileRow(ty) → true: trace only these 16-px tile rows (a worker's share); the rows come back with .trows = the tile rows that were traced
  function objects(p, dist, rgba, ss, tauOf, tileRow, placed, t) {
    if (p.src.tiles) return tileFrame(p, dist, t || 0, rgba, ss, tauOf, tileRow, placed);
    if (p.src.cross || (D.wetnessOf(p.look) > 0 && p.look.wetSheen) || lightingExtras(p)) {
      const markings = p.src.markings.map((m) => m.pat ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { s0: m.pat.s0 - dist % m.pat.period, s1: m.pat.s1 - dist % m.pat.period }) }) : m);
      const fixed = p.src.cross ? fixedIntersection(p.src, dist) : null;
      const r = D.render(Object.assign({}, camOf(p), { ss: ss || 2, layer: 'frame', tight: true, rgba, tileRow, crossings: fixed ? fixed.crossings : [], grain: D.wetnessOf(p.look) > 0 && p.look.grain ? tileGrain(dist, true) : null, scene: { objects: placed || placedObjects(p, dist, t || 0, tauOf), markings: fixed ? fixed.markings : markings, verge: p.src.verge } }));
      r.rows.trows = r.trows; r.rows.TS = r.TS; return r.rows;
    }
    const r = D.render(Object.assign({ ss: ss || 2, layer: 'objects', tight: true, rgba, tileRow, scene: { objects: placed || placedObjects(p, dist, t || 0, tauOf), markings: [], verge: p.src.verge } }, camOf(p)));
    r.rows.trows = r.trows; r.rows.TS = r.TS; return r.rows;
  }
  // walkers and deer start to move when the car is ACT m from where they stood: act = id → the clock (s) at that moment. Pure state, so every thread that sees the same frames keeps the same copy
  // @ clocks are deer attention onset, independent of the legacy movement clock; -1 means still grazing.
  const tauFor = (act, t) => (id) => { const t0 = act.get(id); return t0 === undefined ? (id[0]==='@'?-1:0) : t - t0; };
  // start the walkers and deer the car has come within ACT m of (the page does this once per frame and hands the result to every thread, so they all pose the same actor the same way)
  function activate(src, dist, t, act) {
    if (src.tiles && src.tiles.mountain) return RF.Touge.activate(src, dist, t, act);
    if (!src.chunk) {
      for(const ob of src.objects)if(ob.detailPart==='deer'&&ob.detail){const cycle=-Math.floor((ob.x-dist+6)/PERIOD),id=cycle+':static:'+ob.modelId;if(!act.has('@'+id)&&ob.x+cycle*PERIOD-dist<=D.Models.deerProfile((src.traffic?.seed||0)+':'+id).trigger)act.set('@'+id,t);}
      return;
    }
    const k0 = Math.floor((dist - 6) / PERIOD);
    for (let k = k0 - 1; k <= k0 + 1; k++) for (const a of src.chunk(k).actors) { const id = k + ':' + a.id; if (!act.has(id) && k * PERIOD + a.s0 - dist <= ACT) act.set(id, t); if(a.kind==='deer'&&!act.has('@'+id)&&k*PERIOD+a.s0-dist<=D.Models.deerProfile((src.traffic?.seed||0)+':'+id).trigger)act.set('@'+id,t); }
  }
  function pruneAct(act, dist) { if (act.size > 80) { const k0 = Math.floor((dist - 6) / PERIOD); for (const id of act.keys()) if (+id.replace(/^@/,'').split(':')[0] < k0 - 2) act.delete(id); } }
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
          const eyeP = eyeOf(p), tg = -eyeP[2] / dz, px = eyeP[0] + tg * dx, py = eyeP[1] + tg * dy, s = A ? A.frame(px, py).s : px, hl = Math.max(0.5 * tg * d0, 1e-4) / Math.max(-dz, 0.003);
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
        use(P.compose, { uSize: [W, H], uEye: f.eye || EYE, uTanH: tanH, uTanV: tanV, uDelta0: 2 * tanH / W, uR: f.A ? f.A.R : 0, uSg: f.A ? f.A.sg : 0, uTex: f.tex || 0, uTexDist: f.texDist || 0, uLw: f.lane || 3.5, uVw: f.vw || 1.6 });
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
  // Resolution selector: the sim width ceiling is the level picked in the drive controls (the same for every scene and mode).
  // Min fps replaces the frame-time target: frameTargetMs = 1000 / minFps, so the old stored frameTargetMs still means something.
  const SIM_CEILINGS = { low: 640, medium: 960, high: 1600, ultra: 2560, native: 3840 }, MIN_FPS = [20, 30, 45, 60];
  function simCeiling(o) { return (o && SIM_CEILINGS[o.simCeiling]) || SIM_CEILINGS.high; }
  function nearestMinFps(ms) { const fps = 1000 / ms; return MIN_FPS.reduce((a, b) => Math.abs(b - fps) < Math.abs(a - fps) ? b : a); }
  // stored settings: a stored minFps wins; else an old stored frameTargetMs (ms) becomes the nearest choice; else 30
  function fpsSettings(o) {
    const fps = o && MIN_FPS.includes(+o.minFps) ? +o.minFps : o && +o.frameTargetMs > 0 ? nearestMinFps(+o.frameTargetMs) : 30;
    return { minFps: fps, frameTargetMs: 1000 / fps };
  }
  // sim size for a canvas cssW css px wide at dpr: min(ceiling, backing width), floored at MIN_SIM, then the dynamic scale; even sizes
  function simSize(ceiling, cssW, dpr, scale) {
    const baseW = Math.max(MIN_SIM, Math.min(ceiling, Math.round(cssW * dpr))) & ~1, W = Math.max(160, Math.round(baseW * scale)) & ~1;
    return { baseW, W, H: Math.round(W * 9 / 16) & ~1 };
  }
  const RES_SCALES = [1, 0.85, 0.7, 0.55, 0.4, 0.3];
  const BOUNCE_MS = 30000, HOLD_MS = 30000, HOLD_MAX_MS = 240000;       // a step-down within BOUNCE_MS of a step-up doubles the wait before the next step-up (30 s, 60 s .. 240 s); BOUNCE_MS without a bounce resets it
  const resolutionState = () => ({ scale: 1, index: 0, slow: 0, fast: 0, cooldown: 0, average: 0, clock: 0, upAt: -1e9, holdUntil: 0, hold: 0 });
  function resolutionStep(state, ms, opts) {
    const o = opts || {}, s = Object.assign(resolutionState(), state), target = Number.isFinite(+o.target) && +o.target > 0 ? +o.target : 33;
    if (!o.enabled || o.pinned) return resolutionState();
    if (!(ms > 0) || !Number.isFinite(ms)) return s;
    s.clock += ms; if (s.hold && s.upAt > -1e9 && s.clock - s.upAt >= BOUNCE_MS) { s.hold = 0; s.upAt = -1e9; }
    s.average = s.average ? 0.8 * s.average + 0.2 * ms : ms;
    if (s.cooldown > 0) { s.cooldown--; return s; }
    if (s.average > target * 1.15) { s.slow++; s.fast = 0; }
    else if (s.average < target * 0.7) { s.fast++; s.slow = 0; }
    else s.slow = s.fast = 0;
    if (s.slow >= 6 && s.index < RES_SCALES.length - 1) {
      if (s.clock - s.upAt < BOUNCE_MS) { s.hold = Math.min(HOLD_MAX_MS, s.hold ? s.hold * 2 : HOLD_MS); s.holdUntil = s.clock + s.hold; s.upAt = -1e9; }
      s.index++; s.slow = s.fast = 0; s.cooldown = 20; s.average = 0;
    }
    else if (s.fast >= 60 && s.index > 0 && s.clock >= s.holdUntil) { s.index--; s.upAt = s.clock; s.slow = s.fast = 0; s.cooldown = 20; s.average = 0; }
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
    // FG: the last 120 drawn-frame intervals, for the FPS badge. UX3: a play/pause change restarts the window, a view paused after playing
    // records no frame times (V.pausedSeen, badge reads "paused"), and a gap above FRAME_GAP_CAP_MS (a stall or a hidden tab) is dropped.
    const playingNow = !!S(V.ui).playing, wasPlaying = V.playingPrev; V.playingPrev = playingNow;
    if (wasPlaying === true && !playingNow) V.pausedSeen = true;
    if (playingNow) V.pausedSeen = false;
    if (wasPlaying !== undefined && wasPlaying !== playingNow) { V.frameMs = []; V.lastDrawn = 0; }
    if (V.pausedSeen) V.frameMs = [];
    if (!V.pausedSeen && V.lastDrawn && now - V.lastDrawn <= FRAME_GAP_CAP_MS) { const ms = V.frameMs || (V.frameMs = []); ms.push(now - V.lastDrawn); if (ms.length > FRAME_MS_WINDOW) ms.shift(); }
    V.lastDrawn = now;
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
  function S(ui) {
    const o = ui.dvOpts || {};
    const st = ui.dvAnim || (ui.dvAnim = { view: o.view || 'anim', playing: o.playing === true, popout: false, dist: 0, total: 0, t: 0 });
    // Old clients used a separate still/static view, sometimes with playing=true.
    // Migrate before any controls or render decisions; keep position and all other preferences.
    if (st.view === 'still' || st.view === 'static') { st.view = 'anim'; st.playing = false; }
    return st;
  }
  const supported = (o) => !!o.mountainPass || !!ANIM_SCENES[o.scene];
  const visible = () => {
    const ui = V.ui; if (!ui || !V.canvas || !V.info || typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return false;
    if (!V.canvas.isConnected || !V.canvas.getClientRects().length) return false;          // collapsed pane, display: none (the canvas itself, not its parent)
    return S(ui).popout || (ui.display === 'drive' && ui.store.scene.mode === 'D');
  };

  function size() {                                           // → { cssW, cssH, dpr, W, H } for the container the canvas lives in
    const par = V.canvas.parentElement, bw = par.clientWidth, bh = par.clientHeight, dpr = Math.min(2, root.devicePixelRatio || 1);
    // the sim width ceiling is the owner's selected level, the same for every scene and mode (it used to be a per-scene cap: 640 tiles/wet, 960 forest/city, 1600 otherwise)
    const cssW = Math.max(16, Math.min(bw, bh * 16 / 9)), cssH = cssW * 9 / 16;
    const scale = V.info && V.info.o.dynamicResolution && !V.pinSS ? (V.resolution || resolutionState()).scale : 1;
    const sim = simSize(simCeiling(V.info && V.info.o), cssW, dpr, scale);
    return { cssW, cssH, dpr, W: sim.W, H: sim.H, baseW: sim.baseW, scale, left: (bw - cssW) / 2, top: (bh - cssH) / 2 };
  }
  function ensureCanvas() {
    if (V.lost || V.glFailed) return false;
    if (V.canvas) return !!V.gl;
    const c = document.createElement('canvas'); c.className = 'drive-gl'; c.setAttribute('aria-label', 'Animated drive view'); c.setAttribute('role', 'img');
    c.addEventListener('webglcontextlost', contextLost);
    c.addEventListener('webglcontextrestored', contextRestored);
    if (!TL.cur) tlOpen('load');   // GL built outside a click (Drive on load): the load event times it
    try { V.gl = makeGL(c); } catch (e) { V.why = String(e.message || e); }
    if (!V.gl) { say('WebGL2 with float render targets is unavailable; showing the CPU recovery picture.'); return false; }
    V.canvas = c; tlMark('GL context and shaders created'); return true;
  }
  const recovery = () => !RF.SolverHost || RF.SolverHost.recovery();
  function say(message) {
    V.why = message;
    if (V.protoState === 'showing') protoEnd();      // an error/fallback notice takes the same spot: the prototype note yields
    if (!V.cv) return;
    if (!V.notice) V.notice = E('div', { class: 'drive-notice', 'data-anim': 'notice', role: 'status' });
    V.notice.textContent = message; V.notice.hidden = !message;
    const host = V.popStage || V.cv.parentElement; if (V.notice.parentElement !== host) host.append(V.notice);
  }
  // Mountain pass prototype note: a short pill that fades after 6 s. Its own element (not V.notice) so the per-frame say() calls cannot
  // resurrect it; V.protoState is 'showing' or 'done' (done = gone for the rest of the page session, so it never comes back).
  function protoNote(on) {
    if (!on) { if (V.protoState === 'showing') protoEnd(); return; }
    if (V.protoState || !V.cv) return;
    V.protoState = 'showing';
    if (!V.protoEl) V.protoEl = E('div', { class: 'drive-notice drive-proto', 'data-anim': 'proto-notice', role: 'status' });
    const el = V.protoEl; el.textContent = 'Mountain pass · prototype'; el.classList.remove('fading'); el.hidden = false;
    const host = V.popStage || V.cv.parentElement; if (el.parentElement !== host) host.append(el);
    V.protoTimer = setTimeout(() => { el.classList.add('fading'); V.protoTimer = setTimeout(protoEnd, 450); }, 6000);
  }
  function protoEnd() {
    clearTimeout(V.protoTimer); V.protoTimer = 0; V.protoState = 'done';
    if (V.protoEl) { V.protoEl.hidden = true; V.protoEl.classList.remove('fading'); }
  }
  // Photosensitivity notice: shown at the first animated frame of a page load; dismissal is remembered in localStorage.
  const PS_KEY = 'flux/photosafeNotice', PS_TEXT = 'Flashing lights: the drive view can flash (glare, passing headlamps). Glare is off by default; your system\'s Reduce Motion setting caps it.';
  function photosafeNotice() {
    if (V.psShown || !V.cv) return;
    V.psShown = true;
    try { if (localStorage.getItem(PS_KEY) === 'dismissed') return; } catch (e) { /* no storage: show it */ }
    const box = document.createElement('div');
    // Own fixed bottom banner, not .drive-notice: that class sits under the toolbar and is covered by the layout check (UX2).
    box.setAttribute('data-anim', 'photosafe-notice'); box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:5;padding:6px 8px;background:#17283e;color:#fff;font-size:12px;';
    const text = document.createElement('span'); text.textContent = PS_TEXT;
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Dismiss'; btn.setAttribute('data-anim', 'photosafe-dismiss');
    btn.addEventListener('click', () => { try { localStorage.setItem(PS_KEY, 'dismissed'); } catch (e) { /* ignore */ } box.remove(); });
    box.append(text, ' ', btn);
    (V.popStage || V.cv.parentElement).append(box);
  }
  function contextFallback(why) {
    clearTimeout(V.restoreTimer); V.restoreTimer = 0; V.glFailed = true; stop(); killWorkers();
    const st = S(V.ui); if (st.gameMode) toggleGame(V.ui); st.playing = false; st.view = 'anim';
    if (V.canvas) V.canvas.hidden = true;
    if (st.popout) closePop(V.ui);
    say(why + '; showing the CPU recovery picture. Reload the page to retry animation.'); V.ui.redrawSpec();
  }
  function contextLost(e) {
    if (!recovery()) return;
    e.preventDefault(); if (V.lost || V.glFailed) return;
    tableStripClear(); if (V.three) { V.three.dispose(); V.three = null; V.gkey = ''; V.gpuTries = 0; }       // the GPU renderer is rebuilt on restore (gpuRenderer)
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
      S(V.ui).playing = !!V.resume && !(g && !g.done); say(''); V.ui.redrawSpec();
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
    const I = info(), o = I.o, pool = trafficPoolOf(o), W = sz.W, H = sz.H, key = JSON.stringify([I.groundKey, W, H, simCeiling(o), I.us && o.cline === 'broken', !!o.tiles, !!V.three, !!o.trafficBeams, lightRangeOf(o), lightCarsOf(o), !!o.surfaceSheen, !!o.lampPitch, !!o.afs, !!o.corneringLamps, I.lampRGB, !!V.high, o.ownLow, o.ownHigh, lampTintOf(I, ownBeams(o)).rgb, pool && pool.key]);     // V.high: the switch changes the lamp table; own beams (BA2) change it too, so the cached ground and picture rows are rebuilt
    if (V.shuf) V.shuf.title = shuffleTip(o);   // the tooltip follows the renderer, every frame
    const skey = JSON.stringify([o.scene, I.rd.laneDrive, I.us, o.people, o.animals, o.signs, o.reflectiveClothing, o.posts, o.veg, o.obstacle, o.rpm, o.wild, o.seed, o.density, o.cline, !!o.tiles, !!o.mountainPass, !!o.leafyFoliage]), tkey = JSON.stringify([skey, o.oncoming, o.preceding, o.onKcd, o.onMode, o.trafficDensity, o.trafficRange, o.safeGap, !!o.trafficLogic, !!o.tileCache, o.tiles && [o.streetLamps, o.tex, D.wetnessOf(o)]]);
    if (V.skey !== tkey || !V.src) { if (V.akey !== skey) V.act.clear(); V.akey = skey; V.srcArgs = [o.scene, I.rd.laneDrive, I.us, { people: o.people, animals: o.animals, signs: o.signs, posts: o.posts, veg: o.veg, obstacle: o.obstacle, rpm: o.rpm }, { leafyFoliage: !!o.leafyFoliage, reflectiveClothing: o.reflectiveClothing, wild: !!o.wild, seed: o.seed, density: o.density, cline: o.cline, oncoming: o.oncoming, preceding: o.preceding, onKcd: o.onKcd, onMode: o.onMode, trafficDensity: o.trafficDensity, trafficRange: o.trafficRange, safeGap: o.safeGap, trafficLogic: !!o.trafficLogic, speed: o.speed, mountainPass: !!o.mountainPass, tiles: !!o.tiles, tileCache: !!o.tileCache, streetLamps: o.streetLamps, tex: o.tex, wet: D.wetnessOf(o) > 0 }]; const old = V.src; V.src = source.apply(null, V.srcArgs); if (old && old.traffic.logic && o.trafficLogic && old.traffic.seed === V.src.traffic.seed && old.traffic.density === V.src.traffic.density && !!old.tiles === !!V.src.tiles) V.src.traffic.state = old.traffic.state; V.skey = tkey; if ((old && old.traffic.logic) || V.src.traffic.logic) Wk.busy = null; }
    const fkey = JSON.stringify([o.scene, o.seed, o.trafficDensity, !!o.trafficLogic]);
    if (V.fkey !== fkey) { V.flash = flashState(); V.fkey = fkey; }
    V.renderScale = sz.scale || 1;
    const own = ownBeams(o), tint = lampTintOf(I, own), baseLow = own.low || I.lut(), pickedLut = V.high && own.high ? combineCached(baseLow, own.high) : D.withHigh(baseLow, !!V.high);
    V.p = { w: W, h: H, hfov: o.fov, eye: D.eyeFor(), lampHalos: o.lampHalos, lampKind: o.streetLamps, lamps: I.rd.mdl.lamps, lut: pickedLut, lowLut: baseLow, conv: I.conv, lampRGB: tint.rgb, A: I.A,lane: I.rd.laneDrive, trafficBeams: !!o.trafficBeams, trafficPool: pool, lightRange: lightRangeOf(o), lightCars: lightCarsOf(o), surfaceSheen: !!o.surfaceSheen, afs: !!o.afs, corneringLamps: !!o.corneringLamps, yaw: o.afs && S(V.ui).lighting ? S(V.ui).lighting.yaw : 0, cornerLeft: o.corneringLamps && S(V.ui).lighting ? S(V.ui).lighting.left : 0, cornerRight: o.corneringLamps && S(V.ui).lighting ? S(V.ui).lighting.right : 0, lampPitch: !!o.lampPitch, pitch: o.lampPitch && S(V.ui).pitch ? S(V.ui).pitch.angle : 0, look: { wet: D.wetnessOf(o) > 0, wetness: D.wetnessOf(o), wetSheen: o.wetSheen, wetModel: o.wetModel, visibility: o.visibility, scatter: o.scatter, trafficHalo: o.trafficHalo, haloBins: o.haloBins, haloDiv: o.haloDiv, haloPolar: o.haloPolar, haloPolarLamps: o.haloPolarLamps, haloGain: o.haloGain, scatterMode: o.scatterMode, scatterRes: o.scatterRes, scatterBlur: o.scatterBlur, scatterTableSteps: o.scatterTableSteps, scatterCache: o.scatterCache, scatterCycle: o.scatterCycle, scatterBinCounts: o.scatterBinCounts, scatterQuality: o.scatterQuality, scatterCycleFade: o.scatterCycleFade, scatterNearFade: o.scatterNearFade, scatterNearFadeRange: o.scatterNearFadeRange, scatterNearBias: o.scatterNearBias, scatterGain: o.scatterGain, grain: o.tex !== false, RL: o.RL / 1000, ambient: o.ambient }, src: V.src, us:I.us, leafyFoliage: !!o.leafyFoliage, detailedModels: !!o.detailedModels, deerBehaviour: D.Models.deerEnabled(o), touge: !!(o.mountainPass && V.three) };
    if (V.gkey !== key || V.rdRef !== I.rd) {
      V.g = V.three || V.src.cross || o.tiles || (D.wetnessOf(o) > 0 && o.wetSheen) || o.trafficBeams || o.surfaceSheen || o.lampPitch || o.afs || o.corneringLamps ? { A: new Float32Array(3 * W * H), layers: [], ms: 0 } : ground(V.p); V.gkey = key; V.rdRef = I.rd; V.gl.resize(W, H, Math.round(sz.cssW * sz.dpr), Math.round(sz.cssH * sz.dpr)); V.gl.setGround(V.g); if (!TL.cur) tlOpen('rebuild'); tlMark(V.three ? 'ground (GPU path, drawn per frame)' : 'ground built (CPU)', V.three ? null : { groundMs: V.g.ms });
      V.rgba = new Float32Array(4 * W * H); V.band = [0, H];                    // the object texture may hold an older picture: the next frame rewrites all of it
    }
    V.gl.resize(W, H, Math.round(sz.cssW * sz.dpr), Math.round(sz.cssH * sz.dpr));
  }
  function frameSources(dist, t) {
    let p = V.p; if (p.src.tiles) p = Object.assign({}, p, { A: p.src.tiles.mountain ? RF.Touge.route(dist,p.lane,!!p.touge) : tileRoute(p.src.tiles.seed, dist) });
    if(p.touge){const world=RF.Touge.world(p,dist,t);return RF.Touge.glareSources(world.objects,dist,world.A);}
    // occluders: the whole frame (world + traffic), as the rendered frame sees it, so a car or building between lamp and eye hides the lamp
    const tauOf = tauFor(V.act, t), occ = p.src.tiles ? tileWorld(V.p, dist, t, tauOf).objects : placedObjects(p, dist, t, tauOf);
    V.framePlaced = occ;      // scene details: the hazard list reads this (pointer only)
    return D.glareSources(trafficObjects(p.src, trafficCars(p.src, dist, t), p.A, p), eyeOf(p), occ);
  }
  function exposure(sources) {
    const I = info(), o = I.o;
    if (o.expMode === 'auto' && V.kAuto) return V.kAuto;
    const k = Math.pow(2, o.ev) / D.L_REF;
    return o.expMode === 'adapt' ? 1 / (1 / k + D.veilStrength(D.capGlare(o.glare)) * D.veilAt([1, 0, 0], sources || frameSources(S(V.ui).dist, S(V.ui).t))) : k;
  }
  // EA: the adapt-mode gain eases toward exposure()'s target, once per drawn frame (drive.js adaptStep). It snaps when the options
  // (EV, glare, mode, ground) change, on a seek, a scrub that moves dist without moving t, and during a minigame (its visibility
  // rule reads the drawn pixels and must see the target). Other expMode values are not smoothed.
  function displayK(target, t, dist) {
    const I = info(), o = I.o;
    if (o.expMode !== 'adapt' || S(V.ui).game) { V.adapt = null; return target; }
    const key = [I.groundKey, o.ev, o.glare, o.expMode].join('|'), prev = V.adapt && V.adapt.key === key ? V.adapt : null;
    const moved = !!prev && dist !== prev.dist && t === prev.t;
    const next = D.adaptStep(moved ? null : prev, target, prev ? t - prev.t : NaN);
    V.adapt = { key, t, dist, k: next.k };
    return next.k;
  }
  function exposureLabel(k) {
    V.white = 1 / k;
    const I = info(), o = I.o, b = V.ui.driveExtras && V.ui.driveExtras.querySelector('[data-dv="ev"]');
    if (o.expMode === 'adapt' && b) b.textContent = 'EV ' + (o.ev >= 0 ? '+' : '−') + Math.abs(o.ev).toFixed(1) + ' · white ' + V.white.toPrecision(3) + ' cd/m²';
    return k;
  }
  const ssRule = (w) => { const s = V.info && V.info.o.samples; return s === '1' ? 1 : s === '2' ? 2 : (w > 1100 ? 1 : (V.ss || 2)); };
  const ssNow = () => V.pinSS || ssRule(V.p.w);
  // samples per pixel for the objects: 2×2 where it is cheap; one while a big object is close (the cost is its area) and until things are calm again. ms = what the last frame's trace took
  function adaptSS(ms) {
    V.avg = V.avg === undefined ? ms : V.avg * 0.9 + ms * 0.1;       // a smoothed cost: one slow frame (a big object passing) must not drop the edges to hard 1-sample for a long while
    if (V.p.w <= 1100) { if ((V.ss || 2) === 2 && V.avg > 18) { V.ss = 1; V.calm = 0; } else if (V.ss === 1 && V.avg < 8) { if (++V.calm > 20) V.ss = 2; } else V.calm = 0; }
  }
  // one frame at S.dist
  function frame() {
    if (!contextReady()) return;
    airTick();
    tableStrip();
    if (V.highMode === 'auto') autoTick(V.ui, S(V.ui));
    const t0 = performance.now(); resolutionPrepare(); V.p.airHold = !!V.airHold;
    const ui = V.ui, st = S(ui), I = info(), o = I.o, W = V.p.w, pb = V.band, had = pb[1] > pb[0], profiling = profileOn(), trafficMs = V.cameraMs || 0;
    V.p.yaw = o.afs && st.lighting ? st.lighting.yaw : 0;
    V.p.cornerLeft = o.corneringLamps && st.lighting ? st.lighting.left : 0;
    V.p.cornerRight = o.corneringLamps && st.lighting ? st.lighting.right : 0;
    V.p.pitch = o.lampPitch && st.pitch ? st.pitch.angle : 0;
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
    const sources = V.p.touge ? RF.Touge.glareSources(placed.objects,st.dist,placed.A) : D.glareSources(V.src.tiles ? placed.objects : placed, eyeOf(V.p));
    V.frameGlare = sources; V.framePlaced = placed;      // scene details reads these (pointers only)
    const sourceEnd = performance.now(), glProfile = profiling ? {} : null;
    const draw = { profile: glProfile, hfov: o.fov, eye: eyeOf(V.p), pats: patArgs(V.g, st.dist), A: I.A, k: exposureLabel(displayK(exposure(sources), st.t, st.dist)), glare: D.glareStrength(D.capGlare(o.glare)), veil: D.veilStrength(D.capGlare(o.glare)), sources, flip: I.mirrored, tex: o.tex && !o.tiles ? TEX_AMP * (o.wet ? 0.5 : 1) : 0, texDist: st.dist % TEX_WRAP, lane: V.p.lane };
    if (V.three) { const world = V.src.tiles ? placed : { A: V.p.A, objects: placed, ...(V.src.cross ? fixedIntersection(V.src, st.dist) : {}) }; draw.groundGPU = (target, objTarget) => V.three.render(V.p, world, st.dist, target, objTarget, ss); if (V.src.tiles || (o.wet && o.wetSheen)) draw.tex = 0; }
    const tlB = TL.cur ? tlBefore() : null;
    try { V.gl.draw(draw); } catch (e) { if (!V.three) throw e; gpuFallback(e.message || e); prepare(layout()); frame(); return; }
    if (tlB) tlAfter(tlB);
    tableStrip();   // after the draw: a version that completes on this frame clears the strip now, not on the next frame
    if (!contextReady()) return; if (st.game) V.gameRender = { placed, ss, draw };
    const t3 = performance.now(), c = V.cpu; c.obj += t1 - t0; c.up += t2 - t1; c.gl += t3 - t2; c.n++; V.frames++; (V.ring || (V.ring = [])).push(t1 - t0); if (V.ring.length > 600) V.ring.shift();
    flashLabel(st.dist, st.t); if (detailsOn()) detailsSample(); const detectorStart = performance.now(); if (st.game) { if (V.three) { const masks = V.three.masks(V.p, ss); V.gameMask = masks.mask; V.gameBodyMask = masks.body; } gameFrame(st.game); } const detectorMs = performance.now() - detectorStart; ui.dvAnimFrames = V.frames;
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
    const want = !V.three && !(V.info && (V.info.o.mountainPass || V.info.o.trafficBeams || V.info.o.trafficShuffle === 'library' || V.info.o.surfaceSheen || V.info.o.lampPitch || V.info.o.afs || V.info.o.corneringLamps)) && !S(V.ui || {}).game && !Wk.failed && typeof Worker !== 'undefined' && !!V.info && V.info.o.mt !== false && Wk.forced !== -1, n = nWorkers();
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
    const I = info(), p = V.p, key = JSON.stringify([V.skey, p.w, p.h, p.hfov, p.eye, p.lane, p.conv, p.lamps, p.look, p.detailedModels, p.deerBehaviour, I.A && [I.A.R, I.A.dir], p.lampRGB]);
    if (key === Wk.cfgKey && Wk.lut === p.lut) return;
    Wk.cfgKey = key; Wk.lut = p.lut; Wk.cfgId++; Wk.busy = null;           // a frame in flight belongs to the old picture: dropped when it arrives
    const m = { type: 'cfg', id: Wk.cfgId, p: { w: p.w, h: p.h, hfov: p.hfov, eye: p.eye, lamps: p.lamps, lut: p.lut, lowLut: p.lowLut, conv: p.conv, lampRGB: p.lampRGB, lane: p.lane, look: p.look, detailedModels: p.detailedModels, deerBehaviour:p.deerBehaviour }, arc: I.A ? { R: I.A.R, dir: I.A.dir } : null, src: V.srcArgs };
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
    V.gl.draw({ profile: glProfile, hfov: o.fov, eye: eyeOf(V.p), pats: patArgs(V.g, b.dist), A: I.A, k: exposureLabel(displayK(exposure(sources), b.t, b.dist)), glare: D.glareStrength(D.capGlare(o.glare)), veil: D.veilStrength(D.capGlare(o.glare)), sources, flip: I.mirrored, tex: o.tex && !o.tiles ? TEX_AMP * (o.wet ? 0.5 : 1) : 0, texDist: b.dist % TEX_WRAP, lane: V.p.lane });
    if (!contextReady()) return;
    const t3 = performance.now(), c = V.cpu, rt = t1 - b.sent;
    c.obj += rt; c.up += t2 - t1; c.gl += t3 - t2; c.n++; V.frames++; (V.ring || (V.ring = [])).push(rt); if (V.ring.length > 600) V.ring.shift();
    adaptSS(rt); flashLabel(b.dist, b.t); V.frameGlare = sources; if (detailsOn()) detailsSample(); V.ui.dvAnimFrames = V.frames;      // scene details: pointers and a peak sample, as frame() does
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
    const start = performance.now(), speed = (+info().o.speed || 50) / 3.6, oldV = st.game ? st.game.v : st.camera ? st.camera.v : V.src.traffic.logic ? Math.min(speed, speedLimit(V.src, st.dist)) : speed;
    advanceCameraInner(st, dt);
    const newV = st.game ? st.game.v : st.camera ? st.camera.v : (+info().o.speed || 50) / 3.6;
    // Game mode: a stall (dt is not clamped for the game clock) must not snap the lamps, so lighting and pitch see at most 0.25 s.
    const ldt = st.game ? Math.min(dt, 0.25) : dt;
    st.lighting = lightingSubsteps(st.lighting, V.src, st.dist, newV, ldt, !!info().o.afs, !!info().o.corneringLamps);
    if (info().o.lampPitch && dt > 0) { st.acceleration = (newV - oldV) / dt; st.pitch = pitchStep(st.pitch, st.acceleration, ldt); }
    else { st.pitch = null; st.acceleration = 0; } V.cameraMs = (V.cameraMs || 0) + performance.now() - start;
  }
  function advanceCameraInner(st, dt) {
    if (st.game) {
      RF.DriveGame.step(st.game, dt, V.p.lane, V.p); st.total += st.game.x - st.dist; st.dist = st.game.x; st.t = st.game.t; st.camera = { x: st.dist, v: st.game.v };
      if (st.game.done) st.playing = false; return;
    }
    const speed = (+info().o.speed || 50) / 3.6;
    if (!V.src.traffic.logic && !(V.src.tiles && V.src.tiles.mountain)) { st.total += speed * dt; st.dist += speed * dt; st.t += dt; st.camera = null; return; }
    V.src.traffic.speed = speed * 3.6;
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(IDM.dt, left), old = st.camera;
      const camera = old && Math.abs(old.x - st.dist) < 1e-7 ? old : { x: st.dist, v: Math.min(speed, approachSpeed(V.src, { x: st.dist, kind: 'preceding', v: speed })) };
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
    photosafeNotice();
    if (mt()) { workerCfg(); V.raf = requestAnimationFrame(tick); pump(t, 0); return; }
    const dt = V.last ? (st.game ? Math.max(0, (t - V.last) / 1000) : Math.min(0.1, (t - V.last) / 1000)) : 0; V.last = t;
    advanceCamera(st, dt);
    frame(); if (st.playing) V.raf = requestAnimationFrame(tick);
  }
  function stop() { if (V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; } V.last = 0; V.completedAt = 0; if (RF.Eurobeat) RF.Eurobeat.stop(); }
  function go() { if (!V.lost && !V.glFailed && !V.raf && V.gl && visible() && S(V.ui).playing) { V.last = 0; V.raf = requestAnimationFrame(tick); } }

  // ---------------------------------------------------------------- the controls
  const E = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); e.append(...kids); return e; };
  // ---- BA2 beam library: saved beams for our own low and high beam. Full-resolution tables live in IndexedDB (js/beam-store.js),
  // one record per beam. LIB.items is the synchronous in-memory copy every picker reads; a write lands in memory at once and
  // its status line is set when the store settles. A missing or throwing store makes the library session-only, and the status says so.
  const BEAM_KEY = 'flux/beamLibrary';   // the old localStorage library (coarse copies): moved into IndexedDB once, then removed
  const LIB = { items: [], msg: '', ver: 0, seq: 0, storeOk: null, hydrated: false };
  const libEntry = (parsed, id, persisted) => ({ id, name: parsed.name, beamKind: parsed.beamKind, conv: parsed.conv, lut: RF.Beams.toLut(parsed), colour: parsed.colour || null, persisted: !!persisted, coarse: !!parsed.coarse });
  // BB3: the name in the picker, with the colour temperature when the beam has one; BI1: coarse beams say so
  const beamLabel = (e) => e.name + (e.colour && Number.isFinite(e.colour.cct) ? ' (' + Math.round(e.colour.cct) + ' K)' : '') + (e.coarse ? ' (coarse 0.25 deg)' : '') + (e.builtin ? ' (built-in)' : (e.persisted ? '' : ' (session)'));
  // BB3: the colour a saved design carries: the lamp tint in use (rgb), plus the source's kelvin when it has one
  const sourceColour = (I) => { const c = { rgb: I.lampRGB.slice() }; if (Number.isFinite(I.lampCct) && I.lampCct >= 1000 && I.lampCct <= 20000) c.cct = I.lampCct; return c; };
  // the default name: the design's name, plus the source's kelvin when it has one (e.g. "Headlamp sketch 4300K")
  const beamDefaultName = (I) => { const base = (I && I.designName) || 'our design'; return I && Number.isFinite(I.lampCct) ? base + ' ' + Math.round(I.lampCct) + 'K' : base; };
  const libNewId = () => 'b' + Date.now().toString(36) + (++LIB.seq).toString(36);   // counter, not a random source
  const libLoad = () => LIB.items;
  const libSay = (msg) => { LIB.msg = msg; if (V.beamMsg) V.beamMsg.textContent = msg; };
  const libRec = (e) => ({ id: e.id, name: e.name, beamKind: e.beamKind, conv: e.conv, colour: e.colour || null, coarse: !!e.coarse,
    grid: { h0: e.lut.h0, v0: e.lut.v0, step: e.lut.step, nh: e.lut.nh, nv: e.lut.nv }, values: e.lut.data });
  // writes one entry; resolves true when the store kept it. Sets e.persisted either way.
  async function libWrite(e) {
    try { await RF.BeamStore.put(libRec(e)); e.persisted = true; return true; }
    catch (err) { e.persisted = false; return false; }
  }
  // BI3: built-in samples. The bundles listed in samples/beams/index.json are fetched the first time the library manager or an own-beam
  // select is opened. They are read-only and kept apart from LIB.items (never saved, renamed, deleted or cleared); 'copy to my
  // library' makes a full-resolution copy. The shipped table is used as it is (no resampling).
  LIB.builtins = []; LIB.biState = 'idle'; LIB.bi = null;
  const BI_DIR = 'samples/beams/';
  const libAll = () => [...LIB.items, ...LIB.builtins];
  async function fetchJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  function ensureBuiltins() {
    if (LIB.bi) return LIB.bi;
    LIB.biState = 'loading';
    LIB.bi = (async () => {
      try {
        const idx = await fetchJSON(BI_DIR + 'index.json'), out = [];
        for (const f of (idx && idx.bundles) || []) {
          for (const [i, b] of RF.Beams.readFile(await fetchJSON(BI_DIR + f)).entries()) { const e = libEntry(b, 'builtin:' + f + ':' + i, false); e.builtin = true; out.push(e); }
        }
        LIB.builtins = out; LIB.biState = 'ok';
      } catch (e) { LIB.builtins = []; LIB.biState = 'unavailable'; }
      LIB.ver++;
      if (V.fillOwn) V.fillOwn();
    })();
    return LIB.bi;
  }
  // Startup: read the store into memory, then move the old localStorage library in. Runs once; the view is refreshed after.
  async function libHydrate() {
    try {
      LIB.storeOk = !!RF.BeamStore && await RF.BeamStore.available();
      if (LIB.storeOk) {
        LIB.durable = await RF.BeamStore.persist();   // asked once per page load; the browser decides
        try { for (const r of await RF.BeamStore.getAll()) { try { LIB.items.push(libEntry(r, String(r.id), true)); } catch (e) { /* skip a damaged record */ } } }
        catch (e) { LIB.storeOk = false; }
      }
      await libMigrate();
      LIB.hydrated = true; LIB.ver++;
      if (V.fillOwn) V.fillOwn();
      if (V.p) prepare(layout());   // the picture may have been built before the saved beam was known: rebuild it
    } catch (e) { LIB.storeOk = false; libSay('Browser storage could not be read: the library is for this session only.'); }
  }
  // One-time move of the old localStorage library. Each beam keeps its id (saved selections still resolve) and is marked coarse.
  // The old key goes only when every beam is in the store; a damaged old entry or a refused write keeps it for the next load.
  // With no store, the old beams are loaded for this session and the key is left alone.
  async function libMigrate() {
    let old = null;
    try { const raw = localStorage.getItem(BEAM_KEY); old = raw ? JSON.parse(raw) : null; } catch (e) { old = null; }
    if (!Array.isArray(old) || !old.length) return;
    let complete = true; const fresh = [];
    for (const r of old) { try { const e = libEntry(RF.Beams.parse(r.beam), String(r.id), false); e.coarse = true; fresh.push(e); } catch (err) { complete = false; } }
    const moved = [];
    for (const e of fresh) { if (!LIB.items.some(x => x.id === e.id)) { LIB.items.push(e); moved.push(e); } }   // already in the store: an earlier run moved it
    LIB.ver++;
    if (!LIB.storeOk) { libSay('Browser storage is unavailable: the older beams are kept for this session only.'); return; }
    let allStored = complete;
    for (const e of moved) { if (!(await libWrite(e))) allStored = false; }
    if (allStored) { try { localStorage.removeItem(BEAM_KEY); } catch (e) { /* the copy stays; the next load sees it already moved */ } }
    libSay(allStored ? 'Moved ' + fresh.length + ' older beam' + (fresh.length === 1 ? '' : 's') + ' into browser storage. They are coarse (0.25 deg): import the full-resolution files to replace them.'
      : 'Some older beams could not be moved into browser storage; they stay for this session, and the older copy stays in this browser.');
  }
  // Adds parsed beams. They show at once; each is written, and the status line says what stuck.
  function libAdd(parsedList) {
    const items = libLoad(), added = [];
    for (const parsed of parsedList) { const e = libEntry(parsed, libNewId(), false); items.push(e); added.push(e); }
    LIB.ver++; libSay('Saving ' + added.length + ' beam' + (added.length === 1 ? '' : 's') + '...');
    if (V.fillOwn) V.fillOwn();
    (async () => {
      const dropped = [];
      for (const e of added) { if (!(await libWrite(e))) dropped.push(e.name); }
      libSay(dropped.length === 0 ? (added.length === 1 ? 'Saved "' + added[0].name + '" to the library.' : 'Added ' + added.length + ' beams.')
        : 'Kept for this session only (browser storage refused): ' + dropped.join(', ') + '. Export them to keep them.');
      if (V.fillOwn) V.fillOwn();
    })();
    return added;
  }
  // a changed entry (rename, colour): written, then the status line says what happened
  function libUpdate(e, msg) {
    LIB.ver++; libSay(msg);
    return libWrite(e).then((stored) => { libSay(stored ? msg : msg + ' Browser storage refused the update, so it may not survive a reload.'); if (V.fillOwn) V.fillOwn(); return stored; });
  }
  // BI2: a table on a coarser grid when the chosen step is coarser than the table's own; never finer, never resampled up
  const gridTo = (lut, step) => (Number.isFinite(step) && step > lut.step + 1e-9 ? RF.Beams.coarsen(lut, step) : lut);
  // BI2: the storage line in the library manager: used of quota (navigator.storage.estimate, when the browser gives it) and whether
  // the browser agreed to keep the data
  async function libStorageText() {
    if (!LIB.storeOk) return 'storage: unavailable, the library is for this session only';
    const est = await RF.BeamStore.estimate(), persistent = LIB.durable ? 'yes' : 'no';
    if (!est) return 'storage: size unknown, persistent: ' + persistent;
    return 'storage: used ' + (est.usage / 1e6).toFixed(1) + ' of ' + (est.quota / 1e6).toFixed(0) + ' MB, persistent: ' + persistent;
  }
  // removes one stored beam, or every stored beam (id omitted); resolves true when the store accepted it
  const libDrop = (id) => (id ? RF.BeamStore.delete(id) : RF.BeamStore.clear()).then(() => true, () => false);
  const libFind = (id, kind) => { const e = libAll().find(x => x.id === id); return e && (!kind || e.beamKind === kind) ? e : null; };
  libHydrate();   // startup: reads the store (async); the pickers refresh when it lands
  // BT: the shuffle pool: the saved LOW beams not ticked out of 'use in traffic' (all by default), sorted by id so the same beam set
  // always gives the same picks. Built-in samples are not in it, so they cannot reshuffle cars when they load late. The GPU renderer
  // never gets a pool (its atlas comes later), so it keeps the built-in beam for every car. null = no pool (built-in only).
  const SHUFFLE_TIP = 'Each car gets one saved low beam from the library, with its own colour and intensity. Symmetric traffic only.';
  const SHUFFLE_MANY_TIP = 'More than ' + 16 + ' saved beams in traffic: the GPU renderer keeps the built-in beam for every car. Untick some under "use in traffic".';
  const shuffleTip = (o) => { const pool = poolOfBeams(libLoad(), o, false, beamRGB); return V.three && pool && pool.entries.length > RF.BeamAtlas.MAX_BEAMS ? SHUFFLE_MANY_TIP : SHUFFLE_TIP; };
  // a beam with no saved colour is neutral (not our lamp's tint: the owner's rule is that a car's beam sets its colour)
  function poolOfBeams(items, o, gpu, rgbOf) {
    if (o.trafficShuffle !== 'library') return null;
    const out = new Set(Array.isArray(o.trafficOutIds) ? o.trafficOutIds : []);
    const entries = items.filter(e => e.beamKind === 'low' && !out.has(e.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(e => ({ id: e.id, lut: e.lut, conv: e.conv || 'A', tint: e.colour ? D.unitTint(rgbOf(e.colour)) : [1, 1, 1] }));
    if (!entries.length) return null;
    if (gpu && entries.length > RF.BeamAtlas.MAX_BEAMS) return null;   // BA5: the atlas holds MAX_BEAMS beams; a longer pool stays built-in on the GPU
    return { entries, weights: null, key: JSON.stringify(entries.map(e => [e.id, e.tint])) };
  }
  const beamRGB = (c) => RF.Beams.lampFor(c, [1, 1, 1], RF.CCT && RF.CCT.cctToRGB).rgb;
  const trafficPoolOf = (o) => poolOfBeams(libLoad(), o, V.three, beamRGB);
  // The beams the options pick: null = built-in (our design for low, generic for high)
  function ownBeams(o) {
    const lo = o.ownLow && o.ownLow !== 'design' ? libFind(o.ownLow, 'low') : null, hi = o.ownHigh && o.ownHigh !== 'generic' ? libFind(o.ownHigh, 'high') : null;
    return { low: lo ? lo.lut : null, high: hi ? hi.lut : null, lowColour: lo ? lo.colour : null, highColour: hi ? hi.colour : null };
  }
  // BB3: the lamp tint the picture uses. While the high switch is on, a saved high beam's colour wins if it has one; otherwise the
  // saved low beam's colour; a beam with no colour (old or imported file) lights with the current source's tint (fromSource).
  function lampTintOf(I, own) {
    const pick = (V.high && own.high ? own.highColour : null) || (own.low ? own.lowColour : null);
    return RF.Beams.lampFor(pick, I.lampRGB, RF.CCT && RF.CCT.cctToRGB);
  }
  // saved high replaces the generic high: low + saved high, cached per (low table, saved high) so the picture keeps its identity
  const combineMemo = new WeakMap();
  function combineCached(low, high) {
    let m = combineMemo.get(low); if (!m) { m = new Map(); combineMemo.set(low, m); }
    let c = m.get(high); if (!c) { c = RF.Beams.combine(low, high); m.set(high, c); }
    return c;
  }
  function fileToText(file) { return new Promise((res, rej) => { if (file.text) file.text().then(res, rej); else { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); } }); }
  function downloadBeams(obj, name) {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bars(ui, setDV) {
    if (V.bar) return V.bar;
    const st = S(ui), bar = E('div', { class: 'drive-anim-tools', 'data-anim': 'bar' }), primary = ui.driveBar.querySelector('.drive-primary'), btn = (k, title, fn, txt) => { const b = E('button', { type: 'button', class: 'toggle', 'data-anim': k, title }, txt || ''); b.addEventListener('click', fn); bar.append(b); return b; };
    btn('play', 'Drive / pause: Pause freezes distance and time', () => { const current = S(ui); current.playing = !current.playing; if (current.playing && V.gpuFailure && V.gpuNote) say(V.gpuNote); setDV(ui, 'playing', current.playing); });   // drops the "Paused:" half of the GPU notice once driving again
    // High beam (H key or this button): session state on V, not saved prefs, so it is off on every reload
    btn('high-beam', 'High beam (H) cycles Off, On, Auto. Auto dips for oncoming headlamps, preceding tail lamps, urban tiles and under 30 km/h, then returns to high after 2 s clear. Off by default; not saved across reloads.', () => cycleHigh(ui), 'high beam');
    document.addEventListener('keydown', (e) => { if (/^h$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && V.bar && !V.bar.hidden && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); cycleHigh(ui); } });
    btn('fit-controls', 'Compact spacing for the wrapping drive controls. Off uses wider spacing.', () => setDV(ui, 'fitControls', info().o.fitControls === false), 'fit controls');
    btn('large-card', 'Open the large Drive view when a game scorecard ends in the inline pane. Off keeps the inline card.', () => setDV(ui, 'largeCard', info().o.largeCard === false), 'large scorecard');
    const sp = E('input', { type: 'range', min: 5, max: 130, step: 5, 'data-anim': 'speed', 'aria-label': 'Speed (km/h)', title: 'Target speed. Mountain pass always slows for bends; traffic logic adds road limits and queues' }); sp.addEventListener('input', () => { setDV(ui, 'speed', +sp.value, true); speedLabel(ui); });
    const lab = E('span', { class: 'anim-speed', 'data-anim': 'speedlab' }); bar.append(sp, lab);
    const speedBox = E('span', { class: 'drive-speed' }); speedBox.append(sp, lab);
    primary.querySelector('[data-dv=scene]').after(speedBox);
    primary.append(bar.querySelector('[data-anim=play]'));
    btn('traffic-logic', 'IDM car following and red/yellow stops. Cars turn at junctions and yield to oncoming traffic. Speed targets the lower of slider and road limit; actual speed appears when different. Off uses scripted traffic; Mountain pass curve speeds remain active.', () => { st.camera = null; setDV(ui, 'trafficLogic', !info().o.trafficLogic); }, 'traffic logic');
    btn('gap', 'Remove a preceding car at max(25 m, 2 seconds of our current speed); the seeded stream supplies the next car ahead. Off = original traffic without a gap guard.', () => setDV(ui, 'safeGap', info().o.safeGap === false), 'gap guard');
    for (const [name, key, label, title] of [
      ['traffic-beams', 'trafficBeams', 'traffic beams', 'Nearest cars (8 by default, see traffic light range and nearest cars) cast low beams onto road and objects, fading out toward the range. CPU uses full-frame tracing.'],
      ['surface-sheen', 'surfaceSheen', 'lit surface sheen', 'Up to eight lit sign/bright faces add wet streaks from integrated returned luminance and area.'],
      ['afs', 'afs', 'AFS', 'Adaptive front-lighting: low beam swivels into tiled bends, up to 15 degrees.'],
      ['cornering-lamps', 'corneringLamps', 'cornering lamps', 'Wide separate lamps fade into tight bends below 40 km/h. Generic study, not measured lamp photometry.'],
      ['lamp-pitch', 'lampPitch', 'lamp pitch', 'Drive only: suspension pitch follows acceleration and braking. Tuning: 0.12 degrees per m/s², 1.5 Hz.']
    ]) btn(name, title, () => { if (key === 'afs' || key === 'corneringLamps') st.lighting = null; if (key === 'lampPitch') { st.pitch = null; st.acceleration = 0; } setDV(ui, key, !info().o[key]); }, label);
    btn('deer-behaviour', 'Deer graze, turn toward the lamps, freeze and bolt. Defaults on with detailed models; you can enable it for primitive deer too. Timing and eye acceptance are tuning. Off restores the original movement and eyes.', () => setDV(ui, 'deerBehaviour', !D.Models.deerEnabled(info().o)), 'deer behaviour');
    btn('detailed-models', 'Detailed deer, people and sphere-cluster trees on CPU/GPU. Mesh cars, far tree cards and facade styles are GPU-only; CPU keeps primitive cars and facades. Play scores follow the visible models.', () => setDV(ui, 'detailedModels', !info().o.detailedModels), 'detailed models');
    btn('leafy-foliage', 'Prototype leaf detail and low verge bushes. Uses trees/vegetation and scenery density. GPU adds leaf cutouts; CPU keeps solid bushes.', () => setDV(ui, 'leafyFoliage', !info().o.leafyFoliage), 'Leafy foliage');
    btn('gpu-renderer', 'Render the animated road on the GPU; HTTP required. Off keeps the CPU reference.', () => { if (V.gpuFailure && info().o.gpuRenderer) { V.gpuFailure = ''; V.gpuTries = 0; say(''); labels(ui); ui.redrawSpec(); } else setDV(ui, 'gpuRenderer', !info().o.gpuRenderer); }, 'GPU drive renderer');      // failed while ON: a click retries the GPU
    btn('fps-counter', 'Small frame-rate badge; no sampled trace profiling.', () => setDV(ui, 'fpsCounter', !info().o.fpsCounter), 'FPS');
    btn('debug-timings', 'Full CPU timing breakdown with sampled trace profiling. GPU execution requires the tester bench.', () => setDV(ui, 'debugTimings', !info().o.debugTimings), 'Debug timings');
    btn('scene-details', 'Live numbers about the scene in a small panel: own car, oncoming traffic, glare, hazards, range and lamp. Refreshes about 4 times a second; off costs nothing.', () => setDV(ui, 'sceneDetails', !info().o.sceneDetails), 'Scene details');
    btn('dynamic-resolution', 'Reduce trace/render dimensions when frames exceed the target; restore slowly with headroom. Off restores full resolution. pinSS freezes scale.', () => setDV(ui, 'dynamicResolution', !info().o.dynamicResolution), 'dynamic resolution');
    // the resolution ceiling: the sim width every scene and mode may use (the canvas stays css x dpr). Dynamic resolution steps down from it.
    const resSel = E('select', { 'data-anim': 'resolution', 'aria-label': 'Resolution ceiling', title: 'Simulated image width ceiling, the same for every scene and mode: Low 640, Medium 960, High 1600, Ultra 2560, Native up to the canvas width (3840 max). Dynamic resolution steps down from this.' });
    for (const [value, label] of [['low', 'Low 640'], ['medium', 'Medium 960'], ['high', 'High 1600'], ['ultra', 'Ultra 2560'], ['native', 'Native (canvas, max 3840)']]) resSel.append(E('option', { value }, label));
    resSel.addEventListener('change', () => setDV(ui, 'simCeiling', resSel.value)); bar.append(resSel);
    const minFps = E('select', { 'data-anim': 'min-fps', 'aria-label': 'Minimum frame rate for dynamic resolution', title: 'Dynamic resolution: step the scale down to hold this many frames per second, back up with headroom' });
    for (const fps of MIN_FPS) minFps.append(E('option', { value: String(fps) }, 'min ' + fps + ' fps'));
    minFps.addEventListener('change', () => { const f = fpsSettings({ minFps: +minFps.value }); setDV(ui, 'frameTargetMs', f.frameTargetMs); setDV(ui, 'minFps', f.minFps); }); bar.append(minFps);
    V.fpsLab = E('output', { class: 'drive-fps', 'data-anim': 'fps-readout', 'aria-live': 'off', hidden: '' });
    V.perfLab = E('output', { class: 'drive-perf', 'data-anim': 'perf-readout', 'aria-live': 'off', hidden: '' });
    btn('tile-cache', 'Reuse beam-lit ground samples across route tiles. Moving markings, grain and street lights still update each frame. Animation with tiles only.', () => setDV(ui, 'tileCache', !info().o.tileCache), 'cache ground');
    const lamps = E('select', { 'data-anim': 'street-lamps', 'aria-label': 'Street lamps on urban tiles', title: 'Downward point lights, diffuse illumination without shadows; approximate sodium / LED colour, not measured fixture photometry' });
    for (const [value, label] of [['off', 'street lamps off'], ['sodium', 'sodium ~2000 K'], ['led', 'LED ~4000 K']]) lamps.append(E('option', { value }, label));
    lamps.addEventListener('change', () => setDV(ui, 'streetLamps', lamps.value)); bar.append(lamps);
    // PED-CLOTHING-MODES: the pedestrian clothing mode (none | mix | small | vest), applied in RF.Drive.kit's person(); the option lives in the More panel.
    const refl = E('select', { 'data-anim': 'reflective-clothing', 'aria-label': 'Reflective clothing on pedestrians', title: 'Pedestrian clothing. None: no vests, no strips. Mix: the scene\'s own vests, plus tape strips and shoe reflectors on a seeded half of the others. Small strips: no vests, every walker has strips and shoe reflectors. Full vest: every walker wears the vest. Clothing colours are shuffled in every mode.' });
    for (const [value, label] of [['none', 'clothing: none'], ['mix', 'clothing: mix'], ['small', 'clothing: small strips'], ['vest', 'clothing: full vest']]) refl.append(E('option', { value }, label));
    refl.addEventListener('change', () => setDV(ui, 'reflectiveClothing', refl.value));
    V.reflSel = refl; (ui.driveExtras || bar).append(refl);   // in the More panel: a control in the toolbar changed the picture (measured, see the report)
    // ambient light: moved here from the sidebar's Road section (drive only; the Spec view never reads it). Light from the sky on diffuse surfaces, besides the lamps; None judges the beam alone
    const ambient = E('select', { 'data-anim': 'ambient', 'aria-label': 'Ambient light', title: 'Light on diffuse surfaces from the sky, besides the lamps. None judges the beam alone.' });
    for (const [value, label] of [['0', 'ambient: none (headlamp only)'], ['0.2', 'ambient: full moon 0.2 lx'], ['5', 'ambient: dusk 5 lx']]) ambient.append(E('option', { value }, label));
    ambient.addEventListener('change', () => setDV(ui, 'ambient', +ambient.value)); bar.append(ambient);
    V.tileLab = E('span', { class: 'anim-speed', 'data-anim': 'tile-status', 'aria-live': 'off' }); bar.append(V.tileLab);
    for (const [k, txt, title] of CLASSES) btn('c-' + k, title, () => setDV(ui, k, !info().o[k]), txt);
    // random scenery: the seed (same seed = same road), how dense, and the US centre line (double solid yellow, or the broken line of a passing zone)
    const sd = E('input', { type: 'number', min: 0, max: 99999, step: 1, 'data-anim': 'seed', 'aria-label': 'Scenery seed', title: 'Seed of the random scenery: the same number gives the same road', class: 'anim-seed' }); sd.addEventListener('change', () => setDV(ui, 'seed', Math.max(0, Math.min(99999, Math.round(+sd.value || 0)))));
    const dice = btn('dice', 'A new random seed', () => setDV(ui, 'seed', (Date.now() * 2654435761 >>> 0) % 100000), '⚄');
    const dn = E('input', { type: 'range', min: 0.5, max: 3, step: 0.5, 'data-anim': 'density', 'aria-label': 'Scenery density', title: 'How much roadside scenery (1 = about the fixed scenery)' }); dn.addEventListener('change', () => setDV(ui, 'density', +dn.value));
    btn('cline', 'US roads: centre line double solid yellow (no passing) or one broken yellow line (passing zone: 3 m line, 9 m gap)', () => setDV(ui, 'cline', info().o.cline === 'broken' ? 'solid' : 'broken'), 'centre');
    bar.append(sd, dice, dn);
    const td = E('input', { type: 'range', min: 0, max: 3, step: 0.5, 'data-anim': 'traffic-density', 'aria-label': 'Traffic density', title: 'Cars per 300 m in each enabled lane. Traffic logic off: oncoming 50 km/h, preceding 40 km/h. On: IDM speeds and signals.' }); td.addEventListener('change', () => setDV(ui, 'trafficDensity', +td.value));
    V.flashLab = E('span', { class: 'anim-speed', 'data-anim': 'flashes' });
    // traffic range: how far away traffic cars are drawn. Pop-in happens at this edge. Lamps, scenery and pedestrians keep CULL (230 m).
    const trRange = E('select', { 'data-anim': 'traffic-range', 'aria-label': 'Traffic range', title: 'How far away traffic cars are drawn. Cars pop in at the edge of this range. Street lamps, scenery and pedestrians keep their own 230 m range.' });
    for (const m of TRAFFIC_RANGES) trRange.append(E('option', { value: m }, m + ' m'));
    trRange.addEventListener('change', () => setDV(ui, 'trafficRange', +trRange.value)); bar.append(trRange);
    // TL2: how far the road light from other cars reaches (it fades out toward this range, so nothing pops), and how many nearest cars cast it.
    const lrRange = E('select', { 'data-anim': 'traffic-light-range', 'aria-label': 'Traffic light range', title: 'How far the road light from other cars reaches. It fades out smoothly toward the edge, so nothing pops. Larger costs more frame time. As far as cars spawn = the traffic range above.' });
    for (const [v, t] of [['150', 'light 150 m'], ['250', 'light 250 m'], ['400', 'light 400 m'], ['cars', 'light as far as cars spawn']]) lrRange.append(E('option', { value: v }, t));
    lrRange.addEventListener('change', () => setDV(ui, 'trafficLightRange', lrRange.value)); bar.append(lrRange);
    const lrCars = E('select', { 'data-anim': 'traffic-nearest', 'aria-label': 'Nearest cars with traffic light', title: 'How many of the nearest cars cast road light. Each car has two lamps. 16 and 32 cost more frame time.' });
    for (const n of ['8', '16', '32']) lrCars.append(E('option', { value: n }, 'nearest ' + n + ' cars'));
    lrCars.addEventListener('change', () => setDV(ui, 'trafficNearest', lrCars.value)); bar.append(lrCars);
    // BT: the traffic beam shuffle, and a checklist of the saved low beams that may be used in traffic (all ticked by default)
    V.shuf = E('select', { 'data-anim': 'traffic-shuffle', 'aria-label': 'Traffic beams', title: SHUFFLE_TIP });
    V.shuf.append(E('option', { value: 'off' }, 'traffic beams: built-in'), E('option', { value: 'library' }, 'traffic beams: library shuffle'));
    V.shuf.addEventListener('change', () => setDV(ui, 'trafficShuffle', V.shuf.value));
    V.trafficList = E('details', { class: 'beam-manager', 'data-anim': 'traffic-beam-list' }, E('summary', {}, 'use in traffic'));
    V.trafficList.addEventListener('change', () => setDV(ui, 'trafficOutIds', [...V.trafficList.querySelectorAll('input[type=checkbox]')].filter(c => !c.checked).map(c => c.dataset.id)));
    bar.append(V.shuf, V.trafficList);
    // SF2 gain: log-scale slider (2^v, 0.25 to 4). Table lookup only; never rebuilds the table.
    const gs = E('input', { type: 'range', min: -2, max: 2, step: 0.25, 'data-anim': 'scatter-gain', 'aria-label': 'Air beam gain (table mode)', title: 'Multiplies the table lookup (air beam table mode only). 1 = as computed; log scale, 0.25 to 4. Does not rebuild the table.' });
    gs.addEventListener('change', () => setDV(ui, 'scatterGain', Math.pow(2, +gs.value)));
    bar.append(E('span', { class: 'anim-speed' }, 'traffic'), td, V.flashLab);
    (ui.haloAdvBody || bar).append(gs); V.scatGainEl = gs;   // HDX7: the air beam gain joins the advanced halo group (same element, same id-less data-anim)
    btn('reset-flashes', 'Start the count again (each driver counts once above 1 lx at their eye)', () => { V.flash = flashState(); V.flashLab.textContent = 'oncoming drivers above 1 lx: 0'; }, 'reset count');
    // BA2 own beams: the low beam (our design, or a saved low beam; a saved LOW beam also changes symmetric-mode traffic) and
    // the high beam (generic, or a saved high beam that replaces the generic one when the high switch is on).
    const ownLow = E('select', { 'data-anim': 'own-low', 'aria-label': 'Own low beam', title: 'Our low beam: our design, or a saved low beam from the library. A saved LOW beam also changes symmetric-mode traffic, since oncoming cars carry our low table.' });
    const ownHigh = E('select', { 'data-anim': 'own-high', 'aria-label': 'Own high beam', title: 'Our high beam when the high switch is on: the generic high beam, or a saved high beam from the library (it is added to our low beam).' });
    const renderTrafficList = () => {
      const out = info() && Array.isArray(info().o.trafficOutIds) ? info().o.trafficOutIds : [];
      V.trafficList.replaceChildren(E('summary', {}, 'use in traffic'), ...libLoad().filter(e => e.beamKind === 'low').map(e => E('label', {}, E('input', { type: 'checkbox', checked: !out.includes(e.id), 'data-id': e.id }), ' ' + beamLabel(e))));
    };
    const fillOwn = () => {
      const keep = { l: info() && info().o.ownLow, h: info() && info().o.ownHigh };
      ownLow.replaceChildren(E('option', { value: 'design' }, 'our design'), ...libAll().filter(e => e.beamKind === 'low').map(e => E('option', { value: e.id }, beamLabel(e))));
      ownHigh.replaceChildren(E('option', { value: 'generic' }, 'generic high'), ...libAll().filter(e => e.beamKind === 'high').map(e => E('option', { value: e.id }, beamLabel(e))));
      if (String(keep.l || '').startsWith('builtin:') || String(keep.h || '').startsWith('builtin:')) ensureBuiltins();
      ownLow.value = libFind(keep.l, 'low') || keep.l === 'design' || !keep.l ? (keep.l || 'design') : 'design';
      ownHigh.value = libFind(keep.h, 'high') || keep.h === 'generic' || !keep.h ? (keep.h || 'generic') : 'generic';
      renderTrafficList();
      renderManager();
    };
    ownLow.addEventListener('change', () => setDV(ui, 'ownLow', ownLow.value)); ownHigh.addEventListener('change', () => setDV(ui, 'ownHigh', ownHigh.value));
    for (const sel of [ownLow, ownHigh]) { sel.addEventListener('mousedown', ensureBuiltins); sel.addEventListener('focus', ensureBuiltins); }
    const fileIn = E('input', { type: 'file', accept: '.json,application/json', 'data-anim': 'beam-file', 'aria-label': 'Import beam file (single beam or bundle)', hidden: '' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
      try { libAdd(RF.Beams.readFile(JSON.parse(await fileToText(f))).map(gridBeam)); fillOwn(); }
      catch (e) { LIB.msg = 'Import failed: ' + (e && e.message ? e.message : e); }
      V.beamMsg.textContent = LIB.msg;
    });
    V.beamMsg = E('span', { class: 'anim-speed', 'data-anim': 'beam-status', 'aria-live': 'polite' });
    // BB1: the name is typed here (empty = the default shown as the placeholder); a name already taken gets a counter
    const nameIn = E('input', { type: 'text', maxlength: '80', 'data-anim': 'beam-name', 'aria-label': 'Name for the beam to save', title: 'Name for the beam you save. Empty uses the default shown. A name already in the library gets a number added.', placeholder: 'our design' });
    V.nameIn = nameIn; bar.append(nameIn);
    // BI2: the grid a saved design is stored on. 0.25 deg is the default (flux within 0.0 %, peak within 1.6 %, test points about 1 %
    // of the solved table); imported files keep their own grid unless this select is changed by hand
    const gridSel = E('select', { 'data-anim': 'save-grid', 'aria-label': 'Grid of the beam to save', title: 'Grid of a saved design. As solved keeps the full table. 0.25 deg is the default. Imported files keep their own grid unless you change this.' },
      E('option', { value: 'solved' }, 'as solved'), E('option', { value: '0.25' }, '0.25 deg'), E('option', { value: '0.5' }, '0.5 deg'));
    gridSel.value = '0.25';
    gridSel.addEventListener('change', () => { gridSel.dataset.touched = '1'; });
    bar.append(gridSel);
    // an imported beam takes the grid picked here only once the select has been changed by hand
    const gridBeam = (b) => (gridSel.dataset.touched === '1' ? RF.Beams.fromLut(gridTo(RF.Beams.toLut(b), +gridSel.value), { name: b.name, beamKind: b.beamKind, conv: b.conv, colour: b.colour }) : b);
    btn('save-design', 'Save our design as a beam in the library (a low beam, with the design\'s convention)', () => {
      const I = info(), name = RF.Beams.uniqueName(nameIn.value || beamDefaultName(I), libLoad().map(e => e.name));
      libAdd([RF.Beams.fromLut(gridTo(I.lut(), +gridSel.value), { name, beamKind: 'low', conv: I.conv || 'A', colour: sourceColour(I) })]); nameIn.value = ''; fillOwn(); V.beamMsg.textContent = LIB.msg;
    }, 'save design');
    btn('import-beam', 'Import a beam file: one beam, or a bundle of several. Beams join the library.', () => fileIn.click(), 'import');
    btn('export-beams', 'Download the library as a beam file: one beam, or a bundle when there are several', () => {
      const items = libLoad(); if (!items.length) { V.beamMsg.textContent = 'The library is empty: save a design or import a file first.'; return; }
      const parsed = items.map(e => RF.Beams.fromLut(e.lut, { name: e.name, beamKind: e.beamKind, conv: e.conv, colour: e.colour || undefined }));
      const obj = parsed.length === 1 ? RF.Beams.serialise(parsed[0]) : RF.Beams.bundle(parsed, { name: 'beam library' });
      downloadBeams(obj, parsed.length === 1 ? 'beam.json' : 'beams.json'); V.beamMsg.textContent = 'Downloaded ' + parsed.length + ' beam' + (parsed.length === 1 ? '' : 's') + '.';
    }, 'export');
    V.fillOwn = () => { fillOwn(); V.libVer = LIB.ver; }; V.fillOwn();
    bar.append(E('span', { class: 'anim-speed' }, 'beam'), ownLow, ownHigh, fileIn, V.beamMsg);
    // BB2 library manager: one row per saved beam (rename, delete), and clear all (two clicks)
    V.setOwn = (k, v) => setDV(ui, k, v);
    V.mgr = E('details', { class: 'beam-manager', 'data-anim': 'beam-manager', style: 'flex-basis:100%' }, E('summary', {}, 'library'));
    V.mgr.addEventListener('toggle', () => { if (V.mgr.open) ensureBuiltins(); });
    bar.append(V.mgr); renderManager();
    V.bar = bar; return bar;
  }
  // BB2: the library rows. Rename and delete change the library in memory first and then the stored copy; a failed store says so.
  function renderManager() {
    const box = V.mgr; if (!box) return;
    const items = libLoad(), o = info() ? info().o : {};
    const rows = items.map((e) => {
      const nm = E('input', { type: 'text', maxlength: '80', 'data-anim': 'beam-row-name', 'aria-label': 'Name of this beam', value: e.name });
      const ren = E('button', { type: 'button', class: 'toggle', 'data-anim': 'beam-rename', title: 'Rename this beam' }, 'rename');
      ren.addEventListener('click', () => {
        const others = items.filter(x => x.id !== e.id).map(x => x.name);
        try { RF.Beams.renameIn(items, e.id, nm.value); e.name = RF.Beams.uniqueName(e.name, others); libUpdate(e, 'Renamed to "' + e.name + '".'); }
        catch (err) { LIB.msg = 'Rename failed: ' + err.message; }
        V.fillOwn(); V.beamMsg.textContent = LIB.msg;
      });
      const del = E('button', { type: 'button', class: 'toggle', 'data-anim': 'beam-delete', title: 'Remove this beam from the library' }, 'delete');
      del.addEventListener('click', () => {
        const wasLow = o.ownLow === e.id, wasHigh = o.ownHigh === e.id;
        LIB.items = RF.Beams.removeIn(items, e.id); LIB.ver++;
        if (wasLow) V.setOwn('ownLow', 'design'); if (wasHigh) V.setOwn('ownHigh', 'generic');
        const gone = 'Deleted "' + e.name + '".' + (wasLow ? ' It was the low beam in use: our design is selected now.' : '') + (wasHigh ? ' It was the high beam in use: generic high is selected now.' : '');
        libSay(gone); V.fillOwn();
        libDrop(e.id).then((stored) => { libSay(gone + (stored ? '' : ' Browser storage refused the update, so it may come back on reload.')); V.fillOwn(); });
      });
      const size = 'grid ' + e.lut.step + ' deg, ' + (e.lut.nh * e.lut.step).toFixed(0) + ' x ' + (e.lut.nv * e.lut.step).toFixed(0) + ' deg, ' + (e.lut.data.byteLength / 1e6).toFixed(2) + ' MB';
      const cl = RF.Beams.colourLabel(e.colour);
      const colourCell = E('span', { class: 'anim-speed', 'data-anim': 'beam-colour' }, cl || 'colour: from current source');
      const cells = [nm, E('span', { class: 'anim-speed' }, e.beamKind), E('span', { class: 'anim-speed' }, size), colourCell, E('span', { class: 'anim-speed' }, e.persisted ? (e.coarse ? 'saved, coarse' : 'saved') : 'session'), ren, del];
      if (!(e.colour && Number.isFinite(e.colour.cct))) {   // no kelvin (none, or rgb only): a kelvin can be set here, and the tint then travels with the beam
        const kIn = E('input', { type: 'number', min: '1000', max: '20000', step: '100', placeholder: 'K', 'data-anim': 'beam-row-cct', 'aria-label': 'Colour temperature for this beam, kelvin' });
        const kBtn = E('button', { type: 'button', class: 'toggle', 'data-anim': 'beam-set-cct', title: 'Give this beam a colour temperature (1000 to 20000 K)' }, 'set K');
        kBtn.addEventListener('click', () => {
          const v = +kIn.value;
          if (!(v >= 1000 && v <= 20000)) { LIB.msg = 'Colour needs a temperature from 1000 to 20000 K.'; V.beamMsg.textContent = LIB.msg; return; }
          e.colour = { cct: v, rgb: RF.CCT.cctToRGB(v) }; LIB.ver++;
          // a beam in use is picked again, so the picture is rebuilt with its new tint (the same path a select takes)
          const cur = info() ? info().o : {};
          if (cur.ownLow === e.id) V.setOwn('ownLow', e.id);
          if (cur.ownHigh === e.id) V.setOwn('ownHigh', e.id);
          libUpdate(e, 'Set "' + e.name + '" to ' + Math.round(v) + ' K.');
          V.fillOwn(); V.beamMsg.textContent = LIB.msg;
        });
        cells.push(kIn, kBtn);
      }
      return E('div', { class: 'beam-row', 'data-id': e.id }, ...cells);
    });
    const clr = E('button', { type: 'button', class: 'toggle', 'data-anim': 'beam-clear-all', title: 'Remove every beam from the library (asks twice)' }, items.length ? (V.clearArmed ? 'confirm: remove all ' + items.length : 'clear all') : 'library empty');
    clr.disabled = !items.length;
    clr.addEventListener('click', () => {
      if (!V.clearArmed) { V.clearArmed = true; renderManager(); return; }
      V.clearArmed = false; const n = items.length; LIB.items = []; LIB.ver++;
      V.setOwn('ownLow', 'design'); V.setOwn('ownHigh', 'generic');
      const gone = 'Removed ' + n + ' beam' + (n === 1 ? '' : 's') + ' from the library; our design and generic high are selected.';
      libSay(gone); V.fillOwn();
      libDrop().then((stored) => { libSay(gone + (stored ? '' : ' Browser storage refused the update, so they may come back on reload.')); V.fillOwn(); });
    });
    const bstate = LIB.biState === 'loading' ? 'built-in samples: loading...' : LIB.biState === 'unavailable' ? 'built-in samples unavailable' : '';
    const bRows = LIB.builtins.map((e) => {
      const cp = E('button', { type: 'button', class: 'toggle', 'data-anim': 'beam-copy', title: 'Copy this built-in beam into your library (a full-resolution copy you can rename or delete)' }, 'copy to my library');
      cp.addEventListener('click', () => { libAdd([RF.Beams.fromLut(e.lut, { name: RF.Beams.uniqueName(e.name, libLoad().map(x => x.name)), beamKind: e.beamKind, conv: e.conv, colour: e.colour || undefined })]); });
      return E('div', { class: 'beam-row builtin-row', 'data-builtin': e.id },
        E('span', { class: 'anim-speed' }, e.name), E('span', { class: 'anim-speed' }, 'built-in ' + e.beamKind),
        E('span', { class: 'anim-speed' }, 'grid ' + e.lut.step + ' deg, ' + (e.lut.nh * e.lut.step).toFixed(0) + ' x ' + (e.lut.nv * e.lut.step).toFixed(0) + ' deg'),
        E('span', { class: 'anim-speed' }, RF.Beams.colourLabel(e.colour) || 'colour: from current source'), cp);
    });
    box.replaceChildren(E('summary', {}, 'library (' + items.length + ')'), ...bRows, ...(bstate ? [E('span', { class: 'anim-speed', 'data-anim': 'builtin-status' }, bstate)] : []), ...(rows.length ? rows : [E('span', { class: 'anim-speed' }, 'No saved beams yet. Save a design, or import a file.')]), E('div', { class: 'beam-row' }, clr));
    const sto = E('span', { class: 'anim-speed', 'data-anim': 'beam-storage', title: 'Clearing this site\'s data deletes the library. Export to a file is the backup.' }, 'storage: checking...');
    box.append(sto); libStorageText().then((t) => { sto.textContent = t; }, () => { sto.textContent = 'storage: unknown'; });
  }
  function flashText() { if (V.flashLab) V.flashLab.textContent = 'oncoming drivers above 1 lx: ' + (V.flash ? V.flash.n : 0); }
  function flashLabel(dist, t) {
    if (!V.flash) V.flash = flashState();
    countFlashes(V.flash, V.p, dist, t); flashText();
    speedLabel(V.ui);
    if (V.tileLab && V.src.tiles) { const tile = V.src.tiles.mountain ? RF.Touge.tile(0,Math.floor(dist/TILE_LEN)) : roadTile(V.src.tiles.seed, Math.floor(dist / TILE_LEN)); V.tileLab.textContent = (V.src.tiles.mountain ? 'Mountain pass · ' + (100*RF.Touge.profile(dist).grade).toFixed(1) + '% · ' : '') + tile.kind + (['intersection', 't-junction'].includes(tile.kind) ? ' · ' + signalState(tile, t).lit : ''); }
  }
  function topButtons(ui, tb, setDV) {
    if (tb.querySelector('[data-game="toggle"]')) return;
    const tiles = E('button', { type: 'button', class: 'toggle', 'data-anim': 'tiles', title: 'Seeded route: straights, bends, intersections, T-junctions and lit urban sections. Off = the original constant road. Animation only; traces at 640 × 360.' }, 'tiles');
    tiles.addEventListener('click', () => setDV(ui, 'tiles', !info().o.tiles));
    const game = E('button', { type: 'button', class: 'toggle', 'data-game': 'toggle', 'aria-pressed': 'false', title: 'Reach > uniformity: five hazards, hold Space or Brake. Game scoring, not legal advice.' }, 'Game');
    game.addEventListener('click', () => toggleGame(ui));
    const primary = tb.querySelector('.drive-primary'); primary.querySelector('.drive-speed') ? primary.querySelector('.drive-speed').after(game) : primary.querySelector('[data-dv=scene]').after(game);
    ui.driveExtras.append(tiles);
  }
  function speedLabel(ui) {
    if (!ui.driveBar) return;
    const st = S(ui), o = info().o, lab = ui.driveBar.querySelector('[data-anim=speedlab]');
    if (!lab) return;
    const actual = st.camera && (o.trafficLogic || o.mountainPass) && st.view === 'anim' ? st.camera.v * 3.6 : o.speed;
    lab.textContent = o.speed + ' km/h' + (Math.abs(actual - o.speed) >= 0.5 ? ' · actual ' + actual.toFixed(1) + ' km/h' : '');
  }
  // the high-beam switch: V.high is the live state; the minigame's game object follows it so a hazard resolves with the switch as it is then
  // The high-beam switch cycles Off, On, Auto. V.high is always the beam as lit now (the LUT and the minigame read it);
  // V.highMode is the driver's choice. In Auto, autoTick flips V.high once per frame from the camera sensor.
  const HIGH_MODES = ['off', 'on', 'auto'];
  function cycleHigh(ui) { setHighMode(ui, HIGH_MODES[(HIGH_MODES.indexOf(V.highMode || 'off') + 1) % HIGH_MODES.length]); }
  function setHighMode(ui, mode) {
    V.highMode = mode; V.high = mode !== 'off'; V.autoT = undefined; V.autoSt = { high: V.high, timer: 0, reason: 'clear' }; V.autoShown = null;
    const g = S(ui).game; if (g) g.highBeam = V.high;
    labels(ui); ui.redrawSpec();
  }
  // Camera-sensor inputs for Auto: the same objects frameSources traces glare from, so the sensor sees what the frame shows.
  function autoSense(p, dist, t) {
    if (p.touge) { const w = RF.Touge.world(p, dist, t), E = eyeOf(p); return D.autoHighSense(w.objects, E, { occluders: w.objects, lane: p.lane, blocked: (pos) => RF.Touge.blocked(w.A, E, pos) }); }
    const tauOf = tauFor(V.act, t), occ = p.src.tiles ? tileWorld(p, dist, t, tauOf).objects : placedObjects(p, dist, t, tauOf);
    const A = p.src.tiles ? (p.src.tiles.mountain ? RF.Touge.route(dist, p.lane, false) : tileRoute(p.src.tiles.seed, dist)) : p.A;
    return D.autoHighSense(trafficObjects(p.src, trafficCars(p.src, dist, t), A, Object.assign({}, p, { A })), eyeOf(p), { occluders: occ, lane: p.lane });
  }
  // the sensor's road input: the current tile is an urban tile (junctions do not count). The mountain pass has no
  // urban tiles, and its seed would otherwise be read through the default road generator, so the pass is excluded.
  function autoUrban(seed, dist) { return roadTile(seed, Math.floor(dist / TILE_LEN)).kind === 'urban'; }
  function autoUrbanInput(src, dist) { return !!(src && src.tiles && !src.tiles.mountain && autoUrban(src.tiles.seed, dist)); }
  // the sensor's speed: the actual car speed when the camera runs (traffic logic, pass); the slider is only the fallback
  function autoSpeedKmh(st, slider) { return st.camera ? st.camera.v * 3.6 : (+slider || 50); }
  // One Auto step per frame, on the sim clock (st.t). Flips the beam only on a change; the readout is refreshed only then.
  function autoTick(ui, st) {
    const A = V.autoSt || (V.autoSt = { high: true, timer: 0, reason: 'clear' }), o = info().o, p = V.p;
    const dt = V.autoT === undefined ? 0 : Math.min(1, Math.max(0, st.t - V.autoT)); V.autoT = st.t;
    const sense = autoSense(p, st.dist, st.t);
    D.autoHighStep(A, { oncoming: sense.oncoming, preceding: sense.preceding, urban: autoUrbanInput(p.src, st.dist), speedKmh: autoSpeedKmh(st, o.speed) }, dt, { hold: D.AUTO.hold });
    const flipped = A.high !== V.high;
    if (flipped) { V.high = A.high; if (st.game) st.game.highBeam = V.high; prepare(layout()); }
    if (flipped || A.reason !== V.autoShown) { V.autoShown = A.reason; labels(ui); }
  }
  function labels(ui) {
    const st = S(ui), I = info(), o = I.o, sup = supported(o), q = (s) => document.querySelectorAll(s);
    for (const b of q('[data-anim="popout"]')) { const label = st.popout ? 'Close large view' : 'Large view'; b.setAttribute('aria-pressed', String(st.popout)); b.setAttribute('aria-label', label); b.title = label; b.disabled = !sup; b.textContent = st.popout ? '⤡' : '⤢'; }
    for (const b of q('[data-anim="tiles"]')) b.setAttribute('aria-pressed', String(!!o.tiles));
    if (!V.bar) return;
    V.bar.querySelector('[data-anim=deer-behaviour]').setAttribute('aria-pressed', String(D.Models.deerEnabled(o)));
    const hb = V.bar.querySelector('[data-anim="high-beam"]'), mode = V.highMode || 'off';
    hb.setAttribute('aria-pressed', String(!!V.high)); hb.dataset.state = mode;
    hb.textContent = mode === 'auto' ? 'high beam: auto (' + (V.autoSt ? V.autoSt.reason : 'clear') + ')' : 'high beam: ' + mode;
    for (const [name, key] of [['leafy-foliage', 'leafyFoliage'],['detailed-models', 'detailedModels'], ['traffic-beams', 'trafficBeams'], ['surface-sheen', 'surfaceSheen'], ['lamp-pitch', 'lampPitch'], ['afs', 'afs'], ['cornering-lamps', 'corneringLamps'], ['gpu-renderer', 'gpuRenderer'], ['fps-counter', 'fpsCounter'], ['debug-timings', 'debugTimings'], ['scene-details', 'sceneDetails'], ['dynamic-resolution', 'dynamicResolution']]) V.bar.querySelector('[data-anim="' + name + '"]').setAttribute('aria-pressed', String(!!o[key] && !(key === 'gpuRenderer' && V.gpuFailure)));      // ON but failed shows as off: the CPU is drawing
    V.bar.querySelector('[data-anim="gpu-renderer"]').toggleAttribute('data-failed', !!(o.gpuRenderer && V.gpuFailure));
    V.bar.querySelector('[data-anim="resolution"]').value = o.simCeiling in SIM_CEILINGS ? o.simCeiling : 'high';
    V.bar.querySelector('[data-anim="min-fps"]').value = String(fpsSettings(o).minFps);
    if (V.perfLab) { V.perfLab.hidden = !o.debugTimings || !(st.view === 'anim' || st.popout); V.fpsLab.hidden = !o.fpsCounter || !(st.view === 'anim' || st.popout); perfLabel(); }
    for (const [name, key] of [['fit-controls', 'fitControls'], ['large-card', 'largeCard']]) V.bar.querySelector('[data-anim="' + name + '"]').setAttribute('aria-pressed', String(o[key] !== false));
    V.bar.hidden = !(sup && (st.view === 'anim' || st.popout));
    const run = st.playing && (st.view === 'anim' || st.popout), pb = ui.driveBar.querySelector('[data-anim="play"]'); pb.textContent = run ? '⏸ Pause' : '▶ Drive'; pb.setAttribute('aria-pressed', String(run));
    ui.driveBar.querySelector('[data-anim="speed"]').value = o.speed; speedLabel(ui);
    for (const [k] of CLASSES) { const b = V.bar.querySelector('[data-anim="c-' + k + '"]'); b.setAttribute('aria-pressed', String(!!o[k])); }
    V.bar.querySelector('[data-anim="traffic-density"]').value = o.trafficDensity === undefined ? 1 : o.trafficDensity;
    V.scatGainEl.value = Math.log2(Math.min(4, Math.max(0.25, +o.scatterGain || 1)));
    V.bar.querySelector('[data-anim="traffic-range"]').value = String(trafficCullOf(o.trafficRange));
    V.bar.querySelector('[data-anim="traffic-light-range"]').value = LIGHT_RANGES.includes(String(o.trafficLightRange)) ? String(o.trafficLightRange) : '150';
    V.bar.querySelector('[data-anim="traffic-nearest"]').value = String(lightCarsOf(o));
    if (V.fillOwn && V.libVer !== LIB.ver) V.fillOwn();
    if (V.shuf) { V.shuf.value = o.trafficShuffle === 'library' ? 'library' : 'off'; V.shuf.title = shuffleTip(o); }
    if (V.trafficList) for (const c of V.trafficList.querySelectorAll('input[type=checkbox]')) c.checked = !(Array.isArray(o.trafficOutIds) && o.trafficOutIds.includes(c.dataset.id));
    if (V.nameIn) V.nameIn.placeholder = beamDefaultName(info());
    if (V.fillOwn) { V.bar.querySelector('[data-anim="own-low"]').value = o.ownLow && o.ownLow !== 'design' && libFind(o.ownLow, 'low') ? o.ownLow : 'design'; V.bar.querySelector('[data-anim="own-high"]').value = o.ownHigh && o.ownHigh !== 'generic' && libFind(o.ownHigh, 'high') ? o.ownHigh : 'generic'; }
    if (V.flashLab) V.flashLab.textContent = 'oncoming drivers above 1 lx: ' + (V.flash ? V.flash.n : 0);
    const trafficOn = o.oncoming || o.preceding;
    if (V.flashLab) V.flashLab.hidden = !trafficOn;
    V.bar.querySelector('[data-anim="reset-flashes"]').hidden = !trafficOn;
    V.bar.querySelector('[data-anim="traffic-logic"]').setAttribute('aria-pressed', String(!!o.trafficLogic));
    V.bar.querySelector('[data-anim="gap"]').setAttribute('aria-pressed', String(o.safeGap !== false)); V.bar.querySelector('[data-anim="gap"]').disabled = !!o.trafficLogic;
    V.bar.querySelector('[data-anim="tile-cache"]').setAttribute('aria-pressed', String(!!o.tileCache)); V.bar.querySelector('[data-anim="tile-cache"]').disabled = !o.tiles;
    V.bar.querySelector('[data-anim="street-lamps"]').value = o.streetLamps || 'sodium'; V.bar.querySelector('[data-anim="street-lamps"]').disabled = !(o.tiles || o.mountainPass);
    if (V.reflSel) V.reflSel.value = RF.Drive.pedMode(o.reflectiveClothing);
    V.bar.querySelector('[data-anim="ambient"]').value = String(o.ambient || 0);
    V.tileLab.hidden = !o.tiles;
    const wd = o.wild && o.scene === 'road';        // forest and city keep their existing scenery
    V.bar.querySelector('[data-anim="seed"]').value = o.seed; V.bar.querySelector('[data-anim="seed"]').disabled = !(wd || trafficOn || o.tiles || (o.leafyFoliage && (o.scene === 'road' || o.scene === 'forest'))); V.bar.querySelector('[data-anim="dice"]').disabled = !(wd || trafficOn || o.tiles || (o.leafyFoliage && (o.scene === 'road' || o.scene === 'forest')));
    V.bar.querySelector('[data-anim="density"]').value = o.density; V.bar.querySelector('[data-anim="density"]').disabled = !(wd || (o.leafyFoliage && (o.scene === 'forest' || o.scene === 'road')));
    const cl = V.bar.querySelector('[data-anim="cline"]'); cl.disabled = !I.us; cl.textContent = o.cline === 'broken' && I.us ? 'centre: broken' : 'centre: solid'; cl.setAttribute('aria-pressed', String(o.cline === 'broken' && I.us));
    cl.title = I.us ? 'US roads: centre line double solid yellow (no passing) or one broken yellow line (passing zone: 3 m line, 9 m gap)' : 'Only on the US presets (the EU presets already have a dashed centre line)';
    for (const k of ['rpm']) V.bar.querySelector('[data-anim="c-' + k + '"]').disabled = false;   // SB1: studs on every scene, the pass included
    const mb = V.bar.querySelector('[data-anim="c-mt"]'); mb.disabled = typeof Worker === 'undefined' || !!Wk.failed; if (Wk.failed) mb.title = V.why;
  }

  // ---------------------------------------------------------------- Reach > uniformity (all state is local to this view)
  // Eurobeat plays only while a run is live, in Mountain pass, with the box ticked. Called from mount() and gameText().
  function musicSync(ui) {
    const m = V.gameMusic; if (!m || !RF.Eurobeat) return;
    const st = S(ui), mountain = !!info().o.mountainPass;
    m.closest('[data-game="music-wrap"]').hidden = !mountain;
    if (st.gameMode && st.game && !st.game.done && st.playing && m.checked && mountain && visible()) RF.Eurobeat.start(); else RF.Eurobeat.stop();
  }
  function toggleGame(ui) {
    const st = S(ui);
    if (st.gameMode) {
      if (V.cardPop && st.popout) closePop(ui);
      stop(); killWorkers(); Object.assign(info().o, st.gameSaved.options); Object.assign(st, st.gameSaved.state);
      st.gameLoad = null; st.gameLamp = null; st.game = null; st.gameMode = false; st.gameOptions = null; V.p.hazardMask = null; V.last = 0; ui.redrawSpec(); V.flash = st.gameSaved.flash; V.src.traffic.state = st.gameSaved.traffic; V.act = st.gameSaved.act; flashText(); if (!st.playing && visible() && st.view === 'anim') frame(); return;
    }
    st.gameSaved = { options: Object.assign({}, info().o), state: { view: st.view, playing: st.playing, dist: st.dist, total: st.total, t: st.t, camera: st.camera }, flash: V.flash, traffic: V.src && V.src.traffic.state, act: new Map(V.act) };
    st.gameMode = true; st.playing = false; st.view = 'anim'; ui.redrawSpec();
  }
  async function startGame(ui) {
    const st = S(ui), box = V.gameBar, speed = +box.querySelector('[data-game="speed"]').value, wet = box.querySelector('[data-game="wet"]').value === 'wet', seedEl = box.querySelector('[data-game="seed"]'), reseedEl = box.querySelector('[data-game=reseed]');
    if (reseedEl && reseedEl.checked) seedEl.value = (Date.now() * 2654435761 >>> 0) % 100000;
    const seed = +seedEl.value;
    if (!(speed >= 5 && speed <= 130) || !Number.isInteger(seed) || seed < 0 || seed > 99999) { V.gameStatus.textContent = 'Choose 5–130 km/h and a whole seed from 0–99999.'; return; }
    const lampName = box.querySelector('[data-game=lamp]').value;
    if (lampName !== 'your') {
      const token = st.gameLoad = {}; V.gameStatus.textContent = 'Tracing starter lamp…'; box.querySelector('[data-game=start]').disabled = true;
      try { const lamp = await RF.StarterLamps.photometry(lampName); if (!st.gameMode || st.gameLoad !== token) return; st.gameLamp = lamp; }
      catch (e) { V.gameStatus.textContent = e.message; return; }
      finally { box.querySelector('[data-game=start]').disabled = false; }
      ui.redrawSpec();
    } else { st.gameLamp = null; ui.redrawSpec(); }
    if (!st.gameLamp && (!ui.spec || !ui.spec.full || !ui.spec.ev || ui.spec.ctx !== (ui.run && ui.run.ctx))) { V.gameStatus.textContent = 'Finish the lamp’s Spec trace before starting.'; return; }
    stop(); killWorkers();
    const lamp = st.gameLamp || ui.spec, lampScene = st.gameLamp ? st.gameLamp.scene : ui.store.scene;
    st.game = RF.DriveGame.create({ seed, speed, wet, acceleration: box.querySelector('[data-game=acceleration]').value, verdict: lamp.ev.verdict, rules: box.querySelector('[data-game=rules]').value, clearLane: box.querySelector('[data-game=clear-lane]').checked, highBeam: !!V.high }); st.game.ctx = lamp.ctx; st.game.judge = lamp.ev; st.game.road = info().rd;
    st.gameOptions = { mountainPass: !!info().o.mountainPass, scene: 'road', tiles: true, wild: true, seed, speed, wet, wetness: wet ? 1 : 0, people: false, animals: false, obstacle: false, trafficLogic: false, oncoming: true, preceding: false };
    // MG2-test: 'symmetric' oncoming lamps carry the PLAYER's design, so a high-reach lamp blinds itself (real GPU, 130 km/h wet: 7in-high first seen 48 m vs default 65 m; with a fixed generic dipped oncoming lamp: 114 m vs 63 m). The lesson needs the lamp under test to be the only variable. Original rules keep the old behaviour.
    if (st.game.rules !== 'legacy') st.gameOptions.onMode = 'generic';
    st.dist = st.total = st.t = 0; st.camera = { x: 0, v: speed / 3.6 }; st.view = 'anim'; st.playing = true;
    V.act.clear(); V.flash = flashState(); V.fkey = ''; V.last = 0; ui.redrawSpec();
  }
  function gameObjects(g, world, lane) {
    const A = world.A, K = D.kit({ Lw: lane || V.p.lane, A: null, rand: () => 0.5, reflectiveClothing: ((info() && info().o) || {}).reflectiveClothing });
    for (const h of g.hazards) if (g.rules !== 'legacy' || !h.resolved) {
      const ps = RF.DriveGame.pose(g, h, g.t, D.Models.deerEnabled(V.p)), first = K.O.length, rel = ps.s - g.x;
      if (h.kind === 'deer') K.deer(rel, ps.off, { face: h.side > 0 ? 1 : -1, gait: ps.gait, motion:ps.motion, attention:ps.attention });
      else K.person(rel, ps.off, h.noHiViz ? 'dark' : 'hivis', { dir: [h.ds, h.doff], gait: ps.gait, motion:ps.motion, id: 'hazard:' + h.id });
      const moved = K.O.slice(first).map(ob => { ob.gameHazard = h.id; return move(Object.assign({}, ob), ob, ob.x, A); });
      world.objects.push(...(A && A.touge ? D.Models.actors(moved,true).map(ob=>RF.Touge.lift(ob,A)) : moved));
    }
    if(V.p && V.p.detailedModels && !(A && A.touge))world.objects=D.Models.actors(world.objects,true);
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
    V.gameStatus.textContent = (g.done ? 'Run ended' : g.resume !== null ? g.clearLane && g.rules !== 'legacy' ? 'Waiting for clear lane · release Brake to resume' : 'Release Brake · cruise resumes after 2 s' : g.brake ? 'BRAKING' : g.acceleration === 'gentle' && g.v < g.speed / 3.6 - .01 ? 'Accelerating gently' : 'Hold Space or Brake') + ' · ' + (g.v * 3.6).toFixed(1) + ' km/h · ' + g.results.length + '/5 resolved';
    V.gameCard.hidden = !g.done;
    if (g.done) {
      V.gameBar.classList.remove('running'); musicSync(V.ui);
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
      const reseed = E('input', { 'data-game': 'reseed', type: 'checkbox', checked: '', title: 'Pick a new random seed every run; untick to replay the same seed' });
      wet.append(E('option', { value: 'dry' }, 'dry'), E('option', { value: 'wet' }, 'wet'));
      const rules = E('select', { 'data-game': 'rules', 'aria-label': 'Hazard rules' });
      rules.append(E('option', { value: 'visible' }, 'Visible hazard'), E('option', { value: 'legacy' }, 'Original rules'));
      const lamp = E('select', { 'data-game': 'lamp', 'aria-label': 'Game lamp' });
      lamp.append(E('option', { value: 'your' }, 'your lamp'), E('option', { value: 'starter-low' }, 'starter low'), E('option', { value: 'starter-high' }, 'starter high'));
      const acceleration = E('select', { 'data-game': 'acceleration', 'aria-label': 'Acceleration after braking' });
      acceleration.append(E('option', { value: 'original' }, 'Recovery · original'), E('option', { value: 'gentle' }, 'Gentle acceleration'));
      const clearLane = E('input', { 'data-game': 'clear-lane', type: 'checkbox', checked: '' });
      const music = E('input', { 'data-game': 'music', type: 'checkbox', 'aria-label': 'Eurobeat music' }), musicWrap = E('span', { 'data-game': 'music-wrap' }, E('label', {}, music, ' ♪ Eurobeat'));
      try { music.checked = root.localStorage.getItem('flux.eurobeat') === '1'; } catch (e) { /* storage blocked: stays off */ }
      music.addEventListener('change', () => { try { root.localStorage.setItem('flux.eurobeat', music.checked ? '1' : '0'); } catch (e) { /* storage blocked: not remembered */ } if (music.checked && RF.Eurobeat) RF.Eurobeat.unlock(); musicSync(ui); });
      V.gameMusic = music;
      const pause = E('button', { type: 'button', 'data-game': 'pause' }, 'Pause');
      pause.addEventListener('click', () => { st.playing = !st.playing; ui.redrawSpec(); });
      const start = E('button', { type: 'button', 'data-game': 'start' }, 'Start run'), brake = E('button', { type: 'button', 'data-game': 'brake', 'aria-label': 'Hold to brake', 'aria-pressed': 'false' }, 'Hold: BRAKE');
      start.addEventListener('click', () => { if (music.checked && RF.Eurobeat) RF.Eurobeat.unlock(); startGame(ui); });
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
      box.append(E('strong', {}, 'REACH > UNIFORMITY · game'), E('div', { class: 'game-setup' }, E('label', {}, 'km/h ', speed), wet, E('label', {}, 'seed ', seed), E('label', {}, reseed, ' new each run'), lamp, acceleration, rules, E('label', {}, clearLane, ' Wait for clear lane'), musicWrap, start, exit, pause, brake), V.gameStatus, V.gameCard, E('small', {}, 'Five hazards. Hold to brake; release to recover with the chosen acceleration. After a stop, hazards leave the road before recovery (at least 2 s). Gentle acceleration returns to speed at 2.5 m/s². Uncheck Wait for clear lane or choose Original rules for the previous resume. Game flavour, not legal advice.'));
      V.cv.parentElement.append(box); speed.value = info().o.speed; seed.value = info().o.seed; wet.value = D.wetnessOf(info().o) > 0 ? 'wet' : 'dry';
    }
    if (V.notice) V.notice.hidden = !V.why || (st.gameMode && !V.lost);
    V.gameBar.hidden = !st.gameMode; V.gameBar.classList.toggle('running', !!st.game && !st.game.done); mount(ui);
    if (st.gameMode) V.bar.hidden = true;
    musicSync(ui);
    const toggle = info().toolbar.querySelector('[data-game="toggle"]'); if (toggle) { toggle.setAttribute('aria-pressed', String(!!st.gameMode)); toggle.textContent = st.gameMode ? 'Exit game' : 'Game'; }
    // Freeze run inputs and the underlying toolbar; exit restores the owner's preferences in memory.
    for (const bar of [V.bar, ui.driveBar, ui.driveExtras]) if (bar) for (const e of bar.querySelectorAll('button,input,select')) {
      if (e.matches('[data-game="toggle"],[data-anim="popout"],[data-anim="play"]')) continue;
      if (st.gameMode) { if (e.dataset.gameWasDisabled === undefined) e.dataset.gameWasDisabled = String(e.disabled); e.disabled = true; }
      else if (e.dataset.gameWasDisabled !== undefined) { e.disabled = e.dataset.gameWasDisabled === 'true'; delete e.dataset.gameWasDisabled; }
    }
    for (const e of V.gameBar.querySelectorAll('input:not([data-game=music]),select')) e.disabled = !!st.game && !st.game.done;
    V.gameBar.querySelector('[data-game="brake"]').hidden = !st.game || st.game.done;
    V.gameBar.querySelector('[data-game="pause"]').hidden = !st.game || st.game.done;
    V.gameBar.querySelector('[data-game="pause"]').textContent = st.playing ? 'Pause' : 'Resume';
    V.gameBar.querySelector('[data-game="start"]').hidden = !!st.game && !st.game.done;
    V.gameBar.querySelector('[data-game="exit"]').hidden = !!st.game && !st.game.done;
    if (st.game) {
      if (!st.playing && !st.game.done && st.game.pauseAt === undefined) { st.game.pauseAt = performance.now(); if (st.game.inputs) st.game.inputs.clear(); RF.DriveGame.press(st.game, false, performance.now()); }
      if (st.game.ctx !== (st.gameLamp ? st.gameLamp.ctx : ui.run && ui.run.ctx) || st.game.judge !== (st.gameLamp ? st.gameLamp.ev : ui.spec && ui.spec.ev) || st.game.road !== info().rd) { st.game.done = true; st.game.reason = 'Lamp changed; start a new run'; st.playing = false; }
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
    st.popout = true;          // opening/closing preserves the current playback state
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
    tableStripClear(); if (V.three) { V.three.dispose(); V.three = null; }
    // CPU-FALLBACK-PAUSE: a failure while the owner wanted the GPU and the sim was driving stops the sim, so the slower CPU never animates unasked. Deliberate CPU (gpuRenderer off) never reaches here.
    const st = V.ui && S(V.ui), pause = !!(st && st.playing) && !!(V.info && info().o.gpuRenderer);
    V.gkey = ''; V.gpuFailure = String(why);
    if (pause) { st.playing = false; stop(); const game = st.game; if (game && !game.done) { game.pauseAt = performance.now(); if (game.inputs) game.inputs.clear(); RF.DriveGame.press(game, false, performance.now()); } }
    V.gpuNote = 'GPU drive unavailable (' + V.gpuFailure.split('\n')[0].slice(0, 160) + '); using CPU renderer.';
    say(V.gpuNote + (pause ? ' Paused: press Drive to continue on the slower CPU renderer.' : ''));
    if (V.bar) labels(V.ui);
  }
  function gpuCreate() {                                      // first build, and the rebuild after a context restore: a few tries, then the visible CPU fallback
    try { V.three = threeModule.create(V.canvas, V.gl.gl, () => { if(V.three && V.three.modelState().error)say('Detailed car assets unavailable; using primitive cars.'); if (V.ui) V.ui.redrawSpec(); }); V.gkey = ''; V.gpuTries = 0; killWorkers(); tlMark('three renderer created'); }
    catch (e) {
      if ((V.gpuTries = (V.gpuTries || 0) + 1) >= 3) { V.gpuTries = 0; gpuFallback(e.message || e); return; }
      clearTimeout(V.gpuRetry); V.gpuRetry = setTimeout(() => { V.gpuRetry = 0; if (V.ui && V.info && info().o.gpuRenderer && !V.three && !V.lost) V.ui.redrawSpec(); }, 250 * V.gpuTries);
    }
  }
  function gpuRenderer() {
    if (!info().o.gpuRenderer) { if (V.three) { V.three.dispose(); V.three = null; V.gkey = ''; } if (V.gpuFailure) { V.gpuFailure = ''; say(''); if (V.bar) labels(V.ui); } return; }
    if (V.three || V.gpuFailure) return;
    if (root.location && root.location.protocol === 'file:') { gpuFallback('ES modules need HTTP'); return; }
    if (threeModule) { if (!V.gpuRetry) gpuCreate(); return; }
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
    if (!supported(I.o)) { if (st.popout) closePop(ui); st.playing = false; }
    labels(ui); gameControls(ui);
    const want = supported(I.o) && (st.view === 'anim' || st.popout);
    detailsSync(want);
    if (!want) { stop(); killWorkers(); if (V.canvas) V.canvas.hidden = true; return; }
    if (V.lost && !V.glFailed) { stop(); return; }
    if (!ensureCanvas()) { st.playing = false; if (V.canvas) V.canvas.hidden = true; if (st.popout) closePop(ui); labels(ui); return; }
    V.canvas.hidden = false; mount(ui);
    if (!visible()) { stop(); return; }
    try {
      gpuRenderer();
      const sz = layout();
      if (I.o.expMode === 'auto' && I.tm) { const ak = I.groundKey + '|' + I.o.ev; if (!V.kAuto || V.autoKey !== ak) { V.kAuto = I.tm.k; V.autoKey = ak; } } else V.kAuto = null;      // auto exposure would flicker as the scene moves: frozen at the still picture's
      prepare(sz);
      if (I.o.mountainPass && !V.three && !V.gpuFailure) say('Mountain pass: CPU fallback stays flat; enable GPU drive renderer for elevation.');
      else if (I.o.mountainPass && V.three && !V.gpuFailure) { if (V.why && V.why.startsWith('Mountain pass')) say(''); protoNote(true); }   // clears a stale CPU-fallback line from before the GPU came up
      else { protoNote(false); if (V.why && V.why.startsWith('Mountain pass')) say(''); }
      if (st.playing && mt()) workerCfg();      // playing on the workers: the loop draws the next frame
      else frame();
      if (st.playing) go(); else stop();
    } catch (e) {
      if (!recovery()) throw e;
      if (V.gl.gl.isContextLost()) contextLost({ preventDefault() {} });
      else contextFallback('Drive graphics failed: ' + (e.message || e));
    }
  }
  // ---------------------------------------------------------------- scene details (the overlay; the registry is js/scene-details.js)
  // Off costs nothing: no timer, no DOM. On: a panel refreshed about 4 times a second from a snapshot. The snapshot only READS the drive
  // state (no traffic advance, no scenery activation, no draw), so turning the panel on cannot change the next frame.
  const DETAIL_MS = 250, DEG = Math.PI / 180;
  const detailsOn = () => !!(V.info && V.info.o.sceneDetails);
  // the direction from our lamps (their mean position) to the driver's eye at car, eye 1.1 m up as eyeLux has it
  function driverDir(p, car) {
    const q = p.A ? p.A.at(car.rel, car.off) : { p: [car.rel, car.off] }; let x = 0, y = 0, z = 0;
    for (const L of p.lamps) { x += L[0]; y += L[1]; z += L[2]; }
    const n = p.lamps.length || 1;
    return [q.p[0] - x / n, q.p[1] - y / n, 1.1 - z / n];
  }
  // Peaks: one lux per oncoming car per drawn frame while the overlay is on (cheap), and at each tick. A new scene or a seek back
  // more than 50 m starts them again. Reads V.flash (set by countFlashes this frame), so it draws nothing and advances nothing.
  function detailsSample() {
    const f = V.flash; if (!f || !f.cars || !f.p) return;
    const dist = S(V.ui).dist;
    if (!V.peaks || V.peaksSrc !== V.src || (V.peaksDist !== undefined && dist < V.peaksDist - 50)) V.peaks = new Map();
    V.peaksSrc = V.src; V.peaksDist = dist;
    RF.SceneDetails.samplePeaks(V.peaks, f.cars.filter((c) => c.kind === 'oncoming'), (c) => eyeLux(f.p, c));
  }
  function detailState() {
    const I = info(), o = I.o, st = S(V.ui), src = V.src, p = V.p, dist = st.dist, M = RF.SceneDetails;
    const pass = !!(p && p.touge), kHere = curvatureAt(src, dist);
    let tight = 0; for (let x = dist; x <= dist + 100; x += 10) tight = Math.max(tight, Math.abs(curvatureAt(src, x)));
    const f = V.flash, cp = f && f.p ? f.p : p, cars = f && f.cars ? f.cars.filter((c) => c.kind === 'oncoming') : [];
    const oncoming = o.oncoming && cp ? M.oncomingRows(cars, 5, (c) => eyeLux(cp, c), (c) => M.angleDeg([Math.cos(cp.yaw || 0), Math.sin(cp.yaw || 0), 0], driverDir(cp, c)), V.peaks || new Map()) : [];
    const glare = D.glareStrength(D.capGlare(o.glare)) > 0, sources = V.frameGlare || [];
    // hazards: the frame's placed people and deer (not traffic), seen from the driver's eye; occlusion and lit tests use the frame's objects and our beam
    const beamAt = (dx, dy, dz, side) => D.ownBeamAt(p, dx, dy, dz, side), placed = V.framePlaced, objs = placed ? (Array.isArray(placed) ? placed : placed.objects || []) : [];
    const people = !!o.people, animals = !!o.animals, eye = eyeOf(p);
    const hazardList = objs.filter((ob) => !ob.traffic && ((ob.cls === 'person' && people) || (ob.cls === 'deer' && animals)));
    // one actor is several parts (a pedestrian ~4, a deer ~9) sharing a modelId; cylinders carry z0/z1, not z
    const actors = new Map();
    for (const ob of hazardList) { const k = String(ob.modelId ?? ob.id); if (!actors.has(k)) actors.set(k, []); actors.get(k).push({ x: ob.x, y: ob.y, z: ob.z !== undefined ? ob.z : ((ob.z0 || 0) + (ob.z1 || 0)) / 2 }); }
    const hazards = (people || animals) && p ? M.hazardCounts([...actors.values()], { eye, hfov: p.hfov, occludedAt: (P) => D.occluded(P, eye, objs), luxAt: (P) => M.faceLux(p.lamps, beamAt, P, [-1, 0, 0]) }) : null;
    // beam reach: the far edge of the lit stretch on our own lane centre (lateral offset 0: the lamps sit at +-0.7 m, the oncoming lane at lane), where our road illuminance falls below 1 lx (walk to 300 m)
    const reach = p && p.lamps ? M.litEdge((d) => { const q = p.A ? p.A.at(d, 0).p : [d, 0]; return M.roadLux(p.lamps, beamAt, q[0], q[1]) >= 1; }, 1, 300, 1) : null;
    return {
      speedKmh: autoSpeedKmh(st, o.speed),
      highMode: V.highMode || 'off', autoReason: V.autoSt ? V.autoSt.reason : 'clear',
      afs: !!o.afs, afsYawDeg: st.lighting ? st.lighting.yaw / DEG : 0,
      radius: kHere ? 1 / Math.abs(kHere) : Infinity, radius100: tight ? 1 / tight : Infinity,
      pass, gradePct: pass ? 100 * RF.Touge.profile(dist).grade : null, bankPct: pass ? 100 * RF.Touge.bank(dist) : null,
      oncomingOn: !!o.oncoming, oncoming,
      glareOn: glare, glareName: D.glareLevel(D.capGlare(o.glare)), veil: D.veilAt([1, 0, 0], sources), veilTop: M.topSource([1, 0, 0], sources),
      ev: o.ev, white: V.white === undefined ? null : V.white,
      hazardsOn: people || animals, hazards, reach, lamp: 'built-in',
    };
  }
  function detailsSnapshot() {
    const s = detailState(), M = RF.SceneDetails;
    return { t: performance.now(), rows: M.METRICS.map((m) => { const na = m.applies(s), value = na ? null : m.read(s); return { id: m.id, group: m.group, label: m.label, unit: m.unit, na, value, shown: M.display(m, value, na) }; }) };
  }
  function detailsRender(snap) {
    const M = RF.SceneDetails;
    if (!V.detailsEl) {
      const el = E('section', { class: 'drive-details', 'data-anim': 'scene-details-panel', 'aria-label': 'Scene details' });
      let g = null;
      for (const m of M.METRICS) {
        if (!g || g.getAttribute('data-group') !== m.group) { g = E('div', { class: 'dd-group', 'data-group': m.group }, E('div', { class: 'dd-head' }, M.GROUPS[m.group])); el.append(g); }
        g.append(E('div', { class: 'dd-row', 'data-metric': m.id }, E('span', { class: 'dd-label' }, m.label), E('output', { class: 'dd-value' })));
      }
      V.detailsEl = el;
    }
    for (const r of snap.rows) {
      const row = V.detailsEl.querySelector('[data-metric="' + r.id + '"]'); if (!row) continue;
      row.classList.toggle('na', !!r.na); row.title = r.na ? 'Not applicable here: ' + r.na : '';
      row.querySelector('.dd-value').textContent = Array.isArray(r.shown) ? r.shown.join('\n') : r.shown;
    }
  }
  function detailsPause() { if (V.detailsTimer) { clearInterval(V.detailsTimer); V.detailsTimer = 0; } }
  function detailsTick() {
    if (!detailsOn()) { detailsSync(false); return; }
    detailsSample();
    const snap = V.detailsSnap = detailsSnapshot();
    const host = S(V.ui).popout && V.popStage ? V.popStage : V.cv && V.cv.parentElement;
    if (!host) return;
    detailsRender(snap);
    if (V.detailsEl.parentElement !== host) host.append(V.detailsEl);
  }
  // run = the drive view is shown. The timer runs only while the overlay is on AND shown; otherwise it is cleared and the panel removed.
  function detailsSync(run) {
    if (run && detailsOn()) { if (!V.detailsTimer) { V.detailsTimer = setInterval(detailsTick, DETAIL_MS); V.peaks = new Map(); } detailsTick(); return; }
    detailsPause();
    if (V.detailsEl) { V.detailsEl.remove(); V.detailsEl = null; }
    V.detailsSnap = null;
  }
  // the same numbers the panel shows, from the last tick (a copy, so a caller cannot change the snapshot)
  const detailsStats = () => V.detailsSnap ? { t: V.detailsSnap.t, rows: V.detailsSnap.rows.map((r) => Object.assign({}, r)) } : null;

  // a hidden tab stops the loop; showing it again redraws (which restarts it)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (V.ui) { if (document.visibilityState === 'hidden') { stop(); detailsPause(); } else if (V.info) { if (S(V.ui).popout && !popValid(V.ui)) closePop(V.ui); else V.ui.redrawSpec(); } } });

  // ---------------------------------------------------------------- numbers for tests and the report
  const pct = (a, q) => { if (!a || !a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
  function stats() {
    const t = V.times, iv = []; for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]); iv.sort((a, b) => a - b);
    const med = iv.length ? iv[iv.length >> 1] : 0, c = V.cpu;
    const all = V.profiles || [], recent = all.filter((r) => r.at >= (all.length ? all[all.length - 1].at : 0) - 1000);
    return { swivel: V.p && V.p.yaw || 0, cornering: V.p ? [V.p.cornerLeft || 0, V.p.cornerRight || 0] : [0,0], renderer: V.three ? 'three' : 'cpu', mountain: V.p && V.p.touge ? RF.Touge.attitude(S(V.ui).dist) : null, pitch: V.p && V.p.pitch || 0, acceleration: V.ui && S(V.ui).acceleration || 0, gpuFailure: V.gpuFailure || '', profiling: profileOn(), renderScale: V.renderScale || 1, resolution: V.resolution || resolutionState(), simCeiling: simCeiling(V.info && V.info.o), minFps: V.info && V.info.o.minFps || 30, frameTargetMs: V.info && V.info.o.frameTargetMs || 33, breakdown: breakdown(recent), breakdownMean: breakdown(all), lastFrame: all.length ? all[all.length - 1] : null, white: V.white, frames: V.frames, running: !!V.raf, rafMedianMs: med, fps: med ? 1000 / med : 0, p95Ms: iv.length ? iv[Math.floor(iv.length * 0.95)] : 0, cpuObjMs: c.n ? c.obj / c.n : 0, cpuUploadMs: c.n ? c.up / c.n : 0, cpuGlMs: c.n ? c.gl / c.n : 0, sim: V.p && [V.p.w, V.p.h], canvasPx: V.gl && [V.gl.cw, V.gl.ch], groundMs: V.g && V.g.ms, objP95Ms: pct(V.ring, 0.95), objMaxMs: pct(V.ring, 1), workers: Wk.list.length, mtFail: Wk.failed, workerRestarts: Wk.restarts, contextLost: !!V.lost, contextFailed: !!V.glFailed, ss: V.pinSS || ssRule(V.p ? V.p.w : 0) };
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
  // FG: mean and 95th-percentile (worst-5%) frame interval in ms over the last 120 drawn frames. Pure, so tests/fog.js checks it in Node.
  const FRAME_MS_WINDOW = 120, FRAME_GAP_CAP_MS = 1000;   // UX3: an interval above the cap is a pause or a stall, not a frame
  function frameMsSummary(ms) {
    const xs = ms.slice(-FRAME_MS_WINDOW).filter((x) => Number.isFinite(x) && x >= 0);
    if (!xs.length) return { n: 0, mean: 0, p95: 0 };
    const sorted = xs.slice().sort((a, b) => a - b), mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { n: xs.length, mean, p95: sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] };
  }
  // SE1: air-beam table progress in the header strip (ui.progress / ui.setStatus, the strip solver jobs use). drive-three publishes its
  // state on globalThis.SD_SCATTER; this owns the strip. It yields to a solve (ui.solving) and never runs for drag previews (ui.previewRun).
  function tableOn() { return !!(V.info && V.info.o.scatterMode === 'table' && globalThis.SD_SCATTER && globalThis.SD_SCATTER.cache !== undefined); }
  function tableStripClear() {
    const ui = V.ui; if (!V.tableStripOn) return; V.tableStripOn = false;
    if (ui && ui.progress && !ui.solving) { ui.progress('done'); if (V.tableStatusPrev !== undefined) ui.setStatus(V.tableStatusPrev); }
    V.tableStatusPrev = undefined;
  }
  // SN: first-open air deferral. A Drive with the air on (GPU renderer; table mode or traffic halo) draws its first AIR_HOLD_FRAMES frames with
  // the air off, so the first frame paints before the air shaders compile. The last hold frame sets the status; the next frame, which comes
  // after a paint, draws with the air and carries the compile. Off: V.airSeq stays null and V.airHold false, and nothing else changes.
  const AIR_HOLD_FRAMES = 2;
  function airTick() {
    const o = V.info ? V.info.o : {};
    if (!(V.three && (o.scatterMode === 'table' || o.trafficHalo))) { V.airSeq = null; V.airHold = false; return; }
    const n = V.airSeq ? V.airSeq.n + 1 : 1;
    V.airSeq = { n }; V.airHold = n <= AIR_HOLD_FRAMES;
    V.airStatus = n === AIR_HOLD_FRAMES ? 'compiling air-beam shaders…' : 'preparing air beam…';
    if (TL.cur && n <= AIR_HOLD_FRAMES + 1) tlMark(n <= AIR_HOLD_FRAMES ? 'air deferred frame ' + n : 'air beam on');
    // paused: no tick draws the next frame, so the hold continues on its own frame request (one per hold frame, a paint in between)
    if (V.airHold && !S(V.ui).playing) requestAnimationFrame(() => { if (V.three) frame(); });
  }
  function tableStrip() {
    const ui = V.ui, st = globalThis.SD_SCATTER;
    if (!ui || !ui.progress) return;
    if (ui.solving || ui.previewRun) { V.tableStripOn = false; return; }
    if (V.airHold && V.three) {
      if (!V.tableStripOn) V.tableStatusPrev = document.getElementById('progress-text') ? document.getElementById('progress-text').textContent : '';
      V.tableStripOn = true; ui.progress('solve'); ui.setStatus(V.airStatus); return;
    }
    if (!(tableOn() && V.three && st)) { tableStripClear(); return; }
    if (!V.tableStripOn) V.tableStatusPrev = document.getElementById('progress-text') ? document.getElementById('progress-text').textContent : '';
    if (st.frames === 0) {
      // first table frame on this GPU renderer: the shaders compile inside this frame, so show an indeterminate strip now
      V.tableStripOn = true; ui.progress('solve'); ui.setStatus('compiling air-beam shaders\u2026'); return;
    }
    if (st.cache && st.pending > 0) {
      V.tableStripOn = true; ui.setStatus(st.status); ui.progress('trace', st.fraction);
    } else tableStripClear();
  }
  // ---------------------------------------------------------------- first-open timeline (TL)
  // Marks are performance.now() offsets from t0: the click that opens Drive, or the prepare() rebuild that has no open event. One console.info JSON line per
  // closed event; with debugTimings on, the last 5 events also show in the perf label. Off: one click listener, a few marks, one boolean per frame.
  const TL = { events: [], cur: null };
  const TL_MAX_MARKS = 40, TL_OPEN_TIMEOUT_MS = 60000, TL_GRACE_MS = 1500;   // the open waits up to a minute: the GPU renderer can take 10-16 s on a real GPU
  function tlOpen(kind) {
    if (TL.cur) tlClose('superseded');
    const t0 = performance.now();
    TL.cur = { kind, t0, marks: [], frames: [], synced: false, syncedAt: -1, timer: setTimeout(() => tlClose('timeout'), TL_OPEN_TIMEOUT_MS) };
    tlMark('t0 ' + kind);
  }
  function tlMark(name, extra) {
    const c = TL.cur; if (!c || c.marks.length >= TL_MAX_MARKS) return;
    const m = { m: name, ms: Math.round((performance.now() - c.t0) * 10) / 10 }; if (extra) Object.assign(m, extra); c.marks.push(m);
  }
  // programs and beam-table recomputes before a draw, so the delta after it can name what this frame built
  function tlBefore() { return { pc: V.three ? V.three.programCount() : -1, rc: tableOn() ? globalThis.SD_SCATTER.recomputes : -1 }; }
  function tlAfter(b) {
    const c = TL.cur; if (!c) return;
    const mode = V.three ? 'three' : 'cpu', pc = V.three ? V.three.programCount() : -1;
    if (b.pc >= 0 && pc > b.pc) tlMark('programs compiled', { n: pc - b.pc, total: pc, mode });
    if (b.rc >= 0 && globalThis.SD_SCATTER.recomputes > b.rc) tlMark('beam table recomputed', { mode });
    const prev = c.frames.length ? c.frames[c.frames.length - 1] : null; c.frames.push(mode); const n = c.frames.length;
    // every frame is counted in frames; a frame is marked only when it is the first, changes mode, syncs, or closes the event (CPU frames can run for seconds)
    const reads = c.kind === 'open' || c.kind === 'load';
    const syncNow = reads && !c.synced && (V.three || !V.info.o.gpuRenderer || V.gpuFailure);
    const closes = (c.synced && n > c.syncedAt) || (!reads && n >= 2);
    if (n === 1 || mode !== prev || closes || syncNow) tlMark('frame ' + n + ' submitted', { mode });
    // only the open and load events read the GPU back, once; a rebuild never stalls the page. With the GPU renderer on, wait for its first frame.
    if (syncNow) { c.synced = true; c.syncedAt = n; V.gl.sync(); tlMark('frame ' + n + ' GPU done'); }
    if (c.synced) { if (n > c.syncedAt) return tlClose('ok'); tlGrace(c); }      // the next frame ends it, or 1.5 s without one
    else if (!reads) { if (n >= 2) return tlClose('ok'); tlGrace(c); }
  }
  function tlGrace(c) { clearTimeout(c.timer); c.timer = setTimeout(() => tlClose('grace'), TL_GRACE_MS); }
  function tlClose(reason) {
    const c = TL.cur; if (!c) return; TL.cur = null; clearTimeout(c.timer);
    const o = V.info ? V.info.o : {};
    const rec = { kind: 'drive-timeline', event: c.kind, reason, canvasPx: V.gl && [V.gl.cw, V.gl.ch], sim: V.p && [V.p.w, V.p.h], renderer: V.three ? 'three' : 'cpu',
      options: { scatterMode: o.scatterMode, scatterRes: o.scatterRes, scatterBlur: o.scatterBlur, scatterTableSteps: o.scatterTableSteps, trafficHalo: o.trafficHalo, detailedModels: !!o.detailedModels, leafyFoliage: !!o.leafyFoliage, gpuRenderer: !!o.gpuRenderer },
      marks: c.marks, frames: c.frames };
    TL.events.push(rec); if (TL.events.length > 5) TL.events.shift();
    console.info(JSON.stringify(rec));
    perfLabel();
  }
  // one line: the newest event of any kind, under a constant prefix (a multi-line readout broke the UX2 mobile popout check)
  function tlText() {
    const e = TL.events[TL.events.length - 1];
    return e ? 'first-open timeline [' + e.event + ']: ' + e.marks.filter((m) => !/^ground/.test(m.m)).slice(0, 8).map((m) => m.m + ' ' + m.ms).join(' · ') : '';
  }
  // the click that opens Drive: capture phase, so t0 is taken before ui.js's own handler runs; a click while Drive already shows is not an open
  if (root.document) root.document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('#heat-display button[data-disp="drive"]') : null;
    if (b && !(RF.UI && RF.UI.display === 'drive')) tlOpen('open');
  }, true);
  function perfLabel() {
    if (V.fpsLab && V.info && V.info.o.fpsCounter) { const f = frameMsSummary(V.frameMs || []); V.fpsLab.textContent = V.pausedSeen ? 'paused' : Math.round(stats().fps) + ' fps · ' + (f.n ? f.mean.toFixed(1) + ' ms mean · ' + f.p95.toFixed(1) + ' ms p95' : '– ms'); }
    if (V.fpsLab && V.info && V.info.o.fpsCounter && tableOn()) V.fpsLab.textContent += ' · ' + globalThis.SD_SCATTER.badge;
    if (!V.perfLab || !profileOn()) return;
    const s = stats(), b = s.breakdown, c = b.components, ms = (k) => c[k].ms.toFixed(1), scope = s.workers ? 'worker CPU sum' : 'CPU';
    V.perfLab.textContent = s.fps.toFixed(1) + ' fps · p95 ' + s.p95Ms.toFixed(1) + ' ms · ceiling ' + s.simCeiling + ' · scale ' + (s.resolution ? s.resolution.scale : 1).toFixed(2) + ' · sim ' + (s.sim ? s.sim.join('×') : '–') + ' · min ' + s.minFps + ' fps · SS ' + s.ss + '\n' +
      'frame ' + b.frameMs.toFixed(1) + ' · main ' + b.mainMs.toFixed(1) + ' · worker RT ' + ms('workerRoundTripMs') + ' ms\n' +
      scope + ' ≈ object/rays ' + ms('objectMs') + ' · ground ' + ms('groundMs') + ' · wet ' + ms('wetMs') + ' · worker setup/pack ' + ms('workerOtherMs') + ' ms\n' +
      'cache ' + b.cache.hits + ' hit / ' + b.cache.misses + ' miss · upload ' + ms('uploadMs') + ' ms\n' +
      'GL submit: compose ' + ms('composeMs') + ' · glare ' + ms('glareMs') + ' · final/veil ' + ms('finalVeilMs') + ' ms\n' +
      'AFS ' + ((V.p && V.p.yaw || 0) * 180 / Math.PI).toFixed(1) + '° · ' + 'traffic ' + ms('trafficMs') + ' · placement ' + ms('placementMs') + ' · dispatch ' + ms('dispatchMs') + ' · detector ' + ms('detectorMs') + ' · pacing ' + ms('pacingMs') + ' · other ' + ms('otherMs') + ' ms';
    if (tableOn()) V.perfLab.textContent += '\n' + globalThis.SD_SCATTER.badge + ' · gain ' + (Math.min(4, Math.max(0.25, +V.info.o.scatterGain || 1))).toFixed(2) + ' · beam table: ' + (globalThis.SD_SCATTER.cache ? 'cache on, ' + (globalThis.SD_SCATTER.cycle || 1) + ' version(s), ' + globalThis.SD_SCATTER.valid + ' valid' : 'cache off') + ' · recomputes ' + globalThis.SD_SCATTER.recomputes + ' · skips ' + globalThis.SD_SCATTER.skips;
    // NE3: the 12 slice counts the table pass got (SD_SCATTER.binN), with debug timings on.
    if (tableOn() && V.info.o.debugTimings && globalThis.SD_SCATTER.binN) { const bn = globalThis.SD_SCATTER.binN; V.perfLab.textContent += '\nslices ' + bn.join(',') + ' = ' + bn.reduce((a, b) => a + b, 0); }
    const tl = tlText(); if (tl) V.perfLab.textContent += '\n' + tl;
  }
  function resetStats() { V.profiles = []; V.completedAt = 0; V.cameraMs = 0; V.times = []; V.ring = []; V.cpu = { obj: 0, up: 0, gl: 0, n: 0 }; }
  // render n frames back to back (no vsync), waiting for the GPU at the end: ms per frame
  function bench(n) {
    const ui = V.ui, st = S(ui), d0 = st.dist, t0s = st.t, flashes = V.flash, traffic = V.src.traffic.state; V.src.traffic.state = copyTraffic(traffic); V.flash = flashState(); resetStats(); const t0 = performance.now();
    for (let i = 0; i < n; i++) { st.dist += 0.5; st.t += 0.5 / ((+info().o.speed || 50) / 3.6); frame(); }
    V.gl.sync(); const ms = (performance.now() - t0) / n; st.dist = d0; st.t = t0s; V.flash = flashes; V.src.traffic.state = traffic; flashText(); return Object.assign({ n, msPerFrame: ms }, stats());
  }
  RF.DriveAnim = { timeline: () => TL.events, frameMsSummary, simCeiling, simSize, fpsSettings, nearestMinFps, SIM_CEILINGS, MIN_FPS, laneDistance, laneAdvance, AFS_MAX, AFS_RATE, AFS_RETURN, steeringSignal, afsTarget, lightingStep, lightingSubsteps, curveSections, curveSpeed, curvatureAt, curveEnvelope, autoUrban, autoUrbanInput, autoSpeedKmh, renderedGlare: () => V.info && V.info.o ? D.glareLevel(D.capGlare(V.info.o.glare)) : null, actorPose, crossingPose, pedCrossing, pedCrossingPose, pedestrianStop, stopFor, PED, pitchStep,layoutControls, resolutionState, resolutionStep, breakdown, TRAFFIC_BRAKE, TURN_SPEED, TURN_PROBABILITY, TURN_GAP, approachSpeed, approachAcceleration, signalStop, junctionPlan, turnPose, turnClear, cameraStep, IDM, idmAcceleration, idmStep, speedLimit, trafficSignal, advanceTraffic, TILE_LEN, TILE_KINDS, roadTile, tileRoute, signalState, tileWorld, tileFrame, TRAFFIC_SPEED, trafficCars, trafficObjects, eyeLux, flashState, countFlashes, placedObjects, PERIOD, EYE, ANIM_SCENES, CLASSES, source, place, dimFoliage, actorPose, ground, objects, composeCPU, makeGL, tracer, activate, sync, stats, resetStats, details: detailsStats, bench, benchMT, closePop, openPop,
    // test hooks
    _: { V, S, poolOfBeams, trafficCars, trafficObjects, eyeOf, source, fixedIntersection, Wk, postJob, killWorkers, contextLost, contextRestored, toggleGame, gameFrame, gameBackground, gameObjects, advanceCamera, frame, frameMT, mt, size, prepare, exposure, frameSources, readHdr: () => V.gl.gl && V.gl.readHdr(), readCanvas: () => V.gl.readCanvas(), setDist: (d) => { S(V.ui).dist = d; frame(); } } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
