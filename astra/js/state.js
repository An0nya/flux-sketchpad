(function (O) {
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  function defaults() {
    return {
      version:1,mode:'paint',source:{kind:'planar',shape:'disc',position:[0,0,0],axis:[0,0,-1],size:0.6,aspect:1,height:1,intensity:1,distribution:'lambertian',angle:65},
      envelope:{kind:'box',center:[0,0,-9],size:[30,26,22]},
      target:{center:[0,0,55],normal:[0,0,-1],width:32,height:24,linked:true,aim:[0,0,55],resolution:50},
      simulation:{rays:2000,bounces:1,floor:.01,seed:73129},
      design:{budget:64,curved:true,fill:1,edgeBias:0,designEmitter:1,stampSize:6,brush:3,paintLevel:1,profileSweep:'revolve',profileType:'reflect',profileFlip:false,profileSymmetry:true,extrusion:18,lens:'plano',lensRadius:7,lensThickness:3,lensFocal:20,lensRings:8,ior:1.5},
      view:{yaw:.62,pitch:.28,zoom:1,pan:[0,0],rays:true,normals:false,smooth:false,surfacePairs:false},
      paint:[],stamps:[],profile:[],surfaces:[],selection:null,notes:[],designCache:null
    };
  }
  function paintPreset(s,name='bar') {
    const n=s.target.resolution;s.paint=Array(n*n).fill(0);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
      const u=(x+.5)/n*2-1,v=(y+.5)/n*2-1;
      s.paint[y*n+x]=name==='ring'?(Math.hypot(u,v)>.32&&Math.hypot(u,v)<.65?1:0):name==='split'?(Math.abs(u)>.18&&Math.abs(u)<.7&&Math.abs(v)<.25?1:0):name==='spot'?(Math.hypot(u,v)<.32?1:0):(Math.abs(u)<.75&&Math.abs(v)<.22?1:0);
    }
  }
  function validate(raw) {
    if(!raw||raw.version!==1) throw Error('Unsupported scene file. Expected version 1.');
    const s=defaults();for(const k of Object.keys(s))if(raw[k]!==undefined)s[k]=typeof s[k]==='object'&&!Array.isArray(s[k])&&s[k]!==null?{...s[k],...raw[k]}:raw[k];
    const num=(x,a,b,label)=>{if(!Number.isFinite(x)||x<a||x>b)throw Error('Invalid '+label);};
    const vec=(x,label)=>{if(!Array.isArray(x)||x.length!==3)throw Error('Invalid '+label);x.forEach(v=>num(v,-1e8,1e8,label));};
    num(s.simulation.rays,100,1e6,'ray count');num(s.simulation.bounces,1,8,'bounces');num(s.simulation.floor,0,1,'energy floor');num(s.target.resolution,10,100,'grid');
    if(!Number.isInteger(s.target.resolution)||!Number.isInteger(s.simulation.rays))throw Error('Grid and ray count must be integers.');
    vec(s.source.position,'source');vec(s.source.axis,'source axis');vec(s.envelope.center,'envelope');vec(s.envelope.size,'envelope dimensions');vec(s.target.center,'target');vec(s.target.normal,'target normal');vec(s.target.aim,'aim');
    for(const v of s.envelope.size)num(v,.001,1e6,'envelope dimension');
    num(s.source.size,0,1e6,'source size');num(s.source.intensity,0,1e6,'intensity');num(s.target.width,.001,1e6,'target width');num(s.target.height,.001,1e6,'target height');
    if(O.V.len(s.source.axis)<.1||O.V.len(s.target.normal)<.1)throw Error('Direction cannot be zero.');
    if(!Array.isArray(s.surfaces)||s.surfaces.length>20000)throw Error('Invalid surface list.');
    for(const f of s.surfaces) {if(!['reflect','refract','absorb'].includes(f.type))throw Error('Unknown surface interaction.');if(f.vertices){if(f.vertices.length!==3)throw Error('Expected triangle.');f.vertices.forEach(p=>vec(p,'vertex'));}else{vec(f.center,'surface');vec(f.normal,'normal');num(f.width,.000001,1e6,'facet width');num(f.height,.000001,1e6,'facet height');}if(f.type==='reflect')num(f.reflectivity,0,1,'reflectivity');if(f.type==='refract')num(f.ior,1,4,'index');}
    if(s.paint.length!==s.target.resolution**2)paintPreset(s); else s.paint.forEach(v=>num(v,0,100,'paint'));
    return clone(s);
  }
  // Every UI edit and the wiring tests enter through this same reducer.
  function edit(s,path,value) {
    const keys=path.split('.');let obj=s;for(const k of keys.slice(0,-1))obj=obj[k];obj[keys.at(-1)]=value;
    if(path==='target.center'&&s.target.linked)s.target.aim=[...value];
    if(path==='target.linked'&&value)s.target.aim=[...s.target.center];
    if(path==='target.resolution') { const old=Math.round(Math.sqrt(s.paint.length)),a=s.paint;s.paint=Array.from({length:value*value},(_,i)=>a[Math.min(old-1,Math.floor(Math.floor(i/value)*old/value))*old+Math.min(old-1,Math.floor(i%value*old/value))]||0); }
  }
  O.State={defaults,clone,validate,edit,paintPreset};
})(Optics);
