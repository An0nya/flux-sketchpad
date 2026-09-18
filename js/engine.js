(function(O) {
  'use strict';
  const {V,RNG,Geometry:Geo}=O;
  class Emitter {
    constructor(source) {
      this.s=source;this.frame=V.frame(source.axis);
      if(source.distribution==='gaussian') {
        // The polar density includes sin(theta), the solid-angle Jacobian.
        // Omitting it wrongly puts most emitted flux on the axis.
        const sigma=source.angle*Math.PI/180,limit=source.kind==='planar'?Math.PI/2:Math.PI;
        this.limit=limit;this.cdf=[0];let sum=0;
        for(let i=1;i<=1024;i++){const a=(i-.5)*limit/1024;sum+=Math.exp(-a*a/(2*sigma*sigma))*Math.sin(a);this.cdf.push(sum);}
        this.cdf=this.cdf.map(x=>x/sum);
      }
    }
    sample(rng) {
      const s=this.s;let p=[0,0,0];
      if(s.kind==='planar') {
        if(s.shape==='rectangle')p=[(rng.next()-.5)*s.size,(rng.next()-.5)*s.size*s.aspect,0];
        else {const r=Math.sqrt(rng.next())*s.size/2,a=rng.next()*2*Math.PI;p=[r*Math.cos(a),r*Math.sin(a),0];}
      } else if(s.kind==='volume') {
        if(s.shape==='cylinder'){const r=Math.sqrt(rng.next())*s.size/2,a=rng.next()*2*Math.PI;p=[r*Math.cos(a),r*Math.sin(a),(rng.next()-.5)*s.height];}
        else {const z=2*rng.next()-1,a=rng.next()*2*Math.PI,r=Math.cbrt(rng.next())*s.size/2,t=Math.sqrt(1-z*z);p=[r*t*Math.cos(a),r*t*Math.sin(a),r*z];}
      }
      let c;const u=rng.next(),a=rng.next()*Math.PI*2;
      if(s.distribution==='lambertian')c=Math.sqrt(u);
      else if(s.distribution==='gaussian') {let lo=0,hi=1024;while(hi-lo>1){const m=(lo+hi)>>1;if(this.cdf[m]<u)lo=m;else hi=m;}const f=(u-this.cdf[lo])/(this.cdf[hi]-this.cdf[lo]||1);c=Math.cos((lo+f)*this.limit/1024);}
      else c=1-u*(1-Math.cos(Math.min(s.kind==='planar'?90:180,s.angle)*Math.PI/180));
      const t=Math.sqrt(Math.max(0,1-c*c));return {o:V.add(s.position,V.world(p,this.frame)),d:V.world([t*Math.cos(a),t*Math.sin(a),c],this.frame)};
    }
    density(direction) {
      const c=V.dot(V.unit(direction),this.frame.n),a=Math.acos(V.clamp(c,-1,1)),s=this.s;
      if(s.kind==='planar'&&c<=0)return 0;
      if(s.distribution==='lambertian')return Math.max(0,c)/Math.PI;
      if(s.distribution==='cone')return a<=s.angle*Math.PI/180?1/(2*Math.PI*(1-Math.cos(Math.min(s.kind==='planar'?90:180,s.angle)*Math.PI/180))):0;
      const sig=s.angle*Math.PI/180;let norm=0;for(let i=0;i<128;i++){const t=(i+.5)*this.limit/128;norm+=Math.exp(-t*t/(2*sig*sig))*Math.sin(t)*this.limit/128*2*Math.PI;}return Math.exp(-a*a/(2*sig*sig))/norm;
    }
  }
  class Simulation {
    constructor(state,options={}) {
      this.state=state;this.surfaces=state.surfaces.map(Geo.surface);this.root=Geo.tree([...this.surfaces]);this.target={...state.target,frame:V.frame(state.target.normal)};
      this.n=state.target.resolution;this.grid=new Float64Array(this.n*this.n);this.directGrid=new Float64Array(this.grid.length);this.viaGrid=new Float64Array(this.grid.length);
      this.rng=new RNG(state.simulation.seed);this.emitter=new Emitter(state.source);this.total=options.rays||state.simulation.rays;this.done=0;
      this.eps=Math.max(...state.envelope.size,state.target.width,state.target.height,V.distance(state.source.position,state.target.center))*1e-9;
      this.unit=state.source.intensity/this.total;this.paths=[];this.pathMax=options.paths??180;this.pathStride=Math.max(1,Math.floor(this.total/this.pathMax));this.hits=new Uint32Array(this.surfaces.length);
      this.ledger={emitted:0,target:0,direct:0,via:0,reflected:0,refracted:0,absorbed:0,escaped:0,unresolved:0,intercepted:0};this.ms=0;
    }
    trace(o,d,energy=this.unit,keep=false) {
      const cfg=this.state.simulation,L=this.ledger;
      const stack=[{o,d,e:energy,depth:0,via:false,mirror:false,glass:false,points:keep?[o]:null}];let touched=false;
      while(stack.length) {
        const r=stack.pop();
        if(r.e<energy*cfg.floor){L.unresolved+=r.e;if(r.points&&this.paths.length<this.pathMax*3)this.paths.push({points:r.points,via:r.via,energy:r.e/energy});continue;}
        const th=Geo.targetHit(this.target,r.o,r.d,this.eps),hit=Geo.nearest(this.root,r.o,r.d,this.eps,th?.t??Infinity);
        const end=(p)=>{if(r.points&&this.paths.length<this.pathMax*3){r.points.push(p);this.paths.push({points:r.points,via:r.via,energy:r.e/energy});}};
        if(!hit) {
          if(th) {const i=Math.min(this.n-1,Math.floor(th.v*this.n))*this.n+Math.min(this.n-1,Math.floor(th.u*this.n));this.grid[i]+=r.e;(r.via?this.viaGrid:this.directGrid)[i]+=r.e;L.target+=r.e;L[r.via?'via':'direct']+=r.e;if(r.mirror)L.reflected+=r.e;if(r.glass)L.refracted+=r.e;end(th.p);}
          else {L.escaped+=r.e;end(V.add(r.o,V.mul(r.d,Math.max(...this.state.envelope.size)*1.8)));}continue;
        }
        touched=true;this.hits[hit.s.index]++;if(r.points)r.points.push(hit.p);
        // The bounce budget limits surface interactions, not flight to the target
        // after the final allowed interaction. Truncated energy is disclosed.
        if(r.depth>=cfg.bounces) {L.unresolved+=r.e;end(hit.p);continue;}
        const s=hit.s,front=V.dot(r.d,hit.n)<0;
        if(s.type==='absorb'||(s.type==='reflect'&&!front&&!s.twoSided)){L.absorbed+=r.e;end(hit.p);continue;}
        const enqueue=(dir,e,mirror,glass)=>{if(e<=0)return;stack.push({o:V.add(hit.p,V.mul(dir,this.eps*4)),d:dir,e,depth:r.depth+1,via:true,mirror:r.mirror||mirror,glass:r.glass||glass,points:r.points?[...r.points]:null});};
        if(s.type==='reflect') {const rho=s.reflectivity??.9;L.absorbed+=r.e*(1-rho);enqueue(V.reflect(r.d,hit.n),r.e*rho,true,false);}
        else {
          // Closed lens meshes have outward normals. We assume separated glass
          // bodies in air; nested or overlapping dielectrics need a medium stack.
          const x=O.snell(r.d,hit.n,front?1:s.ior,front?s.ior:1);
          if(x.tir)enqueue(x.d,r.e,true,true);
          else {enqueue(x.d,r.e*(1-x.R),false,true);enqueue(V.reflect(r.d,hit.n),r.e*x.R,true,true);}
        }
      }
      if(touched)L.intercepted+=energy;
    }
    step(count=512) {
      const start=performance.now(),end=Math.min(this.total,this.done+count);
      while(this.done<end){const r=this.emitter.sample(this.rng);this.ledger.emitted+=this.unit;this.trace(r.o,r.d,this.unit,this.done%this.pathStride===0&&this.paths.length<this.pathMax);this.done++;}
      this.ms+=performance.now()-start;return this.done===this.total;
    }
    finish() {while(!this.step(2048)){}return this;}
    stats() {
      let lit=0,sum=0,sum2=0;for(const x of this.grid)if(x>0){lit++;sum+=x;sum2+=x*x;}
      const mean=lit?sum/lit:0,sd=lit?Math.sqrt(Math.max(0,sum2/lit-mean*mean)):0,e=this.ledger.emitted||1;
      // Intent-relative measures. coverage and uniformity above are computed over
      // the WHOLE target plane and have no idea where the painting is, so they
      // are diagnostics, not objectives: both are maximised by a thin even wash
      // over everything, including past a cutoff. These three know the intent.
      const paint=this.state.paint;let want=0,hit=0,inSum=0,inSum2=0,outSum=0;
      if(paint&&paint.length===this.grid.length) {
        for(let i=0;i<this.grid.length;i++) {
          const g=this.grid[i];
          if(paint[i]>0){want++;if(g>0){hit++;inSum+=g;inSum2+=g*g;}}
          else outSum+=g;
        }
      }
      const inMean=hit?inSum/hit:0,inSd=hit?Math.sqrt(Math.max(0,inSum2/hit-inMean*inMean)):0,flux=inSum+outSum;
      return {rays:this.done,surfaces:this.surfaces.length,coverage:lit/this.grid.length,uniformity:mean?1-sd/mean:0,intercepted:this.ledger.intercepted/e,via:this.ledger.via/e,direct:this.ledger.direct/e,unresolved:this.ledger.unresolved/e,ms:this.ms,hash:O.hashGrid(this.grid),
        intentFilled:want?hit/want:0,intentOnTarget:flux>0?inSum/flux:0,intentUniformity:inMean?1-inSd/inMean:0,intentCells:want};
    }
  }
  O.Emitter=Emitter;O.Simulation=Simulation;
})(Optics);
