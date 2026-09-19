(function (G) {
  'use strict';
  const V = {
    add: (a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
    sub: (a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
    mul: (a,s)=>[a[0]*s,a[1]*s,a[2]*s],
    dot: (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
    cross: (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    len: a=>Math.hypot(...a),
    unit(a) { const n=this.len(a); return n ? this.mul(a,1/n) : [0,0,1]; },
    distance(a,b) { return this.len(this.sub(a,b)); },
    reflect(d,n) { return this.sub(d,this.mul(n,2*this.dot(d,n))); },
    clamp: (x,a,b)=>Math.max(a,Math.min(b,x)),
    frame(n) { n=this.unit(n); const u=this.unit(this.cross(Math.abs(n[1])<.9?[0,1,0]:[1,0,0],n)); return {u,v:this.cross(n,u),n}; },
    // Frame for the TARGET plane, which only ever rotates about world X, so its
    // horizontal axis is always world horizontal. frame() derives one instead and
    // switches reference axis at |n_y| = 0.9 — a visible discontinuity at 64.2
    // degrees of tilt, which is why the target used to break near the slider end.
    // This reproduces frame() EXACTLY while |n_y| < 0.9 (u = [-1,0,0] and
    // v = [0,cos,sin]) and stays continuous past it, including a horizontal plane.
    planeFrame(n) {
      n=this.unit(n);
      const a=this.add([-1,0,0],this.mul(n,n[0]));  // [-1,0,0] with its component along n removed
      if(this.len(a)<1e-6) return this.frame(n);    // normal is world X: no horizontal axis to preserve
      const u=this.unit(a); return {u,v:this.cross(n,u),n};
    },
    // NOTE: frame() returns u=[-1,0,0] for a -Z normal, which is why the target
    // map renders mirrored in the 3D scene. Negating u alone was tried and made
    // it WORSE — mirrored and inverted, i.e. a 180 degree rotation — so the
    // vertical convention is entangled with it and the two must be fixed
    // together, against a measurement rather than a derivation. See the
    // Known issues section of README.md before attempting this.
    // planeFrame() deliberately PRESERVES that same u, so it does not touch this.

    local(p,f) { return [this.dot(p,f.u),this.dot(p,f.v),this.dot(p,f.n)]; },
    world(p,f) { return this.add(this.add(this.mul(f.u,p[0]),this.mul(f.v,p[1])),this.mul(f.n,p[2])); },
    axis(yaw,pitch) { return [Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]; }
  };
  class RNG {
    constructor(seed=12345) { this.s=seed>>>0; }
    next() { let t=this.s+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }
  }
  function hashGrid(grid) { let h=2166136261; const a=new Uint8Array(grid.buffer,grid.byteOffset,grid.byteLength); for(const b of a) h=Math.imul(h^b,16777619); return (h>>>0).toString(16).padStart(8,'0'); }
  // Vector Snell: tangent scales by n1/n2; the unit-length constraint gives
  // the normal component. A negative radicand means total internal reflection.
  function snell(d,outward,n1,n2) {
    const n=V.dot(d,outward)>0?V.mul(outward,-1):outward;
    const ci=-V.dot(d,n), eta=n1/n2, k=1-eta*eta*(1-ci*ci);
    if(k<0) return {tir:true,d:V.reflect(d,n),R:1};
    const ct=Math.sqrt(k), rs=(n1*ci-n2*ct)/(n1*ci+n2*ct), rp=(n2*ci-n1*ct)/(n2*ci+n1*ct);
    return {tir:false,d:V.unit(V.add(V.mul(d,eta),V.mul(n,eta*ci-ct))),R:(rs*rs+rp*rp)/2};
  }
  G.Optics={V,RNG,hashGrid,snell};
})(globalThis);
