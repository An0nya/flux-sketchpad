/* Pupil: a deterministic reflector designer using a paraxial image dictionary. */
(() => {
  'use strict';
  const { V, Geo, Source, Engine, Photometry } = RF;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  // Fit a regular, projected pupil inside a family of confocal paraboloids.
  // For coordinates (u,v) perpendicular to the throw axis, r - x = f.
  function pupil(env, src, axis, u, v, cap, keep, feature, die, magnification, fill) {
    const { pos: L } = src, axes = Source.frame(src);
    const ranges = [u, v].map((e) => {
      const c = V.dot(V.sub(env.center, L), e), h = env.half.reduce((s, w, i) => s + w * Math.abs(e[i]), 0);
      return [c - h, c + h];
    });
    const span = Math.max(...ranges.map(([a, b]) => b - a)), probe = span / 32;
    const maxF = V.len(V.sub(env.center, L)) + V.len(env.half);
    const safeEnv = { ...env, half: env.half.map(h => h * 0.97) };
    function site(f, x, y) {
      const h = ((x * x + y * y) / f - f) / 2, r = h + f;
      if (r < keep * 1.02 || f / r < 0.14) return null;
      const P = V.add(L, V.add(V.mul(axis, h), V.add(V.mul(u, x), V.mul(v, y))));
      if (!Geo.envInside(safeEnv, P)) return null;
      const d = V.mul(V.sub(P, L), 1 / r), ct = V.dot(d, axes.a);
      const I = Source.intensity(src, Math.acos(clamp(ct, -1, 1)));
      if (!(I > 0)) return null;
      return { P, d, r, I, x, y, ct, E: I / (r * r) };
    }
    function grid(f, step, dx, dy, visit) {
      for (let y = ranges[1][0] + step * dy; y < ranges[1][1]; y += step)
        for (let x = ranges[0][0] + step * dx; x < ranges[0][1]; x += step) {
          const s = site(f, x, y); if (s) visit(s);
        }
    }
    let best = 0, F = maxF / 2, area = 0;
    for (let i = 0; i < 21; i++) {
      const f = maxF * (0.09 + i * 0.075);
      let score = 0, n = 0;
      grid(f, probe, 0.5, 0.5, s => {
        n++;
        const width = die * magnification / s.r;
        score += s.E / (1 + (width / Math.max(feature, 1e-6)) ** 2);
      });
      if (score > best) { best = score; F = f; area = n * probe ** 2; }
    }
    if (!area) return [];
    let bestGrid = [], metric = -1;
    const step0 = Math.sqrt(area / cap);
    for (const fac of [1, 0.91, 1.08, 1.18]) for (const [dx, dy] of [[.5,.5],[.83,.19],[.17,.81],[.11,.27]]) {
      const step = step0 * fac, sites = [];
      grid(F, step, dx, dy, s => {
        s.step = step * fill;
        s.quality = s.E / (1 + (die * magnification / s.r / Math.max(feature, 1e-6)) ** 2);
        sites.push(s);
      });
      sites.sort((a, b) => b.quality - a.quality);
      sites.length = Math.min(sites.length, cap);
      const sum = sites.reduce((e, s) => e + s.quality * s.step ** 2, 0);
      if (sum > metric) { metric = sum; bestGrid = sites; }
    }
    return bestGrid;
  }

  // Conservative bound on the near sheet of z + quadratic = 0 over the
  // entire tangent polygon. A bounding prism then suffices for convex cases.
  function aperture(site, Z, U, W, width, height, alpha, env, emitters, keep, makeClip) {
    const { P, d, r } = site, a = V.norm(V.sub(Z, P)), L = V.dist(Z, P);
    const n = V.norm(V.sub(a, d)), c = V.dot(n, a);
    if (!(c > .19) || !(V.dot(V.cross(U,W),a) < -1e-5)) return null;
    const u = V.madd(U, a, -V.dot(U, n) / c), v = V.madd(W, a, -V.dot(W, n) / c);
    const di = L / (1 + alpha), S0 = site.S0;
    const q = Geo.facetQuadric(P, S0, Z, di), A = q.A;
    const form = (x, y) => x[0]*(A[0]*y[0]+A[1]*y[1]+A[2]*y[2]) + x[1]*(A[3]*y[0]+A[4]*y[1]+A[5]*y[2]) + x[2]*(A[6]*y[0]+A[7]*y[1]+A[8]*y[2]);
    const corners = signs.map(([i, j]) => V.add(V.mul(u, i * width / 2), V.mul(v, j * height / 2)));
    let C = 0, B = 0;
    for (const t of corners) { C = Math.max(C, form(t,t)); B = Math.max(B, Math.abs(2*form(t,n))); }
    const D = form(n,n), disc = (1-B)**2 - 4*D*C;
    if (B >= .8 || !(disc > .04) || !isFinite(C)) return null;
    const sag = 2*C / (1-B + Math.sqrt(disc));
    if (!(sag < .22 * r)) return null;
    // The engine clips the near sheet with a slab. Keep the other root outside
    // even the largest slab the engine can construct from the corner sags.
    const radius = Math.max(...corners.map(V.len));
    if (D>0 && (1-B+Math.sqrt(disc))/(2*D) <= 2*sag+radius*1e-6) return null;
    const pts = corners.map(t => V.add(P, t));
    for (const pt of pts) {
      const end = V.madd(pt, n, sag);
      if (!Geo.envInside(env, pt) || !Geo.envInside(env, end)) return null;
      for (const s of emitters) {
        let sep = V.sub(P, s.pos);
        // A dome may shift the apparent emitter axially. Clear the entire
        // source axis if the host did not provide the real die position.
        if (s.domeMag) {
          const a = V.norm(s.axis);
          sep = V.madd(sep, a, -V.dot(sep, a));
        }
        const axis = V.norm(sep);
        if (V.dot(V.sub(pt, s.pos), axis) < keep || V.dot(V.sub(end, s.pos), axis) < keep) return null;
      }
    }
    return { di, pts: makeClip ? pts : null };
  }

  // Area of a projected die polygon in a unit pixel (Sutherland–Hodgman).
  function clip(poly, axis, value, sign) {
    if (!poly.length) return poly;
    const out = [];
    let a = poly[poly.length - 1], da = sign * (a[axis] - value);
    for (const b of poly) {
      const db = sign * (b[axis] - value);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db); out.push([a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]);
      }
      if (db >= 0) out.push(b);
      a = b; da = db;
    }
    return out;
  }
  function polyArea(p) {
    let sum = 0;
    for (let i = 0, j = p.length-1; i < p.length; j = i++) sum += p[j][0]*p[i][1]-p[j][1]*p[i][0];
    return .5*Math.abs(sum);
  }

  function dieImage(site, Z, T, src, fr, cell, widthLimit) {
    const a = V.norm(V.sub(Z, site.P)), n = V.norm(V.sub(a, site.d)), L = V.dist(Z, site.P);
    function project(e, size) {
      const b = V.reflect(e, n), t = V.madd(b, a, -V.dot(b, T.n) / V.dot(a, T.n));
      const m = -size * L / (2 * site.r * cell);
      return [V.dot(t, T.tu)*m, V.dot(t, T.tv)*m];
    }
    let poly;
    if (src.kind === 'point') return { w: 1, h: 1, vals: [1] };
    if (src.kind === 'planar' && src.shape !== 'disc') {
      const u = project(fr.u, src.w), v = project(fr.v, src.h);
      poly = signs.map(([i,j]) => [i*u[0]+j*v[0], i*u[1]+j*v[1]]);
    } else if (src.kind === 'planar') {
      const u = project(fr.u, src.radius * 2), v = project(fr.v, src.radius * 2);
      poly = Array.from({length: 20}, (_,k) => {
        const t = k*Math.PI/10, c = Math.cos(t), s = Math.sin(t);
        return [c*u[0]+s*v[0], c*u[1]+s*v[1]];
      });
    } else {
      // Equivalent uniform ellipse from the volume emitter's second moments.
      const q = src.shape === 'cylinder' ? [src.radius, src.radius, src.length / Math.sqrt(3)] : Array(3).fill(src.radius * 2 / Math.sqrt(5));
      const bv = [fr.u, fr.v, fr.a].map((e,i) => project(e, 2*q[i]));
      let xx=0, xy=0, yy=0;
      for (const [x,y] of bv) { xx+=x*x; xy+=x*y; yy+=y*y; }
      const u=Math.sqrt(xx), v=u ? xy/u : 0, t=Math.sqrt(Math.max(0,yy-v*v));
      poly = Array.from({length: 20}, (_,k) => [u*Math.cos(k*Math.PI/10), v*Math.cos(k*Math.PI/10)+t*Math.sin(k*Math.PI/10)]);
    }
    const hx = Math.min(widthLimit, Math.max(0, Math.ceil(Math.max(...poly.map(p=>Math.abs(p[0]))) - .5)));
    const hy = Math.min(widthLimit, Math.max(0, Math.ceil(Math.max(...poly.map(p=>Math.abs(p[1]))) - .5)));
    const w=2*hx+1, h=2*hy+1, vals=new Float32Array(w*h), A=polyArea(poly);
    if (!(A > 1e-8)) return { w: 1, h: 1, vals: [1] };
    for (let y=-hy; y<=hy; y++) {
      const row=clip(clip(poly,1,y-.5,1),1,y+.5,-1);
      for (let x=-hx; x<=hx; x++) vals[(y+hy)*w+x+hx]=polyArea(clip(clip(row,0,x-.5,1),0,x+.5,-1))/A;
    }
    return { w,h,vals };
  }

  // Convolve with a rectangular defocus footprint. Widths are in working pixels.
  function defocus(img, width, height) {
    if (width <= 0) return img;
    function taps(size) {
      const k=Math.ceil(size / 2), weights=[];
      for (let i=-k; i<=k; i++) weights.push(Math.max(0,Math.min(i+.5,size/2)-Math.max(i-.5,-size/2))/size);
      return weights;
    }
    const wx=taps(width), wy=width===height ? wx : taps(height);
    const w=img.w+wx.length-1, h=img.h+wy.length-1, tmp=new Float32Array(w*img.h), vals=new Float32Array(w*h);
    for (let j=0;j<img.h;j++) for (let i=0;i<img.w;i++) for (let a=0;a<wx.length;a++) tmp[j*w+i+a]+=img.vals[j*img.w+i]*wx[a];
    for (let j=0;j<img.h;j++) for (let i=0;i<w;i++) for (let a=0;a<wy.length;a++) vals[(j+a)*w+i]+=tmp[j*w+i]*wy[a];
    return {w,h,vals};
  }

  function painting(paint, T, cap) {
    const R=paint.res, src=paint.cells;
    let loX=R, loY=R, hiX=-1, hiY=-1, count=0, sum=0, edgesX=0, edgesY=0, cx=0, cy=0;
    for (let k=0;k<R*R;k++) if (src[k]>0) {
      const x=k%R, y=(k/R)|0;
      loX=Math.min(loX,x); loY=Math.min(loY,y); hiX=Math.max(hiX,x); hiY=Math.max(hiY,y);
      count++; sum+=src[k]; cx+=src[k]*(x+.5); cy+=src[k]*(y+.5);
      edgesX += +(x===0 || !(src[k-1]>0)) + +(x===R-1 || !(src[k+1]>0));
      edgesY += +(!(src[k-R]>0)) + +(!(src[k+R]>0));
    }
    if (!count) return null;
    const cell=2*T.half/R, ds=Math.max(1, Math.ceil(Math.max(hiX-loX+1, hiY-loY+1) / clamp(6*Math.sqrt(cap), 30, 64)));
    const w=Math.ceil((hiX-loX+1)/ds), h=Math.ceil((hiY-loY+1)/ds);
    const feature = Math.max(1, 2*count/(edgesX+edgesY)) * cell;
    const pad = Math.min(48, Math.max(10, Math.ceil(feature/(cell*ds)*2)));
    const stride=w+2*pad, height=h+2*pad, values=new Float32Array(stride*height);
    const representative=new Int32Array(values.length).fill(-1), coverage=new Float32Array(values.length);
    for (let y=loY;y<=hiY;y++) for (let x=loX;x<=hiX;x++) {
      const px=y*R+x;
      if (!(src[px]>0)) continue;
      const k=(pad+Math.floor((y-loY)/ds))*stride+pad+Math.floor((x-loX)/ds);
      values[k] += src[px]*count/(sum*ds*ds);
      coverage[k] += 1/(ds*ds);
      if (representative[k]<0) representative[k]=px;
    }
    const anchors=[];
    for (let y=pad;y<pad+h;y++) for (let x=pad;x<pad+w;x++) if(values[y*stride+x]>0) anchors.push([x,y]);
    const world = (x,y) => Engine.targetUVtoWorld(T, (loX+(x-pad+.5)*ds)*cell-T.half, (loY+(y-pad+.5)*ds)*cell-T.half);
    return { stride,height,values,anchors,world,cell:cell*ds,feature,pad,count:count/(ds*ds),w,h,
      featureX:2*count/(edgesX*ds),featureY:2*count/(edgesY*ds),representative,coverage,
      center:Engine.targetUVtoWorld(T,cx/sum*cell-T.half,cy/sum*cell-T.half) };
  }

  // A local kernel is a compact list of offsets, reused at every candidate aim.
  function stencil(img, stride, x, y) {
    const offsets=[], val=[];
    for(let j=0;j<img.h;j++) for(let i=0;i<img.w;i++) {
      const dx=i-(img.w>>1), dy=j-(img.h>>1), z=img.vals[j*img.w+i];
      if (z>1e-6 && Math.abs(dx)<x && Math.abs(dy)<y) { offsets.push(dy*stride+dx); val.push(z); }
    }
    return { o:Int32Array.from(offsets), v:Float32Array.from(val) };
  }

  // Direct irradiance from the differential solid angle of a target cell.
  // It is a smooth background, not part of the image dictionary.
  function directModel(emitters, T) {
    const total = emitters.reduce((s,e) => s + e.power, 0);
    const lights = emitters.map(src => ({src, axis:Source.frame(src).a, gain:src.power/(total*Source.totalIntegral(src))}));
    return (Z) => {
      let flux = 0;
      for (const {src,axis,gain} of lights) {
        const delta=V.sub(Z,src.pos), r=V.len(delta);
        if (!(r>0)) continue;
        const d=V.mul(delta,1/r), front=-V.dot(d,T.n);
        if (front>0) flux+=gain*front*Source.intensity(src,Math.acos(clamp(V.dot(d,axis),-1,1)))/(r*r);
      }
      return flux;
    };
  }

  // A small stop can remove an overwhelmingly unpainted direct beam. Its
  // outline encloses the perspective projection of the screen from the whole
  // die. Use it only if it fits and does not sacrifice much of the pupil.
  function fieldStop(env,src,T,work,sites,keep,scale,direct,paint,reflectivity) {
    let stray=0, lit=0, significant=0;
    const R=paint.res, N=16;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++) {
      const a=(i+.5)/N, b=(j+.5)/N;
      const p=paint.cells[Math.floor(b*R)*R+Math.floor(a*R)];
      const q=direct(Engine.targetUVtoWorld(T,(2*a-1)*T.half,(2*b-1)*T.half));
      if(p>0) lit+=q;
      else { stray+=q; if(q*work.cell**2>.075*scale) significant++; }
    }
    if(significant<N*N*.05 || stray<2*lit) return null;
    const radius=Source.boundingRadius(src)||0;
    const n=V.neg(T.n), depth=Math.max(1.025*keep,1.12*radius,.001*Math.max(...env.half));
    const D=V.dot(V.sub(T.C,src.pos),n);
    if(!(D>depth+radius)) return null;
    const limits=[T.tu,T.tv].map(e=>{
      const x=V.dot(V.sub(T.C,src.pos),e), values=[];
      for(const dz of [-radius,radius]) for(const b of [-1,1]) for(const c of [-1,1]) {
        const t=(depth-dz)/(D-dz);
        values.push((1-t)*b*radius+t*(x+c*T.half));
      }
      return [Math.min(...values),Math.max(...values)];
    });
    const P=V.madd(src.pos,n,depth);
    const pts3=signs.map(([i,j])=>V.add(P,V.add(V.mul(T.tu,limits[0][+(i>0)]),V.mul(T.tv,limits[1][+(j>0)]))));
    if(!pts3.every(p=>Geo.envInside(env,p))) return null;
    const cost=new Set();
    function overlaps(Q, margin) {
      return [T.tu,T.tv].every((e,i)=>{
        const x=V.dot(Q,e); return x+margin>=limits[i][0] && x-margin<=limits[i][1];
      });
    }
    for(const s of sites) {
      const q=V.sub(s.P,src.pos), x=V.dot(q,n);
      if(x>depth) {
        const t=depth/x;
        if(overlaps(V.mul(q,t),s.side*t*.9+radius)) cost.add(s);
      } else {
        const v=V.sub(work.center,s.P), t=(depth-x)/V.dot(v,n);
        if(overlaps(V.madd(q,v,t),s.side*.9+t*T.half)) cost.add(s);
      }
    }
    const loss=sites.reduce((sum,s)=>sum+(cost.has(s)?s.max:0),0);
    const total=sites.reduce((sum,s)=>sum+s.max,0);
    if(loss>total*.12) return null;
    const surface={type:'plane',id:'field-stop',P,n:T.n,clip:{kind:'poly',pts3},
      optics:{interaction:'absorb',reflectivity,twoSided:true}};
    return {surface,cost};
  }

  function solve(input, settings = {}) {
    const {minDistance=0,fill=.97,throughput=.95,dark=1.7,stop:screenDirect=false}=settings;
    const { envelope:env, source:src, target, limits, paint }=input;
    const surfaces=[], intent=[], notes=[];
    const cap=Math.max(0,limits.maxFacets|0), keep=Math.max(env.keepOut||0,minDistance);
    const emitters=input.sources?.length ? input.sources : [src];
    const T=Engine.designFrame(target), work=painting(paint,T,cap);
    if (!cap || !work) return {surfaces,intent,notes:['No paint or no facet budget.']};
    const {stride,height,values,anchors,world,cell,feature,pad,count,w,h}=work;
    const axis=V.norm(V.sub(work.center,src.pos)), u=V.inPlane(axis,T.tu), v=V.cross(axis,u);
    const die=Source.extentSize(src)||0, focalDistance=V.dist(work.center,src.pos);
    const sites=pupil(env,src,axis,u,v,cap,keep,feature,die,focalDistance,fill);
    if (!sites.length) return {surfaces,intent,notes:['No illuminated pupil fits the envelope and clearance.']};
    const I0=Source.totalIntegral(src), fr=Source.frame(src), targetView=Math.abs(V.dot(T.n,axis));
    const primary=src.power/emitters.reduce((sum,e)=>sum+e.power,0);
    const width=Math.sqrt(count/cap);
    const sizes=[0,Math.max(1.4,width*1.5),Math.max(2.6,width*3),Math.max(4,width*5)];
    const shapes=sizes.map(s=>({du:s,dv:s,u:1,v:1}));
    if (work.featureX>work.featureY*2.6) shapes.push({du:sizes[2],dv:sizes[2]*.5,u:1,v:.5});
    if (work.featureY>work.featureX*2.6) shapes.push({du:sizes[2]*.5,dv:sizes[2],u:.5,v:1});
    let total=0, useful=0;
    for (const s of sites) {
      s.S0=src.pos;
      s.side=0;
      for(let i=sizes.length-1;i>=0;i--) {
        let side=s.step;
        while(side > s.step*.18 && !aperture(s,work.center,T.tu,T.tv,side,side,sizes[i]*cell/side,env,emitters,keep,false)) side *= .81;
        if (side > s.step*.18) { s.side=side; s.maxDefocus=sizes[i]; break; }
      }
      s.max=s.E*targetView*s.side*s.side*limits.reflectivity*primary/I0;
      if (s.max > 0) {
        s.image=dieImage(s,work.center,T,src,fr,cell,pad-1);
        // Back off the exposure when the die image is wider than the strokes:
        // otherwise the fit would be forced to use every aperture, spilling light.
        let xx=0, yy=0, mass=0;
        const {w:iw,h:ih,vals}=s.image;
        for(let j=0;j<ih;j++) for(let i=0;i<iw;i++) {
          const m=vals[j*iw+i]; mass+=m;
          xx += m*(i-(iw>>1))**2; yy += m*(j-(ih>>1))**2;
        }
        const blurRatio=Math.max(Math.sqrt(12*xx)/work.featureX,Math.sqrt(12*yy)/work.featureY);
        s.useful=s.max*mass/Math.max(1, .9*blurRatio)**1.55;
        useful+=s.useful;
      }
      total+=s.max;
    }
    if (!(total>0)) return {surfaces,intent,notes:['No mirror aperture fits.']};
    const direct=directModel(emitters,T);
    const stop=emitters.length===1 && target.linked!==false && !src.domeMag && screenDirect &&
      fieldStop(env,src,T,work,sites,keep,throughput*useful/count,direct,paint,limits.reflectivity);
    if(stop) {
      surfaces.push(stop.surface);
      for(const s of stop.cost) { total-=s.max; useful-=s.useful||0; s.max=0; }
      notes.push('A clearance-safe field stop screens the direct beam.');
    }
    const scale=throughput*Math.max(useful,.12*total)/count;
    const blur=Photometry.boxBlur;
    // boxBlur is square; pack the working rectangle while retaining its halo.
    const N=Math.max(stride,height), square=new Float32Array(N*N);
    for(let y=0;y<height;y++) square.set(values.subarray(y*stride,(y+1)*stride),y*N);
    const nominal=Photometry.achievableKernel({target,source:src,envelope:env}).mm / cell;
    const softened=nominal<2*N ? blur(square,N,Math.max(0,nominal)) : new Float32Array(N*N).fill(count/(nominal*nominal));
    const residual=new Float32Array(values.length), weights=new Float32Array(values.length);
    for(let y=0;y<height;y++) for(let x=0;x<stride;x++) {
      const k=y*stride+x, p=values[k], b=softened[y*N+x];
      residual[k]=p>0 ? .7*b+.3*p : .6*b;
      weights[k]=p>0 ? 1/Math.max(.28,residual[k]) : dark;
      if (!stop) {
        const Z=world(x,y), [a,b]=Engine.worldToTargetUV(T,Z);
        if(Math.abs(a)<T.half && Math.abs(b)<T.half) residual[k]-=direct(Z)*cell*cell/scale;
      }
    }
    let placed=0;
    for(let pass=0;pass<3;pass++) {
      for(const s of sites) {
        if (!(s.max > 0)) continue;
        function change(old, sign) {
          if (!old) return;
          const {k, K, amp}=old;
          for(let i=0;i<K.o.length;i++) residual[k+K.o[i]]+=sign*amp*K.v[i];
        }
        change(s.fit,+1);
        const ref=s.fit ? world(s.fit.x,s.fit.y) : work.center;
        const image=s.fit ? dieImage(s,ref,T,src,fr,cell,pad-1) : s.image;
        let best=null, merit=0;
        for(const shape of shapes) {
          if (Math.max(shape.du,shape.dv)>s.maxDefocus) continue;
          const ample=s.max*shape.u*shape.v/scale;
          const K=stencil(defocus(image,shape.du,shape.dv),stride,pad,pad), o=K.o, v=K.v;
          // Broad images vary slowly with aim: screen the grid coarsely, then
          // score its winning neighborhood at full resolution.
          const step=clamp(Math.max(Math.min(3, Math.floor(Math.sqrt(o.length)/5)), Math.ceil(Math.sqrt(anchors.length*o.length/180000))),1,18);
          let top=null, topGain=0;
          function check(x,y) {
            const k=y*stride+x;
            let dot=0, norm=0;
            for(let i=0;i<o.length;i++) {
              const p=k+o[i], q=v[i]*weights[p]; dot+=q*residual[p]; norm+=q*v[i];
            }
            if (!(dot>0 && norm>0)) return;
            const amp=Math.min(ample,dot/norm), gain=amp*(2*dot-amp*norm);
            if (gain>topGain) { topGain=gain; top={x,y,k,K,amp,shape}; }
          }
          for(let j=0;j<anchors.length;j+=step*step) {
            const [x,y]=anchors[j];
            if (pass>0 && s.fit && (Math.abs(s.fit.x-x)>Math.max(5,w*.22) || Math.abs(s.fit.y-y)>Math.max(4,h*.27))) continue;
            check(x,y);
          }
          if(s.fit) check(s.fit.x,s.fit.y);
          if(step>1 && top) {
            for(let delta=Math.floor(step/2);delta>0;delta=Math.floor(delta/2)) {
              const {x,y}=top;
              for(let dy=-delta;dy<=delta;dy+=delta) for(let dx=-delta;dx<=delta;dx+=delta) {
                if((dx||dy) && values[(y+dy)*stride+x+dx]>0) check(x+dx,y+dy);
              }
            }
          }
          if(topGain>merit) { merit=topGain; best=top; }
        }
        s.fit=best; change(best,-1);
      }
    }
    for(const s of sites) {
      if (!s.fit || s.fit.amp < .025*s.max/scale) continue;
      const {x,y,amp,shape,K,k}=s.fit, Z=world(x,y);
      let side=s.side*Math.sqrt(Math.min(1,amp*scale/(s.max*shape.u*shape.v))), ap;
      const requested=side;
      while (side>.18*requested) {
        ap=aperture(s,Z,T.tu,T.tv,side*shape.u,side*shape.v,shape.du*cell/(side*shape.u),env,emitters,keep,true);
        if (ap) break;
        side*=.82;
      }
      if (!ap) continue;
      const id='P'+placed;
      surfaces.push({type:'facet',id,P:s.P,S0:s.S0,Z,di:ap.di,clip:{kind:'poly',pts3:ap.pts},optics:{reflectivity:limits.reflectivity}});
      const cells=[];
      const fittedFlux=amp*scale*(side/requested)**2;
      for(let i=0;i<K.o.length;i++) {
        const at=k+K.o[i], px=work.representative[at];
        // On a coarsened grid report one actual painted cell per block,
        // without claiming the unpainted share of the block's incident light.
        if (px>=0) cells.push([px,K.v[i]*fittedFlux*work.coverage[at]]);
      }
      intent.push({facet:id,cells});
      placed++;
    }
    notes.push(`${placed}/${sites.length} pupil tiles used; projected collection capacity ${(100*total).toFixed(1)}% of source flux before occlusion.`);
    return {surfaces,intent,notes};
  }

  // Trace only in this separate solver. Presets vary optical choices, never
  // user limits. All candidates use the same seed and ray count.
  function tune(input, settings = {}, tools = {}) {
    const {minDistance=0,goal='faithful'}=settings;
    const baseline=solve(input,{minDistance});
    if (!tools.trace || !baseline.surfaces.length) return baseline;
    const presets = [
      {},
      {fill:1,throughput:1,dark:1.5},
      {fill:.93,throughput:.85,dark:1.4},
      {fill:.93,throughput:.72,dark:2.8,stop:true},
      {fill:.99,throughput:.88,dark:.8},
    ];
    // Bound work for very large user caps or explicitly reduced host budgets.
    if (input.limits.maxFacets>400 || tools.budget?.ms<8000) presets.length=3;
    const rays=Math.min(420000,Math.floor((tools.budget?.rays ?? 2100000)/presets.length));
    if (!(rays>=20000) || tools.budget?.ms<1800) return baseline;
    const results=[];
    for(let i=0;i<presets.length;i++) {
      const preset=presets[i], design=i ? solve(input,{...preset,minDistance}) : baseline;
      if (design.surfaces.length) {
        const tr=tools.trace(design.surfaces,{rays,seed:input.seed,paint:input.paint.cells});
        if (tr.fidelity) {
          const {fidelity,onPaint}=tr.fidelity;
          results.push({design,preset,fidelity,onPaint,peak:tr.peakCd||0});
          tools.preview?.(design.surfaces,{label:`Pupil Auto · ${i+1}/${presets.length}`,trace:tr});
        }
      }
      tools.progress?.((i+1)/presets.length,`Comparing pupil settings (${i+1}/${presets.length})`);
    }
    if (!results.length) return baseline;
    const base=results[0], threshold=Math.max(.015,.1*base.onPaint);
    const fluxRef=Math.max(.015,base.onPaint), peakRef=Math.max(1,base.peak);
    for(const r of results) {
      r.shape=r.fidelity*Math.min(1,r.onPaint/threshold);
      const gate=clamp((r.shape-.5)/.25,0,1);
      const flux=Math.min(2,r.onPaint/fluxRef), peak=Math.min(2,r.peak/peakRef);
      // Keep some fidelity weight for all goals; brightness bonuses only
      // kick in when there is already a recognizable pattern.
      const bonus=goal==='throw' ? .32*(.15*flux+.85*peak) : goal==='efficient' ? .32*flux : .025*flux;
      r.merit=r.shape+gate*bonus;
    }
    const winner=results.reduce((a,b)=>b.merit>a.merit ? b : a);
    const {fill=.97,throughput=.95,dark=1.7,stop=false}=winner.preset;
    winner.design.notes.unshift(`Auto (${goal}): ${results.length} designs × ${rays.toLocaleString('en-US')} rays; selected fill ${fill}, throughput ${throughput}, dark ${dark}, stop ${stop}. Pilot fidelity ${(100*winner.fidelity).toFixed(1)}%, on paint ${(100*winner.onPaint).toFixed(1)}%.`);
    return winner.design;
  }

  const minDistanceSetting={key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:.5,default:0};
  RF.Solvers.register({id:'bench-gpt62sol--pupil',name:'Pupil · analytic image fit',version:'1.0',modes:['paint'],settings:[
    minDistanceSetting,
    {key:'throughput',label:'Requested share of available light',type:'range',min:.2,max:1,step:.05,default:.95},
    {key:'fill',label:'Pupil tile fill (linear)',type:'range',min:.4,max:1,step:.01,default:.97},
    {key:'stop',label:'Screen strong direct glare when possible',type:'checkbox',default:false},
    {key:'dark',label:'Weight of dark regions',type:'range',min:.2,max:5,step:.1,default:1.7},
  ],solve});
  RF.Solvers.register({id:'bench-gpt62sol--pupil-auto',name:'Pupil Auto · trace-tuned settings',version:'1.0',modes:['paint'],settings:[
    minDistanceSetting,
    {key:'goal',label:'Tuning goal',type:'select',default:'faithful',options:[
      {value:'faithful',label:'Faithful'}, {value:'throw',label:'Throw'}, {value:'efficient',label:'Efficient'},
    ]},
  ],solve:tune});
})();
