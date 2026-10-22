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

  // FO prototype: separate RNG, so adding undergrowth never moves existing scenery.
  // Two overlapping lobes per plant; the full footprint clears the edge line by >= .3 m.
  function vergeFoliage(ctx, opt) {
    if (!opt || !opt.leafyFoliage || opt.veg === false) return [];
    const R = rng(((ctx.foliageSeed ?? ctx.seed) >>> 0) ^ 0x464f), out = [];
    const density = Math.max(0, Math.min(3, ctx.density === undefined ? 1.5 : +ctx.density || 0));
    const count = Math.round(30 * density), lane = ctx.Lw || 3.5;
    for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
      const s = (i + .15 + .7 * R()) * 300 / count, h = .3 + .9 * R();
      const radius = .25 + .4 * R(), edge = side < 0 ? -lane / 2 : 1.5 * lane;
      const off = edge + side * (.31 + radius + .65 * R());
      for (const lobe of [-1, 1]) {
        const along = s + lobe * radius * .42, offset = off + lobe * radius * .12;
        const p = ctx.A ? ctx.A.at(along, offset).p : [along, offset];
        out.push({ k: 'ell', x: p[0], y: p[1], z: h * .5, rx: radius * .78,
          ry: radius * .78, rz: h * .5, mat: 'foliage', cls: 'veg', foliage: true,
          foliageId: side + ':' + i + ':' + lobe });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- building blocks
  // PED-CLOTHING-MODES (replaces REFLECTIVE-CLOTHING's off/some/all). One mode for every pedestrian, resolved in person(), the only place a walker's
  // kind and clothing are chosen. none = no vests, no strips. mix = the scene's own vests, plus small strips and shoe reflectors on a seeded half of the
  // non-vest walkers. small = no vests, every non-vest walker has strips and shoe reflectors. vest = every walker wears the full vest.
  // Saved values: off -> mix, some -> mix, all -> small. Unset or unknown -> mix (the default).
  const PED_MODES = ['none', 'mix', 'small', 'vest'];
  function pedMode(v) { if (v === 'off' || v === 'some') return 'mix'; if (v === 'all') return 'small'; return PED_MODES.includes(v) ? v : 'mix'; }
  // Clothing palette (linear-RGB rho: TUNING values, not measured fabric). cp-0..3 are the dark half, cp-4..7 the bright half; a walker's kind
  // 'light' draws its torso from the bright half, everything else from the dark half. Legs always draw from the dark half (as the old fixed cloth-dark legs did).
  const PED_PALETTE = ['cp-0', 'cp-1', 'cp-2', 'cp-3', 'cp-4', 'cp-5', 'cp-6', 'cp-7'];
  // A pure hash of (scene seed, walker id, salt) in [0, 1). Never a draw from ctx.rand, so choosing a colour cannot move the scenery stream.
  function unitOf(seed, id, salt) {
    let h = 2166136261 >>> 0; const str = seed + '|' + id + '|' + salt;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; return (h >>> 0) / 4294967296;
  }
  function kit(ctx) {
    const O = [], R = ctx.rand, Lw = ctx.Lw, edgeR = -Lw / 2, edgeL = 1.5 * Lw;
    const at = (s, off) => { if (ctx.A) { const q = ctx.A.at(s, off); return { x: q.p[0], y: q.p[1], yaw: Math.atan2(q.t[1], q.t[0]) }; } return { x: s, y: off, yaw: 0 }; };
    let pedN = 0;                                                       // walkers built here without an id: 0, 1, 2 ... (colour and strip choice hash on it)
    let cur = '';                                                       // the class of the object being built (post, sign, veg, deer, person, car, signal, obstacle): lets a view switch a class off without touching the random stream
    const add = (ob) => { if (cur) ob.cls = cur; O.push(ob); return ob; };
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
      // o (moving deer, drive-anim.js): face −1 mirrors it (head toward the left), gait swings the legs (m, across the road)
      deer(s, off, o) {
        const F = (o && o.face) || 1, G = (o && o.gait) || 0, p = at(s, off), c = Math.cos(p.yaw), sn = Math.sin(p.yaw), L = (a, b) => [p.x + a * c - F * b * sn, p.y + a * sn + F * b * c];   // a along the road, b to the left
        const body = L(0, 0); add({ k: 'ell', x: body[0], y: body[1], z: 0.95, rx: 0.2, ry: 0.6, rz: 0.34, mat: 'fur' });
        const B=o&&o.attention,up=B?B.up:1,target=Math.atan2(-p.y,-p.x)-p.yaw-Math.PI,angle=p.yaw+(B?F*Math.PI/2*(1-B.turn)+Math.atan2(Math.sin(target),Math.cos(target))*B.turn:0), neck = L(0, -.55-.2*(1-up)); add({ k: 'ell', x: neck[0], y: neck[1], z: B?.68+.57*up:1.25, rx: 0.12, ry: 0.22, rz: 0.3, mat: 'fur' });
        const head = L(-0.12, -.82-.2*(1-up)); add({ k: 'ell', x: head[0], y: head[1], z: B?.36+1.14*up:1.5, rx: 0.2, ry: 0.1, rz: 0.1, mat: 'fur' });
        for (const [a, b, g] of [[-0.1, 0.4, 1], [0.1, 0.4, -1], [-0.1, -0.4, -1], [0.1, -0.4, 1]]) { const q = L(a, b + g * G); add({ k: 'cyl', x: q[0], y: q[1], r: 0.04, z0: 0, z1: 0.65, mat: 'fur' }); }
        for (const side of [-0.05, 0.05]) { if(B&&up<=.15)continue; const e = L(-0.31, -.82-.2*(1-up) + side); add({ k: 'disc', x: e[0], y: e[1], z: B?.38+1.14*up:1.52, r: B?.0065:.013, nx: -Math.cos(angle), ny: -Math.sin(angle), nz: 0, eyeFalloff:B?8:0, sub: true, mat: 'eyeshine' }); }
      },
      // a pedestrian: 'dark' clothes | 'hivis' vest with tape | 'light' clothes. The kind is the scene's (or the caller's) request; the mode decides what is built.
      // o (a walker, drive-anim.js): dir [along, across] the unit direction of travel, gait = how far the legs swing (m), id = a stable key for this walker
      // (the minigame's hazard id, drive-anim's walker id); without one, the kit counts its walkers. The id is what colour and strips hash on, not the position.
      person(s, off, kind, o) {
        const mode = pedMode(ctx.reflectiveClothing), seed = ctx.seed | 0, pid = o && o.id != null ? String(o.id) : (ctx.pedSalt || '') + (pedN++);
        const vest = mode === 'vest' || (mode === 'mix' && kind === 'hivis');       // full vest: the scene's hivis kind in mix, every walker in vest
        kind = vest ? 'hivis' : kind === 'light' ? 'light' : 'dark';
        const shade = (base, salt, n) => PED_PALETTE[base + Math.floor(unitOf(seed, pid, salt) * n)];
        const torsoMat = vest ? 'hivis' : kind === 'light' ? shade(4, 'torso', 4) : shade(0, 'torso', 4);
        const legsMat = vest ? 'cloth-dark' : shade(0, 'legs', 4);
        const strips = !vest && (mode === 'small' || (mode === 'mix' && unitOf(seed, pid, 'strip') < 0.5));
        const p = at(s, off), dr = (o && o.dir) || [1, 0], G = (o && o.gait) || 0;
        let legsFirst = null;
        for (const dy of [-0.1, 0.1]) { const q = at(s + dr[0] * G * Math.sign(dy), off + dy + dr[1] * G * Math.sign(dy)); const ob = add({ k: 'cyl', x: q.x, y: q.y, r: 0.085, z0: 0, z1: 0.85, mat: legsMat }); legsFirst = legsFirst || ob; }
        legsFirst.pedMats = { torso: torsoMat, legs: legsMat, vest };     // read by the detailed (SDF) pedestrian model, drive-models.js, so it wears the same clothes
        add({ k: 'cyl', x: p.x, y: p.y, r: 0.2, z0: 0.85, z1: 1.5, mat: vest ? ({ z }) => ((z > 1.0 && z < 1.06) || (z > 1.26 && z < 1.32) ? 'hivis-tape' : 'hivis') : torsoMat });
        // Strips (modes mix and small): two small strips of the vest's tape on the back and a reflector patch on each shoe. Same material ('hivis-tape',
        // retro 330 cd/lx/m² per m² of tape) as the vest, on smaller patches. Off in none and vest: nothing added.
        if (strips) {
          const back = [-0.2 * Math.cos(p.yaw), -0.2 * Math.sin(p.yaw)];
          for (const [z0, z1] of [[1.0, 1.04], [1.2, 1.24]]) add({ k: 'box', x: p.x + back[0], y: p.y + back[1], z0, z1, hx: 0.01, hy: 0.06, yaw: p.yaw, mat: 'hivis-tape' });
          for (const dy of [-0.1, 0.1]) { const q = at(s + dr[0] * G * Math.sign(dy), off + dy + dr[1] * G * Math.sign(dy)); add({ k: 'box', x: q.x, y: q.y, z0: 0.04, z1: 0.07, hx: 0.03, hy: 0.03, yaw: p.yaw, mat: 'hivis-tape' }); }
        }
        add({ k: 'ell', x: p.x, y: p.y, z: 1.64, rx: 0.1, ry: 0.09, rz: 0.12, mat: 'skin' });
      },
      // a car, seen from any side. face = +1 heads along the road's direction, −1 against it (an oncoming car); turn rotates it (cross
      // traffic: ±π/2). lamps: 'head' (white, kcd = its intensity toward the viewer), 'tail' (red), or false. Lamps are emitters with the
      // luminance that gives that intensity; the face toward the road's start carries a plate, and the rear red reflectors.
      car(s, off, o) {
        o = o || {}; const first = O.length, p = at(s, off), yaw = p.yaw + (o.turn || 0), c = Math.cos(yaw), sn = Math.sin(yaw), F = o.face === -1 ? -1 : 1, L = (a, b) => [p.x + a * c - b * sn, p.y + a * sn + b * c];
        add({ k: 'box', x: p.x, y: p.y, z0: 0.25, z1: 0.85, hx: 2.2, hy: 0.9, yaw, mat: 'car-paint' });
        const cb = L(-F * 0.2, 0); add({ k: 'box', x: cb[0], y: cb[1], z0: 0.85, z1: 1.4, hx: 1.2, hy: 0.78, yaw, mat: ({ face }) => (face === 5 ? 'car-paint' : 'win-dark') });
        for (const a of [-1.35, 1.35]) for (const b of [-0.85, 0.85]) { const q = L(a, b); add({ k: 'box', x: q[0], y: q[1], z0: 0, z1: 0.64, hx: 0.32, hy: 0.11, yaw, mat: 'tyre' }); }
        const front = L(F * 2.21, 0), rear = L(-F * 2.21, 0), nF = [F * c, F * sn], face = (end, nrm, b, z, r, mat, extra) => { const q = L(end, b); add(Object.assign({ k: 'disc', x: q[0], y: q[1], z, r, nx: nrm[0], ny: nrm[1], nz: 0, sub: r < 0.07, mat }, extra)); };
        void front; void rear;
        const lampR = o.lamps === 'head' ? 0.06 : 0.045, kcd = (o.kcd === undefined ? 1 : o.kcd) * 1000;
        if (o.lamps === 'head') for (const b of [-0.62, 0.62]) face(F * 2.21, nF, b, 0.68, lampR, 'lamp-head', { headlamp: true, emitPow: 8, emit: ((I) => { const Lm = I / (Math.PI * lampR * lampR); return [Lm, Lm, 0.93 * Lm]; })(kcd / 2) });   // a headlamp is a beam: cos^8 ≈ ±20° to 60 %, nothing at 70° (cross traffic)
        if (o.lamps === 'tail') for (const b of [-0.7, 0.7]) face(-F * 2.21, [-nF[0], -nF[1]], b, 0.78, lampR, 'lamp-head', { taillamp: true, emitPow: 2, emit: ((I) => { const Lm = I / (Math.PI * lampR * lampR); return [Lm, 0.03 * Lm, 0.015 * Lm]; })(o.tailCd || 80) });
        face(F * 2.21, nF, 0, 0.55, 0.15, 'plate'); face(-F * 2.21, [-nF[0], -nF[1]], 0, 0.55, 0.15, 'plate');
        for (const b of [-0.7, 0.7]) face(-F * 2.21, [-nF[0], -nF[1]], b, 0.62, 0.035, 'reflector-red');
        if (o.lamps === 'head' && o.kcd === undefined) D.Headlamp.apply(O.slice(first), { mode: 'generic' });
      },
      // a traffic-signal head facing the approaching car at (s, off, z), one lamp lit: 'red' | 'green'
      signal(s, off, z, lit) {
        const p = at(s, off), c = Math.cos(p.yaw), sn = Math.sin(p.yaw), cols = { red: [1.2e4, 300, 200], amber: [1.2e4, 5e3, 100], green: [200, 8000, 3500] }, dz = { red: 0.34, amber: 0, green: -0.34 };
        add({ k: 'box', x: p.x, y: p.y, z0: z - 0.55, z1: z + 0.55, hx: 0.17, hy: 0.19, yaw: p.yaw, mat: 'pole' });
        for (const key of ['red', 'amber', 'green']) add({ k: 'disc', x: p.x - 0.18 * c, y: p.y - 0.18 * sn, z: z + dz[key], r: 0.1, nx: -c, ny: -sn, nz: 0, mat: 'pole', emitPow: 2, emit: key === lit ? cols[key] : null });
      },
      parkedCar(s, off) { this.car(s, off, { face: 1 }); },
      // a raised pavement marker: a small retroreflecting face toward the car, standing on the road. glow: it adds light to the ground pixel instead of covering it
      rpm(s, off, yellow) {
        const p = at(s, off), c = Math.cos(p.yaw), sn = Math.sin(p.yaw), tz = 0.148, tl = Math.sqrt(1 - tz * tz);
        add({ k: 'disc', x: p.x, y: p.y, z: 0.035, r: 0.035, nx: -c * tl, ny: -sn * tl, nz: tz, sub: true, glow: true, mat: yellow ? 'rpm-yellow' : 'rpm-white' });
      },
      // a dark crate lying on the road (the hard target: 3 % reflectance, nothing retroreflective), along the road by across it
      obstacle(s, off, o) { o = o || {}; const p = at(s, off); add({ k: 'box', x: p.x, y: p.y, z0: 0, z1: o.h || 0.35, hx: o.l || 0.3, hy: o.w || 0.2, yaw: p.yaw, mat: 'tyre' }); },
    };
    for (const [m, c] of [['post', 'post'], ['sign', 'sign'], ['tree', 'veg'], ['bush', 'veg'], ['deer', 'deer'], ['person', 'person'], ['car', 'car'], ['parkedCar', 'car'], ['signal', 'signal'], ['obstacle', 'obstacle'], ['rpm', 'rpm']]) { const f = k[m]; k[m] = function () { cur = c; const first=O.length; try {
      const result=f.apply(this, arguments);
      if (['deer','person','tree','car'].includes(m) && O.length>first) {
        const p=at(arguments[0],arguments[1]),opt=(m==='person'?arguments[3]:arguments[2])||{};
        for(let i=first;i<O.length;i++){O[i].detailPart=m;O[i].modelId=opt.id||m+':'+arguments[0]+':'+arguments[1];}
        O[first].detail={kind:m,x:p.x,y:p.y,yaw:p.yaw+(opt.turn||0),face:opt.face||1,gait:opt.gait||0,dir:opt.dir||[1,0],ptype:m==='person'?arguments[2]:null,h:m==='tree'?O[first].z1/.55:0,bound:!!opt.bound,motion:opt.motion,attention:opt.attention,id:opt.id||m+':'+arguments[0]+':'+arguments[1],birch:!!opt.birch};
        if (m==='person' && O[first].pedMats) O[first].detail = Object.assign({}, O[first].detail, { pedMats: O[first].pedMats });   // only pedestrians carry the key (other classes keep their old shape)
      }
      return result;
    } finally { cur = ''; } }; }
    return k;
  }

  // ---------------------------------------------------------------- scenes as presets (SB0)
  // A scene is a preset: one pure resolver turns preset + explicit overrides into the feature flags a builder reads. Overrides win; an undefined override means "use the preset".
  // Preset values: SB0 set each to what the scene built then; SB1 turned studs on for every scene (the animated view's rpm toggle).
  const FEATURE_DEFAULTS = { studs: true, posts: true, signs: true, people: true, animals: true, obstacle: false, veg: true };
  const FEATURE_PRESETS = {
    road: { studs: true },
    forest: { studs: true },
    city: { studs: true },
    pass: { studs: true, people: false },    // the mountain pass: no pedestrians (unchanged)
  };
  function resolveFeatures(opts) {
    const o = opts || {}, preset = Object.prototype.hasOwnProperty.call(FEATURE_PRESETS, o.preset) ? o.preset : 'road';
    const F = Object.assign({}, FEATURE_DEFAULTS, FEATURE_PRESETS[preset]);
    for (const key of Object.keys(o.overrides || {})) if (o.overrides[key] !== undefined) F[key] = o.overrides[key];
    return F;
  }
  RF.Drive.resolveFeatures = resolveFeatures; RF.Drive.laneStuds = laneStuds; RF.Drive.FEATURE_PRESETS = FEATURE_PRESETS; RF.Drive.FEATURE_DEFAULTS = FEATURE_DEFAULTS;

  // ---------------------------------------------------------------- scenes
  // ---------------------------------------------------------------- scenery from parameters (SP2, stage 3)
  // The forest and the city are parameter sets (SCENERY) for one generator, generateScenery. Its stages run in the order a set lists.
  // Each stage makes the same kit calls in the same order as the old builder, on the scene stream (ctx.rand), so every object sits where it did.
  // A rate decides only whether an item is KEPT: the item is drawn and built first, then dropped if its class is thinned, so thinning one
  // class never moves another. Rates below 1 thin with a stream of their own; rates above 1 add items from a second stream (seeded from the
  // scene seed). At rate 1 nothing is thinned or added, and nothing extra is drawn. scene-digest.js and the legacy oracle in scenery-params.js
  // pin the defaults.
  // The roadside sweep and the city backdrop share the scene stream, as the old builders did (giving each class its own stream would move
  // every tree on the default road). Their extras and thinning use separate streams.
  const SCENERY_SALT = { tree: 0x3A11, treeExtra: 0x3A12, bush: 0x3A13, bushExtra: 0x3A14, deer: 0x3A15, deerExtra: 0x3A16, person: 0x3A17, personExtra: 0x3A18, backdrop: 0x3A19 };
  const SCENERY = {
    forest: {
      stages: ['roadside', 'posts', 'signs', 'deer', 'people', 'backdrop'],   // backdrop is off unless a caller sets it (it draws nothing when null)
      roadside: { start: 4, end: 280, step: 3.2, stepRand: 4, birch: 0.18, treeOff: 2.6, treeSpread: 9, second: 0.6, secondOff: 12, secondSpread: 28, secondMix: 2,
        bush: 0.35, bushS: 1.5, bushOff: 1.8, bushSpread: 2, bushSize: 0.5, bushSizeSpread: 0.5, treeRate: 1, bushRate: 1 },
      posts: { from: 25, to: 280, step: 50, edge: 'R', d: 0.9 },
      signs: [{ s: 115, edge: 'R', d: 2.0, color: 'yellow', opts: { w: 0.8, h: 0.8 } }],
      deer: { list: [{ s: 48, edge: 'R', d: 3.2 }, { s: 88, edge: 'L', d: 3.0 }, { s: 130, edge: 'L', d: 5.5 }], rate: 1 },
      people: { list: [{ s: 70, edge: 'R', d: 1.4, kind: 'dark' }, { s: 40, edge: 'L', d: 1.3, kind: 'hivis' }], rate: 1 },
      backdrop: null,
      verge: ['gravel', 1.0, 'leaves'],
      urbanMarks: false,
    },
    city: {
      stages: ['backdrop', 'poles', 'parked', 'signs', 'people', 'deer'],
      backdrop: { walk: 3.0, setback: 2.5, fresh: false },
      poles: { from: 12, to: 280, step: 32, d: 0.9, r: 0.07, h: 7.5 },
      parked: [{ from: 20, to: 160, step: 11, stepRand: 9, edge: 'R', d: 1.3, extra: 0, sShift: 0 }, { from: 30, to: 140, step: 17, stepRand: 10, edge: 'L', d: 1.3, extra: 0.9, sShift: 5 }],
      signs: [{ s: 75, edge: 'R', d: 1.0, color: 'white', opts: { w: 0.6, h: 0.8, z0: 2.0 } }, { s: 135, edge: 'R', d: 1.0, color: 'green', opts: { w: 1.4, h: 0.7, z0: 2.3 } }],
      // the two walkers that stood in the lanes go to the right-hand pavement when the animated view asks (kerbPeople); the still scene keeps them in the lanes
      people: { list: [{ s: 48, edge: 'R', d: 3.0, kind: 'dark', when: 'kerb' }, { s: 50, edge: 'R', d: 3.0, kind: 'hivis', when: 'kerb' },
        { s: 48, edge: null, d: 0.3, kind: 'dark', when: 'lane' }, { s: 48.4, edge: null, d: -1.4, kind: 'hivis', when: 'lane' },
        { s: 46, edge: 'L', d: 1.5, kind: 'light' }, { s: 92, edge: 'R', d: 2.0, kind: 'dark' }], rate: 1 },
      deer: { list: [{ s: 110, edge: 'L', d: 2.2 }], rate: 1 },
      verge: ['concrete', 3.0, 'concrete'],
      urbanMarks: true,
    },
  };
  // a point at distance d from the edge the item names (R: right edge, L: left edge, null: d is an absolute offset)
  const placeAt = (k, it) => (it.edge === 'R' ? k.edgeR - it.d : it.edge === 'L' ? k.edgeL + it.d : it.d);
  // a keep test for one class. Rate 1 keeps everything and draws nothing; otherwise the class has a stream of its own
  const keepRate = (rate, seed, salt) => {
    if (rate === 1) return () => true;
    const r = rng(((seed | 0) ^ Math.imul(salt, 0x9E3779B1)) >>> 0);
    return () => r() < rate;
  };
  const extraStream = (seed, salt) => rng(((seed | 0) ^ Math.imul(salt, 0x7F4A7C15)) >>> 0);
  // builds one item, then drops it when its class is thinned out; returns whether it was kept
  function emit(k, keep, build) { const n0 = k.O.length, kept = keep(); build(); if (!kept) k.O.length = n0; return kept; }
  // rate above 1: (rate - 1) x n more items, placed by place(xk, xr) on a kit of their own, with the class's extra stream
  function extras(ctx, k, rate, n, salt, place) {
    if (!(rate > 1) || !n) return;
    const xr = extraStream(ctx.seed, salt), xk = kit(Object.assign({}, ctx, { rand: xr, pedSalt: 'x' }));
    for (let i = 0, m = Math.round((rate - 1) * n); i < m; i++) place(xk, xr);
    k.O.push(...xk.O);
  }
  function roadsideStage(ctx, k, P) {
    const R = ctx.rand, Q = P.roadside, treeKeep = keepRate(Q.treeRate, ctx.seed, SCENERY_SALT.tree), bushKeep = keepRate(Q.bushRate, ctx.seed, SCENERY_SALT.bush);
    let trees = 0, bushes = 0;
    const tree = (s, off, o) => { if (emit(k, treeKeep, () => k.tree(s, off, o))) trees++; };
    const bush = (s, off, size) => { if (emit(k, bushKeep, () => k.bush(s, off, size))) bushes++; };
    for (const side of [1, -1]) for (let s = Q.start; s < Q.end; s += Q.step + Q.stepRand * R()) {
      const off = side > 0 ? k.edgeL + Q.treeOff + Q.treeSpread * R() * R() : k.edgeR - Q.treeOff - Q.treeSpread * R() * R();
      tree(s, off, { birch: R() < Q.birch });
      if (R() < Q.second) { const off2 = side > 0 ? k.edgeL + Q.secondOff + Q.secondSpread * R() : k.edgeR - Q.secondOff - Q.secondSpread * R(); tree(s + Q.secondMix * R(), off2); }
      if (R() < Q.bush) bush(s + Q.bushS, side > 0 ? k.edgeL + Q.bushOff + Q.bushSpread * R() : k.edgeR - Q.bushOff - Q.bushSpread * R(), Q.bushSize + Q.bushSizeSpread * R());
    }
    extras(ctx, k, Q.treeRate, trees, SCENERY_SALT.treeExtra, (xk, xr) => {
      const side = xr() < 0.5 ? 1 : -1, s = Q.start + (Q.end - Q.start) * xr(), off = side > 0 ? xk.edgeL + Q.treeOff + Q.treeSpread * xr() * xr() : xk.edgeR - Q.treeOff - Q.treeSpread * xr() * xr();
      xk.tree(s, off, { birch: xr() < Q.birch });
    });
    extras(ctx, k, Q.bushRate, bushes, SCENERY_SALT.bushExtra, (xk, xr) => {
      const side = xr() < 0.5 ? 1 : -1, s = Q.start + (Q.end - Q.start) * xr();
      xk.bush(s + Q.bushS, side > 0 ? xk.edgeL + Q.bushOff + Q.bushSpread * xr() : xk.edgeR - Q.bushOff - Q.bushSpread * xr(), Q.bushSize + Q.bushSizeSpread * xr());
    });
  }
  function postsStage(ctx, k, P) { const Q = P.posts; for (let s = Q.from; s < Q.to; s += Q.step) k.post(s, placeAt(k, Q)); }
  function signsStage(ctx, k, P, o) { if (o.signs) for (const g of P.signs) k.sign(g.s, placeAt(k, g), g.color, Object.assign({}, g.opts)); }
  function deerStage(ctx, k, P, o) {
    if (!o.animals) return;
    const Q = P.deer, keep = keepRate(Q.rate, ctx.seed, SCENERY_SALT.deer); let n = 0;
    for (const it of Q.list) if (emit(k, keep, () => k.deer(it.s, placeAt(k, it)))) n++;
    extras(ctx, k, Q.rate, n, SCENERY_SALT.deerExtra, (xk, xr) => { const s = 40 + 240 * xr(), edge = xr() < 0.5 ? 'R' : 'L'; xk.deer(s, placeAt(xk, { edge, d: 3 + 5 * xr() })); });
  }
  function peopleStage(ctx, k, P, o) {
    if (!o.people) return;
    const Q = P.people, keep = keepRate(Q.rate, ctx.seed, SCENERY_SALT.person), where = ctx.kerbPeople ? 'kerb' : 'lane'; let n = 0;
    for (const it of Q.list) { if (it.when && it.when !== where) continue; if (emit(k, keep, () => k.person(it.s, placeAt(k, it), it.kind))) n++; }
    extras(ctx, k, Q.rate, n, SCENERY_SALT.personExtra, (xk, xr) => { const s = 30 + 250 * xr(), edge = xr() < 0.5 ? 'R' : 'L', kind = ['dark', 'hivis', 'light'][Math.floor(xr() * 3)]; xk.person(s, placeAt(xk, { edge, d: 0.6 + 4 * xr() }), kind); });
  }
  // the wall of a building, windows on the face seen from the road (the old city builder's closure, moved out unchanged)
  function cityWindow({ u, z, face }, seed) {
    const gx = Math.floor((u + 400) / 2.6), gz = Math.floor(z / 3.2), cell = (u + 400) / 2.6 - gx, cz = z / 3.2 - gz;
    if (z < 3.0 || cell < 0.2 || cell > 0.8 || cz < 0.25 || cz > 0.8) return face === 0 ? 'wall-light' : 'wall';
    const h = Math.sin((gx + 1) * 12.9898 + (gz + 1) * 78.233 + seed * 3.1) * 43758.5453, f = h - Math.floor(h);
    return f < 0.22 ? 'win-warm' : f < 0.3 ? 'win-cool' : 'win-dark';
  }
  // the building backdrop: on the city it draws from the scene stream (as before); on any other scene, from a stream of its own (fresh)
  function backdropStage(ctx, k, P) {
    const Q = P.backdrop; if (!Q) return;
    const R = Q.fresh ? extraStream(ctx.seed, SCENERY_SALT.backdrop) : ctx.rand, walk = Q.walk, setback = Q.setback;
    const win = cityWindow;   // the facade closure keeps the old builder's source text ('(h) => win(h, seed)'): the foliage test encodes function text

    for (const side of [1, -1]) for (let s = -8, i = 0; s < 280; s += 15 + 14 * R(), i++) {
      const len = 12 + 10 * R(), hgt = 9 + 18 * R(), dep = 7 + 4 * R(), off = side > 0 ? k.edgeL + walk + setback + dep : k.edgeR - walk - setback - dep, p = k.at(s + len, off), seed = i + (side > 0 ? 0 : 50);
      k.add({ k: 'box', x: p.x, y: p.y, z0: 0, z1: hgt, hx: len, hy: dep, yaw: p.yaw, facadeStyle: seed % 3, mat: (h) => win(h, seed) });
    }
  }
  function polesStage(ctx, k, P) {
    const Q = P.poles;
    for (let s = Q.from; s < Q.to; s += Q.step) for (const side of [1, -1]) { const off = side > 0 ? k.edgeL + Q.d : k.edgeR - Q.d; k.add({ k: 'cyl', x: k.at(s, off).x, y: k.at(s, off).y, r: Q.r, z0: 0, z1: Q.h, mat: 'pole' }); }
  }
  function parkedStage(ctx, k, P) {
    const R = ctx.rand;
    for (const it of P.parked) for (let s = it.from; s < it.to; s += it.step + it.stepRand * R()) k.parkedCar(s + it.sShift, it.edge === 'R' ? k.edgeR - it.d : k.edgeL + it.d + it.extra);
  }
  // a parameter set is a preset of values; overrides win key by key (an undefined override keeps the preset; an object merges one level)
  function sceneryParams(name, overrides) {
    const base = SCENERY[name];
    if (!base) throw new Error('sceneryParams: no scenery set "' + name + '"');
    const P = Object.assign({}, base), isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    for (const key of Object.keys(overrides || {})) {
      const v = overrides[key]; if (v === undefined) continue;
      P[key] = isObj(v) && isObj(base[key]) ? Object.assign({}, base[key], v) : v;
    }
    return P;
  }
  // one generator for the forest and the city: the set's stages, then the ground markings the set asks for
  function generateScenery(name, ctx, o, overrides) {
    const P = sceneryParams(name, overrides), k = kit(ctx), flags = o || {};
    const STAGE = { roadside: roadsideStage, posts: postsStage, signs: signsStage, deer: deerStage, people: peopleStage, backdrop: backdropStage, poles: polesStage, parked: parkedStage };
    for (const st of P.stages) STAGE[st](ctx, k, P, flags);
    const markings = D.laneMarkings(ctx.Lw, { us: ctx.us });
    if (P.urbanMarks) {
      for (let b = k.edgeR + 0.4; b < k.edgeL - 0.2; b += 1.0) markings.push({ o0: b, o1: b + 0.5, mat: 'white-paint', pat: { s0: 40, s1: 1e5, period: 1e6, on: 3.5 } });   // zebra crossing, 40–43.5 m
      markings.push({ o0: k.edgeR, o1: 0.2 + ctx.Lw / 2 - 0.4, mat: 'white-paint', pat: { s0: 38, s1: 1e5, period: 1e6, on: 0.4 } });                                                 // stop line in our lane
    }
    return { objects: k.O, markings, verge: P.verge.slice() };
  }
  RF.Drive.generateScenery = generateScenery; RF.Drive.sceneryParams = sceneryParams; RF.Drive.SCENERY = SCENERY;

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
      build(ctx, o) { return generateScenery('forest', ctx, o, ctx.scenery); },
    },
    city: {
      label: 'City street',
      build(ctx, o) { return generateScenery('city', ctx, o, ctx.scenery); },
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
    if (o.oncoming && o.oncoming.dist > 0) k.car(o.oncoming.dist, ctx.Lw, { face: -1, lamps: 'head', kcd: o.oncoming.kcd });
    if (o.preceding && o.preceding.dist > 0) k.car(o.preceding.dist, 0, { face: 1, lamps: 'tail' });
    for (const ob of k.O) objects.push(ob);
  }
  // crates on the road, for any scene: o.obstacle = true → one every 150 m, alternately in the right and left half of our lane
  function addObstacles(ctx, objects) {
    const k = kit(ctx); for (let s = 80, i = 0; s < 300; s += 150, i++) k.obstacle(s, i % 2 ? 0.55 : -0.55);
    for (const ob of k.O) objects.push(ob);
  }
  /* Lane studs (rpm) in road coordinates: on the centre line (in the middle of each gap when the line is dashed) and, staggered, on both edge lines.
   * Walks the absolute positions s in [lo, hi) and places each one at s - shift (the pass uses its car's distance as shift; flat scenes use 0). Draws no
   * random numbers, so adding studs never moves another object. Same placement as the original wildChunk loop when lo = 0 and shift = 0. */
  function laneStuds(k, markings, Lw, us, lo, hi, shift) {
    const sh = shift || 0, pat = markings.find((m) => m.pat && m.o0 < Lw / 2 && m.o1 > Lw / 2), per = pat ? pat.pat.period : 12, s0 = pat ? pat.pat.s0 + pat.pat.on + (per - pat.pat.on) / 2 : 0;
    const first = (ph, step) => lo + ((ph - lo) - Math.floor((ph - lo) / step) * step);
    for (let s = first(s0, per); s < hi; s += per) k.rpm(s - sh, Lw / 2, us);
    for (let s = first(6, 24); s < hi; s += 24) { k.rpm(s - sh, -Lw / 2 + 0.2); k.rpm(s + 12 - sh, 1.5 * Lw - 0.2); }
  }
  /* The open road for the animated view (drive-anim.js), one PERIOD-long chunk at a time, from a seed: every chunk is different, the same seed gives the same road.
   * ctx { Lw, us, seed (a number for THIS chunk), density (1 = about what the still view has, ×1.5 default in the view), broken (US centre line) },
   * o { people, animals, signs, posts, veg, obstacle, rpm }. → { objects (still), actors (walkers and deer: data, drive-anim.js poses them), markings, verge }.  */
  function wildChunk(ctx, o) {
    const R = rng(ctx.seed), c = Object.assign({}, ctx, { rand: R, A: null }), k = kit(c), Lw = c.Lw, dn = c.density === undefined ? 1 : c.density, us = c.us, P = 300;
    const markings = D.laneMarkings(Lw, { us, broken: !!c.broken }), actors = [];
    if (o.posts !== false) for (let s = 20; s < P; s += 50) { k.post(s, k.edgeR - 0.9); k.post(s + 25, k.edgeL + 0.9); }
    if (o.signs) {
      const types = [['green', { w: 1.8, h: 1.0 }], ['yellow', { w: 0.8, h: 0.8 }], ['white', { w: 0.7, h: 0.9 }]]; let last = -100;
      for (let i = 0, n = Math.round(R() * 2.4 * Math.min(1.5, dn)); i < n; i++) { const s = Math.max(40, last + 60) + R() * 40; if (s > 270) break; last = s; const t = types[Math.floor(R() * 3)], side = R() < 0.5 ? 1 : -1; k.sign(s, side > 0 ? k.edgeL + 1.8 + 1.4 * R() : k.edgeR - 1.8 - 1.4 * R(), t[0], t[1]); }
    }
    if (o.veg !== false) {
      const nb = Math.round(14 * dn), nt = Math.round(3 * dn);
      for (const side of [1, -1]) {
        for (let i = 0; i < nb; i++) { const s = (i + R()) * P / nb, off = 1.4 + 9 * R() * R(); k.bush(s, side > 0 ? k.edgeL + off : k.edgeR - off, 0.5 + 0.9 * R()); }
        for (let i = 0; i < nt; i++) { const s = (i + R()) * P / nt, off = 5 + 13 * R(); k.tree(s, side > 0 ? k.edgeL + off : k.edgeR - off, { birch: R() < 0.15 }); }
      }
    }
    // SB0: the read-site for resolveFeatures (undefined rpm = the road preset = on, as before)
    if (resolveFeatures({ preset: 'road', overrides: { studs: o.rpm } }).studs) laneStuds(k, markings, Lw, us, 0, P);
    if (o.obstacle) for (let s = 80, i = 0; s < P; s += 150, i++) k.obstacle(s, i % 2 ? 0.55 : -0.55);
    // walkers and deer: where they start, where they head, how fast. Poses come from drive-anim.js (they move from the moment the car is ~110 m away)
    const edge = (side) => (side > 0 ? k.edgeL : k.edgeR);
    if (o.people) for (let i = 0, n = Math.round((0.8 + 1.6 * R()) * Math.min(1.5, dn)); i < n; i++) {
      const side = R() < 0.5 ? 1 : -1, kind = ['dark', 'dark', 'hivis', 'light'][Math.floor(R() * 4)], s0 = 30 + R() * 250, spd = 0.9 + 0.7 * R();
      if (R() < 0.35) actors.push({ id: 'p' + i, kind: 'person', ptype: kind, mode: 'cross', s0, off0: edge(side) + side * (0.6 + 1.4 * R()), ds: 0, doff: -side, spd, len: 1.5 * Lw + 2 * (0.6 + 1.4) + 0.5 });
      else { const dir = R() < 0.5 ? 1 : -1; actors.push({ id: 'p' + i, kind: 'person', ptype: kind, mode: 'along', s0, off0: edge(side) + side * (0.8 + 2.4 * R()), ds: dir, doff: 0, spd, len: 90 }); }
    }
    if (o.animals) for (let i = 0, n = Math.round(R() * 1.6 * Math.min(1.5, dn) + 0.45); i < n; i++) {
      const side = R() < 0.5 ? 1 : -1, s0 = 40 + R() * 230, graze = R() < 0.25, into = -0.4 + (R() < 0.5 ? 0.7 * R() : 0.7 * R() + Lw * (0.4 + 0.5 * R()));   // into: how far onto the road it goes (m past the edge line)
      actors.push({ id: 'd' + i, kind: 'deer', mode: graze ? 'graze' : 'step', s0, off0: edge(side) + side * (3 + 5 * R()), ds: 0, doff: -side, spd: 1.0 + 0.5 * R(), len: 0, delay: 0.3 + 1.2 * R(), side, into });
      const a = actors[actors.length - 1]; a.len = graze ? 0 : Math.abs(a.off0 - (edge(side) - side * a.into));
    }
    k.O.push(...vergeFoliage(ctx, o));
    return { objects: k.O, actors, markings, verge: ['gravel', 1.6, 'grass'] };
  }
  // build a scene by name: ctx { Lw (lane width m), A (RF.Road.arc or null), us (US markings), seed }, o { people, animals, signs, posts, veg (false = leave
  // that class out; everything else stays where it was), obstacle (true = add crates) }
  function buildScene(name, ctx, o) {
    const sc = SCENES[name] || SCENES.road, c = Object.assign({ Lw: 3.5, A: null, us: false, seed: 7 }, ctx, { rand: rng((ctx && ctx.seed) || 7) }), opt = Object.assign({ people: true, animals: true, signs: true }, o), out = sc.build(c, opt);
    // SB1: studs on every flat scene. Only the animated view asks (it sends rpm: true); the still Spec view does not, so its scenery is unchanged.
    if (resolveFeatures({ preset: name, overrides: { studs: opt.rpm === true } }).studs) { const kk = kit(c); laneStuds(kk, D.laneMarkings(c.Lw, { us: c.us, broken: !!c.broken }), c.Lw, c.us, 0, 300); out.objects.push(...kk.O); }
    addTraffic(c, out.objects, opt);
    if (name === 'forest' || name === 'road') out.objects.push(...vergeFoliage(c, opt));
    if (opt.posts === false || opt.veg === false) out.objects = out.objects.filter((ob) => !((opt.posts === false && ob.cls === 'post') || (opt.veg === false && ob.cls === 'veg')));
    if (opt.obstacle) addObstacles(c, out.objects);
    return out;
  }
  RF.Drive.vergeFoliage = vergeFoliage;
  RF.Drive.pedMode = pedMode; RF.Drive.scenes = SCENES; RF.Drive.buildScene = buildScene; RF.Drive.rng = rng; RF.Drive.kit = kit; RF.Drive.wildChunk = wildChunk;
})(typeof globalThis !== 'undefined' ? globalThis : this);
