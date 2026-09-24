(function(O) {
  'use strict';
  const {V,Geometry:Geo}=O;
  // Lattice directions are a SAMPLING resolution; they no longer set facet size.
  // KEEP bounds how many candidates each request carries into the global pass.
  const LATTICE_CAP=16384,RADIAL=12,KEEP=24,PREFILTER=64;
  // Incoming i points *toward* the mirror. Outgoing o points away.
  // Reflection says o=i-2(i·n)n, so n is parallel to o-i. Equivalently
  // n bisects the two directions pointing FROM the facet to source and target.
  function aim(p,source,target) {return V.unit(V.add(V.unit(V.sub(source,p)),V.unit(V.sub(target,p))));}
  function targetPoint(s,u,v) {return V.add(s.target.center,V.world([(u-.5)*s.target.width,(v-.5)*s.target.height,0],V.frame(s.target.normal)));}
  function tileEstimate(s,p,width,focal) {
    const ds=V.distance(p,s.source.position),dt=V.distance(p,s.target.aim),m=dt/ds;
    // Linearize the exact reflection about the chief ray. At normal incidence,
    // x_target = (1 + dt/ds - dt/f) x_facet - (dt/ds) x_source.
    // At the conjugate image plane, 1/f=1/ds+1/dt and source magnification is
    // -dt/ds = -f/(ds-f), NOT the flat facet's footprint expansion (1+m).
    // Off-axis astigmatism invalidates this scalar estimate; actual rays decide.
    return Math.abs(1+m-(focal?dt/focal:0))*width+m*(s.source.kind==='point'?0:s.source.size);
  }
  function candidatePositions(s,target,count) {
    const source=s.source.position,D=V.distance(source,target),axis=V.unit(V.sub(target,source)),emitter=new O.Emitter(s.source),out=[];
    const scale=Math.max(...s.envelope.size),minF=scale*.025,maxF=scale*1.2;
    // Equal optical path |p-source|+|target-p|=D+2f gives
    // r=(L²-D²)/(2(L-D cosθ)). For distant targets this tends to
    // r=2f/(1-cosθ), a paraboloid, NOT a fixed-radius shell.
    // The angular lattice is independent of envelope size. Radial samples adapt
    // to the available space; generate() preserves a feasible incumbent when
    // this finite search fails to improve its measured intercepted flux.
    const angular=Math.max(192,Math.min(count*8,LATTICE_CAP)),dirs=new Array(angular);
    // `share` is the solid angle one facet is sized to COVER. That is a
    // different quantity from the lattice's per-sample weight 4π/angular, and
    // welding them made the total captured angle count·4π/(8·count) — constant
    // in count, so raising the facet budget never captured more light (measured
    // flat at ~37% from 25 to 800 facets). Facets now split design.fill of the
    // forward hemisphere between them, so capture is a knob and count is not.
    const share=2*Math.PI*Math.max(.02,Math.min(1,s.design.fill??1))/Math.max(1,count);
    for(let j=0;j<angular;j++) {
      const z=1-2*(j+.5)/angular,a=j*Math.PI*(3-Math.sqrt(5)),q=Math.sqrt(1-z*z),w=[q*Math.cos(a),q*Math.sin(a),z],density=emitter.density(w);
      dirs[j]=w;
      if(density<=0)continue;
      for(let k=0;k<RADIAL;k++){const f=minF*(maxF/minF)**(k/(RADIAL-1)),L=D+2*f,r=(L*L-D*D)/(2*(L-D*V.dot(w,axis))),p=V.add(source,V.mul(w,r));if(Geo.inside(s.envelope,p))out.push({p,w,r,f,density,share,di:j});}
    }
    // Sorted by emitter density so solve() can stop scanning early. For a curved
    // facet width=sqrt(share·ds²/cos)·0.94 makes solid=0.94²·share exactly —
    // position-independent, verified to 4 decimals — so score reduces to
    // 0.8836·share·density/(1+2·mismatch). mismatch ≥ 0, so density is a true
    // upper bound on score and a density-ordered scan can break, not just skip.
    out.sort((a,b)=>b.density-a.density);
    out.dirs=dirs;out.angular=angular;out.share=share;return out;
  }
  const SOLID_K=.94*.94;
  // Closed-form sizing: everything makeFacet needs EXCEPT the envelope shrink
  // loop, which is the expensive half. Ranking candidates only needs this part.
  function facetGeometry(s,c,target,size) {
    const ds=c.r,dt=V.distance(c.p,target),normal=aim(c.p,s.source.position,target),cos=Math.max(.05,Math.abs(V.dot(c.w,normal)));
    const m=dt/ds,blur=m*(s.source.kind==='point'?0:s.source.size);
    // designEmitter shrinks the emitter the GEOMETRY is solved for, without
    // touching the emitter that gets traced or reported. Once blur >= size the
    // term max(0, size-blur) is zero and focal collapses to dt/(1+m) for every
    // facet identically — the solver stops differentiating facets by requested
    // tile at all. Solving against a smaller die keeps that term alive, so each
    // facet still gets its own focal length; the real die then convolves the
    // result. Design the point-source-ideal mapping, accept the blur on top.
    const dblur=blur*Math.max(.01,Math.min(1,s.design.designEmitter??1));
    // Match a complete tile width, including finite source blur. A curved
    // patch chooses focal length; a flat patch must change its aperture.
    let width=s.design.curved?Math.sqrt(c.share*ds*ds/cos)*.94:Math.max(.03,(size-dblur)/(1+m));
    width=Math.min(width,Math.min(s.envelope.size[0],s.envelope.size[1],s.envelope.size[2])*.65);
    let focal=s.design.curved?dt/(1+m-Math.max(0,size-dblur)/width):0;
    if(!Number.isFinite(focal)||Math.abs(focal)>1e8)focal=0;
    return {ds,dt,normal,cos,m,blur,dblur,width,focal,solid:width*width*cos/(ds*ds)};
  }
  function makeFacet(s,c,target,size,id,g) {
    g=g||facetGeometry(s,c,target,size);
    const {ds,dt,cos,m,blur,dblur,normal,width,focal}=g;
    const facet={id,center:c.p,normal,width,height:width,focal,type:'reflect',reflectivity:.9,twoSided:false,designTarget:target,requestedSize:size};
    // Shrink only to satisfy real envelope boundaries, never a spatial bin.
    for(let k=0,fl=focal;k<16&&!Geo.fits(s.envelope,facet);k++){facet.width*=.85;facet.height*=.85;if(s.design.curved){fl=dt/(1+m-Math.max(0,size-dblur)/facet.width);facet.focal=Number.isFinite(fl)?fl:0;}}
    if(!Geo.fits(s.envelope,facet)||facet.width<.02)return null;
    const solid=facet.width*facet.height*cos/(ds*ds);
    return {facet,score:solid*c.density,blur,estimated:tileEstimate({...s,target:{...s.target,aim:target}},c.p,facet.width,facet.focal)};
  }
  function zones(s) {
    const n=s.target.resolution,active=[];for(let i=0;i<s.paint.length;i++)if(s.paint[i]>0)active.push({u:(i%n+.5)/n,v:(Math.floor(i/n)+.5)/n,weight:s.paint[i]});
    if(!active.length)return [];
    // Weighted spatial quantiles: each facet gets the same requested flux,
    // brighter painted regions receive proportionally more complete images.
    const count=s.design.budget,out=[];
    const area=active.length/n**2*s.target.width*s.target.height,size=Math.sqrt(area/count)*1.3;
    // Contrast mode. Plain quantiles spend facets in proportion to painted
    // flux, which is a uniformity objective: it has no opinion about WHERE the
    // error lands, so it smooths interiors and rounds edges. edgeBias reweights
    // the painted boundary and shrinks the tiles that land on it, spending the
    // budget on the cutoff instead. Interior evenness is deliberately traded.
    const bias=Math.max(0,s.design.edgeBias??0);
    if(bias>0) {
      const lit=(x,y)=>x>=0&&x<n&&y>=0&&y<n&&s.paint[y*n+x]>0;
      for(const p of active) {
        const x=Math.min(n-1,Math.floor(p.u*n)),y=Math.min(n-1,Math.floor(p.v*n));
        p.edge=lit(x+1,y)&&lit(x-1,y)&&lit(x,y+1)&&lit(x,y-1)?0:1;
      }
    }
    const eff=p=>p.weight*(1+bias*(p.edge||0)),total=active.reduce((a,p)=>a+eff(p),0);
    let j=0,sum=eff(active[0]);
    for(let k=0;k<count;k++){const q=(k+.5)*total/count;while(sum<q&&j<active.length-1)sum+=eff(active[++j]);out.push({...active[j],size:active[j].edge?size/(1+bias):size});}return out;
  }
  function solve(s,requests) {
    const candidates=candidatePositions(s,s.target.aim,s.design.budget),chosen=[];
    const angular=candidates.angular,dirs=candidates.dirs,blocked=new Uint8Array(angular);
    const targets=requests.map(r=>targetPoint(s,r.u,r.v)),pool=[],src=s.source.kind==='point'?0:s.source.size;
    let minBlur=Infinity,wsum=0;
    const bound=s.design.curved?SOLID_K*candidates.share:0;
    // Stage 1 — closed-form score for every (request, candidate) pair. Neither
    // Geo.fits nor tileEstimate runs here: the first is a 16-step shrink loop,
    // the second allocates two objects per call, and at this call count both
    // dominated. Each request keeps only its KEEP best options, bounding the
    // pool at requests·KEEP rather than requests·candidates.
    for(let j=0;j<requests.length;j++) {
      const r=requests[j],target=targets[j],best=[];let worst=0,floor=Infinity;
      for(const c of candidates) {
        // Exact branch-and-bound: candidates are density-ordered and no remaining
        // one can out-score the weakest already kept. Only sound for curved
        // facets, where solid angle is position-independent; a flat facet sizes
        // itself from the requested tile, so its solid angle is not bounded here.
        if(bound&&best.length===PREFILTER&&bound*c.density<floor)break;
        if(r.direction&&V.dot(c.w,r.direction)<.92)continue;
        const g=facetGeometry(s,c,target,r.size);
        if(g.width<.02)continue;
        if(g.blur<minBlur)minBlur=g.blur;
        const est=Math.abs(1+g.m-(g.focal?g.dt/g.focal:0))*g.width+g.m*src;
        const score=g.solid*c.density/(1+Math.abs(est-r.size)/Math.max(.1,r.size)*2);
        if(best.length<PREFILTER)best.push({j,c,g,score});
        else if(score>floor)best[worst]={j,c,g,score};
        else continue;
        if(best.length===PREFILTER){floor=Infinity;for(let k=0;k<PREFILTER;k++)if(best[k].score<floor){floor=best[k].score;worst=k;}}
      }
      // Re-score the shortlist on POST-shrink geometry. The closed-form width
      // above is what a facet asks for; Geo.fits can take 0.85^16 off it near an
      // envelope wall, and the recomputed focal moves the tile estimate with it.
      // Ranking on the pre-shrink values quietly preferred candidates that were
      // about to be cut down — measured as 12% less total solid angle and a
      // median radius pushed from 16.8 to 18.5 on a shallow envelope. This is
      // the original's criterion, restored, but paid for KEEP candidates per
      // request instead of every candidate.
      const scored=[];
      for(const b of best) {
        const x=makeFacet(s,b.c,target,r.size,'design-'+j,b.g);
        if(!x)continue;
        scored.push({j,c:b.c,x,score:x.score/(1+Math.abs(x.estimated-r.size)/Math.max(.1,r.size)*2)});
      }
      scored.sort((a,b)=>b.score-a.score);
      scored.length=Math.min(scored.length,KEEP);for(let k=0;k<scored.length;k++){scored[k].rank=k;pool.push(scored[k]);wsum+=scored[k].x.facet.width;}
    }
    // Stage 2 — rank-tiered greedy. Every request gets its 1st choice weighed
    // before any request gets its 2nd, and within a tier the better score wins.
    //
    // Both extremes are worse. Serving requests in zones() order gave request 0
    // first pick of the whole candidate set, and that order tracks position on
    // the target, so one edge of the painted region systematically got the best
    // solid angle. But a flat global sort by score is worse still: emitter
    // density peaks on axis, so the best-served requests take every near-axis
    // direction and latecomers are left scattered leftovers — measured at 3-5
    // points of interception and half the uniformity on a real scene. Tiering
    // keeps the round-robin fairness the original had by accident, without
    // inheriting its positional bias.
    pool.sort((a,b)=>a.rank-b.rank||b.score-a.score);
    const placed=new Array(requests.length).fill(false);
    const cell=Math.max(1e-9,.42*(wsum/Math.max(1,pool.length))),grid=new Map();
    const hash=(i,j,k)=>(i*73856093^j*19349663^k*83492791)>>>0;
    // Marking every cell a placed facet's exclusion ball touches, and querying
    // every cell the candidate's ball touches, makes two overlapping balls
    // certain to share a cell — exact, and O(1) instead of scanning all placed
    // facets, which is where the measured N³ term came from.
    function ball(p,r,fn) {
      const i0=Math.floor((p[0]-r)/cell),i1=Math.floor((p[0]+r)/cell),j0=Math.floor((p[1]-r)/cell),j1=Math.floor((p[1]+r)/cell),k0=Math.floor((p[2]-r)/cell),k1=Math.floor((p[2]+r)/cell);
      for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(let k=k0;k<=k1;k++)if(fn(hash(i,j,k)))return true;
      return false;
    }
    const near=(p,w)=>ball(p,.42*w,h=>{const l=grid.get(h);return l?l.some(f=>V.distance(f.center,p)<.42*(f.width+w)):false;});
    const stash=f=>ball(f.center,.42*f.width,h=>{const l=grid.get(h);l?l.push(f):grid.set(h,[f]);return false;});
    // Angular exclusion measures footprint seen by the source. Every candidate
    // sits exactly on a lattice direction and z is monotonic in the lattice
    // index, so a placed facet's cone is a contiguous band of indices to mark.
    // Final occlusion remains exact in the trace.
    function occupy(w,angle) {
      const t=Math.acos(Math.max(-1,Math.min(1,w[2]))),cosA=Math.cos(angle);
      const hi=Math.cos(Math.max(0,t-angle)),lo=Math.cos(Math.min(Math.PI,t+angle));
      const j0=Math.max(0,Math.floor((1-hi)*angular/2-.5)),j1=Math.min(angular-1,Math.ceil((1-lo)*angular/2-.5));
      for(let j=j0;j<=j1;j++)if(!blocked[j]&&V.dot(dirs[j],w)>cosA)blocked[j]=1;
    }
    let done=0;
    // The spatial exclusion must use the width the facet ENDS UP with. The
    // envelope shrink loop can take 0.85^16 ≈ 1/13 off it, so testing the
    // closed-form width here rejected candidates that would have fitted fine
    // and cost most of the facet budget. makeFacet runs first, but only for
    // pairs that already cleared the request and angular tests, so its call
    // count stays bounded by the pool rather than by requests·candidates.
    function tryPlace(j,c,x) {
      const r=requests[j];
      if(!x||near(c.p,x.facet.width))return false;
      if(r.id&&r.size<x.blur+.1){r.size=Math.ceil((x.blur+.1)*10)/10;const adj=makeFacet(s,c,targets[j],r.size,'design-'+j);if(adj)x=adj;r.clamped=true;}
      chosen.push(x.facet);placed[j]=true;done++;
      occupy(c.w,Math.atan(x.facet.width*.8/c.r));stash(x.facet);
      if(r.id){x.facet.stampId=r.id;x.facet.minTileSize=Math.ceil((x.blur+.1)*10)/10;}
      return true;
    }
    for(const p of pool) {
      if(done===requests.length)break;
      if(placed[p.j]||blocked[p.c.di])continue;
      tryPlace(p.j,p.c,p.x);
    }
    // A request whose entire KEEP set was taken by higher-scoring pairs would
    // otherwise go unplaced, which cost ~75% of the facets before this pass
    // existed. Rescan the full candidate list for the leftovers only — the
    // original exhaustive behaviour, paid for just the requests that need it.
    for(let j=0;j<requests.length&&done<requests.length;j++) {
      if(placed[j])continue;
      const r=requests[j],target=targets[j],shortlist=[];
      for(const c of candidates) {
        if(blocked[c.di]||r.direction&&V.dot(c.w,r.direction)<.92)continue;
        const g=facetGeometry(s,c,target,r.size);
        if(g.width<.02)continue;
        const est=Math.abs(1+g.m-(g.focal?g.dt/g.focal:0))*g.width+g.m*src;
        shortlist.push({c,g,score:g.solid*c.density/(1+Math.abs(est-r.size)/Math.max(.1,r.size)*2)});
      }
      // Same two-step as above: cheap prefilter, then the real post-shrink score.
      shortlist.sort((a,b)=>b.score-a.score);
      const tail=[];
      for(let k=0;k<shortlist.length&&k<PREFILTER;k++) {
        const x=makeFacet(s,shortlist[k].c,target,r.size,'design-'+j,shortlist[k].g);
        if(x)tail.push({c:shortlist[k].c,x,score:x.score/(1+Math.abs(x.estimated-r.size)/Math.max(.1,r.size)*2)});
      }
      tail.sort((a,b)=>b.score-a.score);
      for(const t of tail)if(tryPlace(j,t.c,t.x))break;
    }
    // Restore request order, so the surface list is deterministic and matches
    // the id numbering rather than the score order placement happened in.
    chosen.sort((a,b)=>Number(String(a.id).slice(7))-Number(String(b.id).slice(7)));
    return {surfaces:chosen,minBlur:Number.isFinite(minBlur)?minBlur:0,candidates:candidates.length};
  }
  function feasibility(s,solution,requests) {
    const cell=Math.min(s.target.width,s.target.height)/s.target.resolution,notes=[];
    const maxDistance=V.distance(s.source.position,s.envelope.center)+V.len(s.envelope.size)/2;
    const minTarget=Math.max(0,V.distance(s.target.center,s.envelope.center)-V.len(s.envelope.size)/2);
    const sourceWidth=s.source.kind==='point'?0:s.source.size,optimistic=sourceWidth*minTarget/Math.max(.001,maxDistance);
    const requested=requests.length?Math.min(...requests.map(r=>r.size)):cell;
    if(optimistic>cell)notes.push({kind:'limit',text:`Minimum feature: even an optimistic source image is ${(optimistic/cell).toFixed(2)} cells wide (${optimistic.toFixed(2)} units). One-cell painted edges cannot be sharp.`});
    if(solution.minBlur>requested)notes.push({kind:'limit',text:`Source-image limit: candidate blur ≥ ${solution.minBlur.toFixed(2)} units; requested tiles ${requested.toFixed(2)}. The traced result will spread beyond the request.`});
    // A slider that silently does nothing is worse than one that is missing.
    // Tile-size requests enter the design only through max(0, size - blur), so
    // below the floor the cutoff bias has no term to act on.
    const widest=requests.length?Math.max(...requests.map(r=>r.size)):cell;
    if((s.design.edgeBias??0)>0&&widest<=solution.minBlur)notes.push({kind:'limit',text:`Cutoff bias is inert here: the widest requested tile (${widest.toFixed(2)}) is already under the ${solution.minBlur.toFixed(2)}-unit source-image floor, so asking for smaller tiles changes nothing. Edge sharpness moves only with geometry — a larger envelope, a source further from the reflector, or a smaller emitter.`});
    const A=s.source.kind==='point'?0:s.source.shape==='rectangle'?sourceWidth*sourceWidth*s.source.aspect:Math.PI*sourceWidth**2/4;
    const aperture=Math.max(s.envelope.size[0]*s.envelope.size[1],s.envelope.size[1]*s.envelope.size[2],s.envelope.size[0]*s.envelope.size[2]);
    const half=s.source.distribution==='lambertian'?Math.PI/2:Math.min(Math.PI/2,s.source.angle*Math.PI/180),sourceEtendue=A*Math.PI*Math.sin(half)**2;
    const footprint=requested*requested,acceptance=Math.min(Math.PI,aperture/Math.max(1e-12,minTarget*minTarget));
    if(sourceEtendue>footprint*acceptance&&A>0)notes.push({kind:'limit',text:`Étendue estimate: routing the full emitting aperture into one ${requested.toFixed(1)}-unit tile needs ${(sourceEtendue/Math.max(1e-12,footprint*acceptance)).toFixed(1)}× its estimated acceptance. Only a fraction of the source flux can fit. This is a paraxial area/angle estimate, not a full feasibility proof.`});
    if(solution.surfaces.length<requests.length)notes.push({kind:'limit',text:`Envelope / self-shadowing budget: placed ${solution.surfaces.length} of ${requests.length} requested tiles. No additional separated, illuminated candidate fitted.`});
    notes.push({kind:'info',text:'Brightness is relative. Available solid angle limits intercepted flux; the measured efficiencies below report what this geometry actually catches.'});
    if(s.design.curved)notes.push({kind:'info',text:'Tile sizes use a paraxial starting estimate. Curved intersections are exact; off-axis astigmatism and source blur remain visible in the trace.'});
    return notes;
  }
  function generate(s) {
    const req=s.mode==='stamp'?s.stamps:zones(s),key=JSON.stringify({source:s.source,target:s.target,design:s.design,mode:s.mode,requests:req}),old=s.surfaces;
    const result=solve(s,req);let retained=false;
    // Expanding a feasible set cannot worsen its optimum, but a greedy finite
    // search can. Keep the incumbent and compare actual occluded interception
    // using the SAME seeded emission samples, rather than trusting proxy area.
    if(s.designCache?.key===key&&old.length&&old.every(f=>!f.vertices&&Geo.fits(s.envelope,f))) {
      const measure=surfaces=>new O.Simulation({...s,surfaces,simulation:{...s.simulation,rays:10000}},{paths:0}).finish().stats().intercepted;
      const before=measure(old),after=measure(result.surfaces);
      if(after<before){result.surfaces=old;retained=true;}
    }
    s.surfaces=result.surfaces;s.notes=feasibility(s,result,req);s.designCache={key};
    if(retained)s.notes.push({kind:'info',text:'The new search intercepted less light, so the previous still-fitting design was retained. Comparison uses 10,000 identical seeded emission samples with occlusion.'});
    if(req.some(r=>r.clamped))s.notes.push({kind:'limit',text:'A stamped width was clamped above its selected surface’s source-image floor. The tile outline and width control show the achievable requested size.'});return result;
  }
  function triangle(a,b,c,type,flip=false,id='mesh') {return {id,vertices:flip?[a,c,b]:[a,b,c],type,reflectivity:.9,ior:1.5,twoSided:false};}
  function profileMesh(s) {
    // Reflection doubles normal errors. Circumferential chord normals therefore
    // need finer sampling than sqrt(budget): eight sectors per sqrt(budget)
    // keeps their angular error comparable to a hand-drawn radial profile.
    const p=s.profile,out=[],origin=s.source.position,n=Math.max(24,Math.ceil(Math.sqrt(s.design.budget)*8)),type=s.design.profileType;
    // Profile coordinates are (radius, axial z), relative to the source.
    // Increasing radius on a dish gives inward / upward mirror normals.
    for(let i=0;i<p.length-1;i++) {
      if(s.design.profileSweep==='revolve') {
        for(let j=0;j<n;j++){const a=j/n*2*Math.PI,b=(j+1)/n*2*Math.PI;
          const point=(q,t)=>V.add(origin,[q[0]*Math.cos(t),q[0]*Math.sin(t),q[1]]),v=[point(p[i],a),point(p[i+1],a),point(p[i+1],b),point(p[i],b)];
          if(V.distance(v[0],v[1])>1e-9&&V.distance(v[1],v[2])>1e-9)out.push(triangle(v[0],v[1],v[2],type,s.design.profileFlip,'profile-'+i+'-'+j+'a'));
          if(V.distance(v[0],v[3])>1e-9)out.push(triangle(v[0],v[2],v[3],type,s.design.profileFlip,'profile-'+i+'-'+j+'b'));
        }
      }else for(const sign of s.design.profileSymmetry?[-1,1]:[1]) {
        const a=V.add(origin,[sign*p[i][0],-s.design.extrusion/2,p[i][1]]),b=V.add(origin,[sign*p[i+1][0],-s.design.extrusion/2,p[i+1][1]]),c=V.add(b,[0,s.design.extrusion,0]),d=V.add(a,[0,s.design.extrusion,0]);
        out.push(triangle(a,b,c,type,s.design.profileFlip!==(sign<0),'profile-'+i+sign+'a'),triangle(a,c,d,type,s.design.profileFlip!==(sign<0),'profile-'+i+sign+'b'));
      }
    }
    const fitted=out.filter(f=>f.vertices.every(v=>Geo.inside(s.envelope,v)));s.surfaces=fitted;s.notes=[{kind:'info',text:`${fitted.length} finite triangles. Profile uses source-relative coordinates; the source and envelope have not moved. ${out.length-fitted.length} triangles outside the envelope were omitted.`}];
    if(type==='refract')s.notes.push({kind:'limit',text:'Glass needs a closed profile with outward normals. An open profile represents a single interface, not a solid lens. Use Flip if the boundary orientation is reversed.'});return fitted;
  }
  function parabolaProfile(s) {const f=Math.min(...s.envelope.size)*.22,R=Math.min(s.envelope.size[0],s.envelope.size[1])*.44;s.profile=Array.from({length:17},(_,i)=>{const r=R*i/16;return [r,r*r/(4*f)-f];});return profileMesh(s);}
  function lens(s) {
    const d=s.design,R=d.lensRadius,t=d.lensThickness,f=d.lensFocal,n=d.ior,kind=d.lens;
    const segments=Math.max(24,Math.ceil(Math.sqrt(d.budget)*5)),rings=kind==='fresnel'?d.lensRings:Math.max(6,Math.ceil(Math.sqrt(d.budget))),out=[];
    const frame=V.frame(s.source.axis),offset=Math.max(t+1,f*.35),center=V.add(s.source.position,V.mul(frame.n,offset));
    // A closed rotational solid is triangulated with explicitly outward normals.
    // Spherical lens radii use the thin-lens equation only for authoring;
    // propagation always uses finite thickness, Snell and exact triangle hits.
    const curvature=Math.max(R*1.01,(n-1)*f*(kind==='biconvex'?2:1));
    const sag=r=>curvature-Math.sqrt(curvature*curvature-r*r),profile=[];
    if(kind==='tir') {
      // Hollow entrance cup + expanding dielectric wall + flat exit. This is
      // a parametrized TIR-capable cup, not a guaranteed collimating asphere.
      profile.push([0,t*.35],[R*.28,t*.35],[R*.28,-t*.65],[R*.48,-t*.65],[R,t],[0,t]);
    }else {
      for(let i=0;i<=rings;i++){const r=R*i/rings;profile.push([r,kind==='biconvex'?-t/2-sag(R)+sag(r):-t/2]);}
      if(kind==='fresnel') {
        profile.push([R,t/2]);
        for(let i=rings;i>=1;i--){const hi=R*i/rings,lo=R*(i-1)/rings,mid=(hi+lo)/2,slope=mid/Math.max(.1,(n-1)*f);profile.push([hi,t/2],[lo,t/2+(hi-lo)*slope]);}
      }else for(let i=rings;i>=0;i--){const r=R*i/rings;profile.push([r,t/2+sag(R)-sag(r)]);}
    }
    const wp=(q,a)=>V.add(center,V.world([q[0]*Math.cos(a),q[0]*Math.sin(a),q[1]],frame));
    for(let i=0;i<profile.length-1;i++)for(let j=0;j<segments;j++) {
      const a=2*Math.PI*j/segments,b=2*Math.PI*(j+1)/segments,v=[wp(profile[i],a),wp(profile[i+1],a),wp(profile[i+1],b),wp(profile[i],b)];
      // Profile travels along the bottom outward, then top inward: reversed
      // revolve winding makes the normals point out of the glass body.
      for(const [k,l,m]of [[0,2,1],[0,3,2]])if(V.len(V.cross(V.sub(v[l],v[k]),V.sub(v[m],v[k])))>1e-12)out.push({...triangle(v[k],v[l],v[m],'refract',false,'lens-'+i+'-'+j+'-'+m),ior:n});
    }
    if(!out.every(x=>x.vertices.every(p=>Geo.inside(s.envelope,p)))) {s.notes=[{kind:'limit',text:'Lens does not fit the envelope in front of the current emission axis. Enlarge or move the envelope, reduce the lens, or change its offset by adjusting focal length. Scene unchanged.'}];return false;}
    s.surfaces=out;s.notes=[{kind:'info',text:`Closed ${kind} lens: ${out.length} triangles, index ${n}. Fresnel reflected and transmitted branches are both traced. At least 2 bounces are needed to pass through; current limit is ${s.simulation.bounces}.`},{kind:'info',text:kind==='tir'?'TIR cup preset: real dielectric boundaries and TIR, but its polygonal cup is not an optimized collimator.':'Spherical / annular lens geometry is faceted. Increase facet budget to refine its geometric approximation.'}];return true;
  }
  O.Design={aim,targetPoint,tileEstimate,candidatePositions,facetGeometry,makeFacet,zones,solve,feasibility,generate,profileMesh,parabolaProfile,lens};
})(Optics);
