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
  function lift(ob, A) {
    if (!A.touge || ob.tougePlaced) return ob;
    const f = A.frame(ob.surfaceAnchor ? ob.surfaceAnchor[0] : ob.x, ob.surfaceAnchor ? ob.surfaceAnchor[1] : ob.y), z = A.height(f.s, f.off), n = { ...ob, bs: undefined, tougePlaced: true };
    if (n.z !== undefined) n.z += z;
    if (n.z0 !== undefined) { n.z0 += z; n.z1 += z; }
    // M2 sphere-cluster trees and SDF actors stay upright; all roots use the same surface.
    if (ob.traffic || ob.cls === 'rail') { const q = A.surface(f.s,f.off), t = A.at(f.s).t; n.passSlope = [q.grade*t[0]-q.bank*t[1],q.grade*t[1]+q.bank*t[0],0,0]; }
    if (n.detail) n.detail = { ...n.detail, z: (n.detail.z || 0) + z };
    return n;
  }
  function world(p, dist, t) {
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
    const treeStep=18/Math.max(.5,Math.min(3,p.src.tiles.density || 1.5)/1.5);
    if (flags.veg !== false) for (let s = Math.floor((dist - 10) / treeStep) * treeStep; s < hi; s += treeStep) {
      K.tree(s - dist, 1.5 * p.lane + 6 + 3 * Math.sin(s), { h: 9 + 2 * Math.cos(s), id: 'pass-tree:' + s });
      if (s % 36 === 0) K.tree(s - dist, -p.lane / 2 - 15, { h: 11, id: 'pass-tree-drop:' + s });
    }
    if (flags.animals !== false) for (const crest of [160, 969]) {
      const s = Math.floor(dist / PERIOD) * PERIOD + crest, rel = s - dist;
      if (rel > -10 && rel < 300) K.deer(rel, .35, { id: 'crest-deer:' + s });
    }
    for(let k=Math.floor((dist-80)/200);k<=Math.floor((dist+240)/200);k++){
      const rel=k*200+65-dist;if(rel< -10 || rel>300)continue;
      if(flags.obstacle)K.obstacle(rel+5,-.4);
      if(flags.signs!==false)K.sign(rel,1.5*p.lane+1,'yellow');
    }
    obs.push(...D.Models.actors(K.O, true));
    obs.push(...RF.DriveAnim.trafficObjects(p.src, RF.DriveAnim.trafficCars(p.src, dist, t), A, p));
    const roots = new Map(obs.filter(ob => ob.treeId && ob.detail).map(ob => [ob.treeId,[ob.x,ob.y]]));
    const placed=obs.map(ob => lift(ob.treeId ? {...ob,surfaceAnchor:roots.get(ob.treeId)} : ob, A));
    if(A.touge)trafficLight(placed,A,p);
    return { A, objects: placed, markings: D.laneMarkings(p.lane, { us: p.us }).map(m => m.pat ? { ...m, pat: { ...m.pat, s0: m.pat.s0 - dist, s1: m.pat.s1 - dist } } : m), crossings: [], lights: [] };
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
      const f=A.frame(ob.x,ob.y),q=A.surface(f.s,f.off),dir=ob.nx*f.t[0]+ob.ny*f.t[1],forward=unit([ob.nx,ob.ny,q.grade*dir]),left=unit(cross(q.normal,forward)),d=eye.map((v,i)=>v-[ob.x,ob.y,ob.z][i]),local=[dot(d,forward),dot(d,left),dot(d,q.normal)];
      const cosine=Math.max(1e-6,local[0]/Math.hypot(...d));let cd=0;
      if(local[0]>0 && !blocked(A,eye,[ob.x,ob.y,ob.z])){
        if(tr.onMode==='manual')cd=Math.max(0,tr.onKcd)*500*cosine**8;
        else if(tr.onMode==='symmetric' && hasDesign)cd=D.beamAt(p.lut,p.conv||'A',...local);
        else{D.hvFast(...local,'A');const [h,v]=D.hv();cd=D.Headlamp.generic(h,v,tr.onMode==='high');}
      }
      const L=cd/(Math.PI*ob.r*ob.r*cosine);ob.eyeCd=cd;ob.emit=[L,L,.93*L];ob.emitPow=1;
    }
  }
  function glareSources(obs,dist,A){
    const a=attitude(dist),axes=[a.forward,a.left,a.up],eye=apply(axes,[-2,.37,1.2]),sources=[];
    for(const ob of obs)if(ob.headlamp && !blocked(A,eye,[ob.x,ob.y,ob.z]) && !D.occluded([ob.x,ob.y,ob.z],eye,obs)){   // eye and obs are both world frame here
      const p=[ob.x,ob.y,ob.z],q=axes.map(v=>dot(p,v)),n=axes.map(v=>dot([ob.nx,ob.ny,ob.nz||0],v));sources.push({...ob,x:q[0],y:q[1],z:q[2],nx:n[0],ny:n[1],nz:n[2]});
    }
    return D.glareSources(sources,[-2,.37,1.2]);
  }
  function eyeLux(p, car) {
    const A=p.A, q=A.surface(car.rel,car.off,1.1), a=attitude(A.dist), axis=[a.forward,a.left,a.up], dot=(v,w)=>v.reduce((s,x,i)=>s+x*w[i],0);
    let E=0;
    for(const lamp of p.lamps){const L=[0,0,0];for(let j=0;j<3;j++)for(let i=0;i<3;i++)L[j]+=lamp[i]*axis[i][j];
      const d=q.p.map((x,i)=>x-L[i]), r2=dot(d,d), local=axis.map(v=>dot(d,v)), incidence=(d[0]*q.t[0]+d[1]*q.t[1]+d[2]*q.t[2])/Math.sqrt(r2*(1+q.grade*q.grade));
      if(incidence<=0 || local[0]<=0)continue;
      let blocked=false;
      for(let k=1;k<32;k++){const t=k/32,x=L[0]+d[0]*t,y=L[1]+d[1]*t,f=A.frame(x,y);if(A.height(f.s,f.off)>L[2]+d[2]*t+.02){blocked=true;break;}}
      if(!blocked)E+=D.beamAt(p.lut,p.conv||'A',...local,p.pitch||0)*incidence/r2;
    }return E;
  }
  RF.Touge = { glareSources, blocked, eyeLux, PERIOD, curves, kinds, tile, profile, bank, terrain, route, attitude, lift, world };
})(typeof self !== 'undefined' ? self : globalThis);
