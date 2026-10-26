/* TG prototype: road distance s is horizontal station (metres), off is left of our lane. No optical-scene fields. */
(function (root) {
  'use strict';
  const RF = root.RF, D = RF.Drive, PERIOD = 1600;
  // Deliberate tuning, NOT an AASHTO design: parabolic curves L=160/200 m, K=L/grade-change-in-percent.
  const curves = [[80, 240, .08, -.08], [400, 560, -.08, .08], [880, 1080, .08, -.10], [1280, 1480, -.10, .08]];
  function localProfile(s) {
    let x = 0, z = 0, g = .08;
    for (const [a, b, g0, g1] of curves) {
      if (s < a) return { z: z + g * (s - x), grade: g };
      z += g * (a - x);
      const u = Math.min(s, b) - a, rate = (g1 - g0) / (b - a);
      if (s <= b) return { z: z + g0 * u + rate * u * u / 2, grade: g0 + rate * u };
      z += (g0 + g1) * (b - a) / 2; x = b; g = g1;
    }
    return { z: z + g * (s - x), grade: g };
  }
  function profile(s) { const lap = Math.floor(s / PERIOD), q = localProfile(s - lap * PERIOD); return { z: q.z + lap * localProfile(PERIOD).z, grade: q.grade }; }
  const kinds = ['straight', 'straight', 'straight', '30L', '150R', 'straight', '40R', '250L'];
  function tile(seed, k) {
    const kind = kinds[((k % kinds.length) + kinds.length) % kinds.length];
    return { k, s0: k * 200, kind, curvature: /[RL]$/.test(kind) ? (kind.endsWith('L') ? 1 : -1) / parseInt(kind, 10) : 0, side: -1, phase: 0 };
  }
  function bank(s) {
    const k = Math.floor(s / 200), q = tile(0, k), u = s - k * 200;
    // Superelevation runs in/out before/after the circular portion; positive = left edge raised.
    const fade = Math.max(0, Math.min(1, (u - 15) / 35, (185 - u) / 35));
    return -Math.sign(q.curvature) * .06 * fade * fade * (3 - 2 * fade);
  }
  function terrain(s, off, lane) {
    const z = profile(s).z + bank(s) * off, right = -lane / 2 - 2.2, left = 1.5 * lane + 2.2;
    return z + (off < right ? Math.max(-32, (off - right) * 3) : off > left ? Math.min(32, (off - left) * .9) : 0);
  }
  function route(dist, lane, elevated = true) {
    const A = RF.DriveAnim.tileRoute(0, dist, false, tile), z0 = profile(dist).z;
    A.touge = elevated; A.dist = dist; A.lane = lane;
    A.height = (s, off = 0) => elevated ? terrain(s + dist, off, lane) - z0 : 0;
    A.surface = (s, off = 0, height = 0) => {
      const q = A.at(s, off), z = A.height(s, off), eps = .05;
      const g = (A.height(s + eps, off) - A.height(s - eps, off)) / (2 * eps), b = (A.height(s, off + eps) - A.height(s, off - eps)) / (2 * eps);
      const n = [-g * q.t[0] + b * q.t[1], -g * q.t[1] - b * q.t[0], 1], L = Math.hypot(...n);
      return { p: [q.p[0], q.p[1], z + height], t: [q.t[0], q.t[1], g], normal: n.map(v => v / L), grade: g, bank: b };
    };
    return A;
  }
  // Spatial smoothing across a 2.8 m wheelbase: deterministic when seeking and identical at any frame rate.
  function attitude(dist) {
    const pitch = Math.atan((profile(dist + 1.4).z - profile(dist - 1.4).z) / 2.8), roll = Math.atan((bank(dist - 1.4) + 2 * bank(dist) + bank(dist + 1.4)) / 4);
    const c = Math.cos(pitch), s = Math.sin(pitch), a = Math.cos(roll), b = Math.sin(roll);
    return { pitch, roll, forward: [c, 0, s], left: [-s * b, a, c * b], up: [-s * a, -b, c * a] };
  }
  // CR2: a lamp disc of a mesh car (drawn by the GPU mesh, see drive-three-models.js adapt) sits on the mesh mount, through the same carBasis the
  // mesh is tilted by, so glare and AHB see the lamp where the body draws it. root = the car's detail (x, y, yaw, face, id). Null when no mount.
  function meshLamp(ob, root, A) {
    const f = A.frame(root.x, root.y), z = A.height(f.s, f.off), surf = A.surface(f.s, f.off);
    const m = { id: root.id, x: root.x, y: root.y, z, yaw: root.yaw, face: root.face, grade: surf.grade, normal: surf.normal };
    const B = D.Models.carBasis(m), F = m.face === -1 ? -1 : 1, yaw = m.yaw + (F === -1 ? Math.PI : 0), c = Math.cos(yaw), s = Math.sin(yaw);
    const end = ((ob.x - m.x) * Math.cos(m.yaw) + (ob.y - m.y) * Math.sin(m.yaw)) * F > 0 ? 1 : -1;
    const type = ob.mat === 'plate' ? 'plate' : ob.mat === 'reflector-red' ? 'reflector' : ob.headlamp ? 'head' : 'tail';
    const side = type === 'plate' ? 0 : Math.sign(-(ob.x - m.x) * s + (ob.y - m.y) * c);
    const mt = D.Models.meshMount(m.id, end, type, side);
    if (!mt) return null;
    const P = mt.p, N = mt.n, at = (k) => B.X[k] * P[0] + B.Y[k] * P[1] + B.U[k] * P[2], nt = (k) => B.X[k] * N[0] + B.Y[k] * N[1] + B.U[k] * N[2];
    // meshKey: the kit classification (end:type:side), read by adapt() so a moved lamp keeps the mount it was classified with.
    return { x: m.x + at(0), y: m.y + at(1), z: z + at(2), nx: nt(0), ny: nt(1), nz: nt(2), meshKey: end + ':' + type + ':' + side };
  }
  function lift(ob, A, root) {
    if (!A.touge || ob.tougePlaced) return ob;
    const f = A.frame(ob.surfaceAnchor ? ob.surfaceAnchor[0] : ob.x, ob.surfaceAnchor ? ob.surfaceAnchor[1] : ob.y), z = A.height(f.s, f.off), n = { ...ob, bs: undefined, tougePlaced: true };
    if (n.z !== undefined) n.z += z;
    if (n.z0 !== undefined) { n.z0 += z; n.z1 += z; }
    // M2 sphere-cluster trees and SDF actors stay upright; all roots use the same surface.
    let surf = null;
    if (ob.traffic || ob.cls === 'rail') { const q = A.surface(f.s,f.off), t = A.at(f.s).t; surf = q; n.passSlope = [q.grade*t[0]-q.bank*t[1],q.grade*t[1]+q.bank*t[0],0,0]; }
    // Cars on the pass carry the road normal and grade, so the GPU mesh car can sit on the surface (drive-three-models.js update).
    if (n.detail) n.detail = { ...n.detail, z: (n.detail.z || 0) + z, ...(surf && ob.traffic ? { normal: surf.normal, grade: surf.grade } : {}) };
    if (root && ob.k === 'disc' && ob.detailPart === 'car') { const L = meshLamp(ob, root, A); if (L) return { ...n, ...L }; }
    return n;
  }
  const seedOf = p => (p.src.traffic && p.src.traffic.seed) || 0;
  // Crest deer for the lap of `dist` and the next one (so a lap's first deer is built before the lap changes). Two per lap, as before.
  function crestDeer(dist) {
    const lap = Math.floor(dist / PERIOD), out = [];
    for (let L = lap; L <= lap + 1; L++) for (const c of [160, 969]) { const rel = L * PERIOD + c - dist; if (rel > -10 && rel < 300) out.push({ rel, id: L + ':crest:' + c, side: 1 }); }
    return out;
  }
  // Bolt clocks for the crest deer, started when the car comes within the deer's own trigger distance (the same rule as the flat scenes, drive-anim.js activate).
  function activate(src, dist, t, act) {
    const seed = (src.traffic && src.traffic.seed) || 0, lap = Math.floor(dist / PERIOD);
    for (const c of [160, 969]) for (let L = lap; L <= lap + 1; L++) {
      const id = L + ':crest:' + c, rel = L * PERIOD + c - dist;
      if (!act.has('@' + id) && rel <= D.Models.deerProfile(seed + ':' + id).trigger) act.set('@' + id, t);
    }
  }
  // Sparse street lamps: two 120 m stretches per lap, positions seeded by the traffic seed, clear of the crest deer (160 m, 969 m). Lamps alternate sides.
  function lampSpots(dist, seed) {
    const r = D.rng(9100 + (seed | 0)), lap = Math.floor(dist / PERIOD), starts = [300 + Math.floor(60 * r()), 1040 + Math.floor(40 * r())], out = [];
    let n = 0;
    for (let L = lap; L <= lap + 1; L++) for (const st of starts) for (let u = 20; u < 120; u += 40, n++) {
      const rel = L * PERIOD + st + u - dist;
      if (rel > -10 && rel < 300) out.push({ rel, side: n % 2 ? 1 : -1 });
    }
    return out;
  }
  function world(p, dist, t, tauOf) {
    const A = route(dist, p.lane, !!p.touge), K = D.kit({ Lw: p.lane, A, rand: D.rng(701) }), obs = [], flags = p.src.tiles.flags;
    const lo = Math.floor((dist - 10) / 8) * 8, hi = dist + 300;
    for (let s = lo; s <= hi; s += 8) {
      const rel = s - dist, off = -p.lane / 2 - 1.2;
      // Short W-beam proxies follow the tangent; reflector plates face both approaches.
      const q = A.at(rel, off), yaw = Math.atan2(q.t[1], q.t[0]);
      obs.push({ k: 'box', x: q.p[0], y: q.p[1], z0: .62, z1: .9, hx: 4.05, hy: .065, yaw, mat: 'sign-back', cls: 'rail' });
      obs.push({ k: 'cyl', x: q.p[0], y: q.p[1], z0: 0, z1: .83, r: .06, mat: 'sign-back', cls: 'rail' });
      if (flags.posts !== false) for (const face of [-1, 1]) obs.push({ k: 'disc', x: q.p[0] + face * .08 * q.t[0], y: q.p[1] + face * .08 * q.t[1], z: .86, r: .065, nx: face * q.t[0], ny: face * q.t[1], nz: 0, mat: 'reflector-white', sub: true, cls: 'post' });
    }
    // POWERLINES on the pass (opt-in, default off: nothing below runs). Poles sit at absolute route positions every 60 m (same pattern as the
    // open road), on the reflector side of the road. Each pole and each wire end takes the road height at its own position, so the wires follow
    // the grade and the bank. Wires are built from those lifted 3D ends and tougePlaced, so lift() does not add the height a second time.
    if (flags.powerlines === 'on') {
      const POLE = 9, ATT = 8.6, SAG = 0.6, N = 8, WIRE_R = 0.03, OFF = -p.lane / 2 - 1.2;   // ATT, SAG, WIRE_R: tuning values
      for (let S = Math.floor((dist - 80) / 60) * 60 + 20; S <= hi + 60; S += 60) {
        const r = S - dist, q = A.at(r, OFF);
        obs.push({ k: 'cyl', x: q.p[0], y: q.p[1], r: .13, z0: A.height(r, OFF), z1: A.height(r, OFF) + POLE, mat: 'pole', cls: 'powerline', tougePlaced: true });
      }
      for (let S = Math.floor((dist - 80) / 60) * 60 + 20; S <= hi; S += 60) for (const dy of [-.35, .35]) {
        const r0 = S - dist, off = OFF + dy, zA = A.height(r0, off) + ATT, zB = A.height(r0 + 60, off) + ATT;
        const P = (t) => { const q = A.at(r0 + 60 * t, off); return [q.p[0], q.p[1], zA * (1 - t) + zB * t - 4 * SAG * t * (1 - t)]; };
        for (let j = 0; j < N; j++) {
          const a = P(j / N), b = P((j + 1) / N), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
          const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          obs.push({ k: 'cyl', x: c[0], y: c[1], z0: c[2] - L / 2, z1: c[2] + L / 2, r: WIRE_R, axis: d.map((v) => v / L), mat: 'wire', cls: 'powerline', tougePlaced: true });
        }
      }
    }
    const treeStep=18/Math.max(.5,Math.min(3,p.src.tiles.density || 1.5)/1.5);
    if (flags.veg !== false) for (let s = Math.floor((dist - 10) / treeStep) * treeStep; s < hi; s += treeStep) {
      K.tree(s - dist, 1.5 * p.lane + 6 + 3 * Math.sin(s), { h: 9 + 2 * Math.cos(s), id: 'pass-tree:' + s });
      if (s % 36 === 0) K.tree(s - dist, -p.lane / 2 - 15, { h: 11, id: 'pass-tree-drop:' + s });
    }
    const deerOn = D.Models.deerEnabled(p), lampRGB = p.src.tiles.lamps === 'led' ? [1, .85, .66] : [1, .43, .10], lights = [];
    if (flags.animals !== false) for (const c of crestDeer(dist)) {
      // Behaviour on: the flat scenes' deer model, attention and bolt (tauOf is the activate clock; -1 = still grazing). Off: the original standing deer.
      const att = deerOn ? D.Models.deerAttention(seedOf(p) + ':' + c.id, tauOf ? tauOf('@' + c.id) : -1) : null, bolting = !!att && att.state === 'bolt', d = bolting ? Math.max(0, att.elapsed - att.bolt) * 3.8 : 0;
      K.deer(c.rel, .35 + c.side * d, deerOn ? { id: c.id, attention: att, normal: A.touge ? A.surface(c.rel, .35 + c.side * d).normal : undefined, face: bolting ? -1 : 1, motion: D.Models.locomotion('deer', d, 3.8, bolting, 'bound') } : { id: c.id });
    }
    if (p.src.tiles.lamps !== 'off') for (const c of lampSpots(dist, seedOf(p))) {
      const b = c.side < 0 ? -p.lane / 2 - 1 : 1.5 * p.lane + 1, head = b - c.side * .8, pole = K.at(c.rel, b), hd = K.at(c.rel, head), mid = K.at(c.rel, (b + head) / 2);
      obs.push({ k: 'cyl', x: pole.x, y: pole.y, r: .065, z0: 0, z1: 7, mat: 'pole', cls: 'street-lamp' });
      obs.push({ k: 'box', x: mid.x, y: mid.y, hx: .08, hy: Math.abs(b - head) / 2, z0: 6.9, z1: 7, yaw: mid.yaw, mat: 'pole', cls: 'street-lamp' });
      obs.push({ k: 'ell', x: hd.x, y: hd.y, z: 6.9, rx: .3, ry: .18, rz: .05, mat: 'lamp-head', emit: lampRGB.map(v => 9000 * v), cls: 'street-lamp' });
      lights.push({ x: hd.x, y: hd.y, z: 6.85 + A.height(c.rel, head), cd: 900, rgb: lampRGB, lampStreet: [c.side * Math.sin(hd.yaw), -c.side * Math.cos(hd.yaw)] });
    }
    for(let k=Math.floor((dist-80)/200);k<=Math.floor((dist+240)/200);k++){
      const rel=k*200+65-dist;if(rel< -10 || rel>300)continue;
      if(flags.obstacle)K.obstacle(rel+5,-.4);
      if(flags.signs!==false)K.sign(rel,1.5*p.lane+1,'yellow');
    }
    // SB1: lane studs on the pass, on the same centre and edge lines as the flat scenes. Absolute route positions (the pattern does not shift with the car);
    // they go through lift() with the other pass objects, so they follow the grade and the bank like the posts do.
    if (D.resolveFeatures({ preset: 'pass', overrides: { studs: flags.rpm } }).studs) D.laneStuds(K, D.laneMarkings(p.lane, { us: p.us, broken: !!p.src.tiles.broken }), p.lane, p.us, dist - 10, dist + 300, dist);
    obs.push(...D.Models.actors(K.O, !!p.detailedModels));
    obs.push(...RF.DriveAnim.trafficObjects(p.src, RF.DriveAnim.trafficCars(p.src, dist, t), A, p));
    const roots = new Map(obs.filter(ob => ob.treeId && ob.detail).map(ob => [ob.treeId,[ob.x,ob.y]]));
    // CR2: lamps of a car drawn as the GPU mesh follow its mount. Same gate as drive-three-objects.js (pass + detailed models; p.touge is set only with the GPU renderer).
    const carRoots = p.touge && p.detailedModels ? new Map(obs.filter(ob => ob.detailPart === 'car' && ob.detail).map(ob => [ob.modelId, ob.detail])) : null;
    const placed=obs.map(ob => lift(ob.treeId ? {...ob,surfaceAnchor:roots.get(ob.treeId)} : ob, A, carRoots && ob.detailPart === 'car' ? carRoots.get(ob.modelId) : undefined));
    if(A.touge)trafficLight(placed,A,p);
    // Edge lines and the centre line, as the flat scenes draw them (US: double solid or broken yellow; EU: dashed). Pattern positions follow the car like the flat markings do.
    const marks = D.laneMarkings(p.lane, { us: p.us, broken: !!p.src.tiles.broken });
    return { A, objects: placed, markings: marks.map(m => m.pat ? { ...m, pat: { ...m.pat, s0: m.pat.s0 - dist, s1: m.pat.s1 - dist } } : m), crossings: [], lights };
  }
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const L=Math.hypot(...a);return a.map(v=>v/L);};
  const apply=(axes,p)=>[0,1,2].map(j=>axes.reduce((sum,v,i)=>sum+p[i]*v[j],0));
  function blocked(A,start,end){
    for(let k=1;k<64;k++){const t=k/64,q=start.map((x,i)=>x+(end[i]-x)*t),f=A.frame(q[0],q[1]);if(A.height(f.s,f.off)>q[2]+.02)return true;}
    return false;
  }
  function trafficLight(obs,A,p){
    const a=attitude(A.dist),eye=apply([a.forward,a.left,a.up],[-2,.37,1.2]),tr=p.src.traffic,hasDesign=p.lut.data.some(v=>v>0);
    for(const ob of obs)if(ob.headlamp){
      const pk=D.trafficPickOf(p,ob.traffic), tint=pk&&pk.tint?pk.tint:[1,1,1];   // BT: this car's own beam and colour, when the shuffle gives it one
      const f=A.frame(ob.x,ob.y),q=A.surface(f.s,f.off),dir=ob.nx*f.t[0]+ob.ny*f.t[1],forward=unit([ob.nx,ob.ny,q.grade*dir]),left=unit(cross(q.normal,forward)),d=eye.map((v,i)=>v-[ob.x,ob.y,ob.z][i]),local=[dot(d,forward),dot(d,left),dot(d,q.normal)];
      const cosine=Math.max(1e-6,local[0]/Math.hypot(...d));let cd=0;
      if(local[0]>0 && !blocked(A,eye,[ob.x,ob.y,ob.z])){
        if(tr.onMode==='manual')cd=Math.max(0,tr.onKcd)*500*cosine**8;
        else if(tr.onMode==='symmetric' && hasDesign)cd=pk?D.beamAt(pk.lut,pk.conv,...local):D.beamAt(p.lowLut||p.lut,p.conv||'A',...local);
        else{D.hvFast(...local,'A');const [h,v]=D.hv();cd=D.Headlamp.generic(h,v,tr.onMode==='high');}
      }
      const L=cd/(Math.PI*ob.r*ob.r*cosine);ob.eyeCd=cd;ob.emit=[L*tint[0],L*tint[1],.93*L*tint[2]];ob.emitPow=1;
    }
  }
  // Same function as the flat scenes (D.glareSources, opts as there: lights, lampClass, lampKind; every glare source, Brief U). Visibility and cd are decided
  // here in the world frame (terrain, occluders, lamp-dist gamma from world z-up); D.glareSources then sees car-frame copies.
  function glareSources(obs,dist,A,opts){
    opts=opts||{};
    const a=attitude(dist),axes=[a.forward,a.left,a.up],eye=apply(axes,[-2,.37,1.2]),sources=[];   // eye and obs are both world frame here
    for(const ob of obs)if(D.glareEmitter(ob) && !blocked(A,eye,[ob.x,ob.y,ob.z]) && !D.occluded([ob.x,ob.y,ob.z],eye,obs)){
      const p=[ob.x,ob.y,ob.z],q=axes.map(v=>dot(p,v)),n=axes.map(v=>dot([ob.nx,ob.ny,ob.nz||0],v));sources.push({...ob,x:q[0],y:q[1],z:q[2],nx:n[0],ny:n[1],nz:n[2]});
    }
    const lights=[];
    for(const L of opts.lights||[]){
      if(blocked(A,eye,[L.x,L.y,L.z])||!D.lightVisible(L,eye,obs))continue;
      const q=axes.map(v=>dot([L.x,L.y,L.z],v));lights.push({...L,x:q[0],y:q[1],z:q[2],eyeCd:D.lampEyeCd(L,eye,opts)});
    }
    return D.glareSources(sources,[-2,.37,1.2],undefined,{lights,lampClass:opts.lampClass,lampKind:opts.lampKind});
  }
  function eyeLux(p, car) {
    const A=p.A, q=A.surface(car.rel,car.off,1.1), a=attitude(A.dist), axis=[a.forward,a.left,a.up], dot=(v,w)=>v.reduce((s,x,i)=>s+x*w[i],0);
    let E=0;
    for(const lamp of p.lamps){const L=[0,0,0];for(let j=0;j<3;j++)for(let i=0;i<3;i++)L[j]+=lamp[i]*axis[i][j];
      const d=q.p.map((x,i)=>x-L[i]), r2=dot(d,d), local=axis.map(v=>dot(d,v)), incidence=(d[0]*q.t[0]+d[1]*q.t[1]+d[2]*q.t[2])/Math.sqrt(r2*(1+q.grade*q.grade));
      if(incidence<=0 || local[0]<=0)continue;
      let blocked=false;
      for(let k=1;k<32;k++){const t=k/32,x=L[0]+d[0]*t,y=L[1]+d[1]*t,f=A.frame(x,y);if(A.height(f.s,f.off)>L[2]+d[2]*t+.02){blocked=true;break;}}
      if(!blocked)E+=D.ownBeamAt(p,...local,lamp[1])*incidence/r2;
    }return E;
  }
  RF.Touge = { curvature: s => RF.DriveAnim.curvatureAt({ tiles: { mountain: true } }, s), glareSources, blocked, eyeLux, PERIOD, curves, kinds, tile, profile, bank, terrain, route, attitude, lift, world, activate, crestDeer, lampSpots };
})(typeof self !== 'undefined' ? self : globalThis);
