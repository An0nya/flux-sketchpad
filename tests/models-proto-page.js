/* Shared page-side prototype checks and measurements, run by external GPU Chromium. */
(function(){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),D=()=>RF.DriveAnim,a=()=>D()._;
 async function ready(port){
  if(!RF.UI || location.port!==String(port))throw Error('M1 wrong page: RF.UI/port');
  const u=await P1Page.ready();Object.assign(u.dvOpts,{mt:false,tex:false,fpsCounter:false,dynamicResolution:false,scene:'road',tiles:false,wild:false,oncoming:false,preceding:false,detailedModels:false,ambient:0,glare:'off'});
  D().openPop(u);Object.assign(a().V.popStage.style,{position:'fixed',left:'0',top:'0',width:'1600px',height:'900px'});a().V.pinSS=1;
  await P1Page.select(true);await P1Page.select(false);await P1Page.select(true);return u;
 }
 function kit(kind){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});
  if(kind==='actors'){K.person(8,-1,'hivis',{gait:.085,dir:[0,1]});K.person(8,1.5,'light',{gait:-.08,dir:[1,0]});K.deer(9,0,{gait:.1});}
  if(kind==='cars'){K.car(10,-3,{face:1,turn:.4,lamps:'tail'});K.car(14,1,{face:-1,turn:.2,lamps:'head',kcd:.5});K.car(17,4,{face:1,turn:-.2,lamps:'tail'});}
  if(kind==='trees'){K.tree(12,-5,{h:8});K.tree(25,10,{h:9});K.tree(80,12,{h:10});}
  return K.O;
 }
 let zeroBeam;
 function draw(obs,on,{ambient=1,wet=false,noBeam=false}={}){
  const V=a().V,p={...V.p,lut:noBeam?(zeroBeam||(zeroBeam=RF.Drive.lutFrom(()=>0))):V.p.lut,detailedModels:on,look:{...V.p.look,wet,wetSheen:wet,grain:false,ambient}},objects=RF.Drive.Models.actors(obs,on),world={objects,A:null,markings:p.src.markings};
  V.gl.draw({hfov:p.hfov,pats:[],k:5,glare:0,veil:0,flip:false,tex:0,groundGPU:(A,O)=>V.three.render(p,world,0,A,O,1)});
  return {p,world,pixels:a().readHdr(),state:V.three.modelState()};
 }
 async function shot(port,kind,on){
  await ready(port);let obs=kit(kind);
  if(kind==='buildings')obs=RF.Drive.buildScene('city',{Lw:3.5,seed:7},{people:false,animals:false,veg:false}).objects.filter(o=>typeof o.mat==='function' && String(o.mat).includes('win(h, seed)'));
  draw(obs,true);for(let i=0;i<100 && !a().V.three.modelState().ready;i++){await sleep(50);draw(obs,true);}
  const r=draw(obs,on,{ambient:kind==='actors'?3:1,noBeam:true});
  // Suppress UI redraws after the controlled frame; runner screenshot observes this exact canvas.
  return {kind,on,sim:[r.p.w,r.p.h],state:r.state};
 }
 async function parity(port){
  const defaultOff=RF.UI.dvOpts.detailedModels===false,u=await ready(port),checks=[],cases=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+(detail?' '+JSON.stringify(detail):''));};
  ok('M1 detailed models default off',defaultOff);
  const thresholds={relativeHDR:.01,bodyIoU:.98};
  for(const kind of ['person','deer'])for(const range of [12,45,100])for(const yaw of [0,.7])for(const gait of [0,.1,-.1]){
   const ob=RF.Drive.Models.build(kind,{x:range,y:0,yaw,gait,ptype:'hivis',gameHazard:1,bound:kind==='deer'&&gait<0}),r=draw([ob],true,{ambient:.3}),p=r.p,mask=new Uint8Array(p.w*p.h),body=new Uint8Array(p.w*p.h);
   const cpu=RF.Drive.render({w:p.w,h:p.h,hfov:p.hfov,eye:D().EYE,lamps:p.lamps,lut:p.lut,conv:p.conv,lane:p.lane,look:p.look,ss:1,hazardMask:mask,hazardBodyMask:body,scene:{objects:[ob],markings:p.src.markings,verge:p.src.verge}}),gm=a().V.three.masks(p,1);
   let error=0,sum=0,count=0,intersection=0,union=0,max=0;
   for(let i=0;i<mask.length;i++){if(body[i]&&gm.body[i])intersection++;if(body[i]||gm.body[i]){union++;count++;for(let c=0;c<3;c++){const x=cpu.rgb[3*i+c],y=r.pixels[4*i+c],d=Math.abs(x-y);error+=d;sum+=x;max=Math.max(max,d);}}}
   const result={kind,range,yaw,gait,actorPixels:count,relativeHDR:error/Math.max(sum,count*3*.01),bodyIoU:intersection/Math.max(1,union),maxChannel:max};cases.push(result);
   ok('M1 SDF parity '+kind+'/'+range+'/'+yaw+'/'+gait,result.actorPixels>0&&result.relativeHDR<=thresholds.relativeHDR&&result.bodyIoU>=thresholds.bodyIoU,result);
  }
  const eyes=RF.Drive.Models.actors(kit('actors'),true).filter(o=>o.mat==='eyeshine');ok('M1 two eyes at articulated SDF head',eyes.length===2&&eyes.every(o=>Number.isFinite(o.x)&&o.sub));
  const eyeK=RF.Drive.kit({Lw:3.5,rand:()=>.5});eyeK.deer(12,0,{gait:.1});eyeK.O.forEach(ob=>ob.gameHazard=1);const eyeFrame=draw(eyeK.O,true,{ambient:0}),ep=eyeFrame.p,em=new Uint8Array(ep.w*ep.h),eb=new Uint8Array(ep.w*ep.h);
  RF.Drive.render({w:ep.w,h:ep.h,hfov:ep.hfov,eye:D().EYE,lamps:ep.lamps,lut:ep.lut,conv:ep.conv,lane:ep.lane,look:ep.look,ss:1,hazardMask:em,hazardBodyMask:eb,scene:{...eyeFrame.world,verge:ep.src.verge}});
  const eg=a().V.three.masks(ep,1),eyePixels={cpu:em.reduce((v,b,i)=>v+((b&~eb[i])?1:0),0),gpu:eg.mask.reduce((v,b,i)=>v+((b&~eg.body[i])?1:0),0)};
  ok('M1 actual visible eyeshine excluded from body mask',eyePixels.cpu>0&&eyePixels.gpu===eyePixels.cpu,eyePixels);

  const obs=kit('actors'),off=draw(obs,false).pixels;draw(obs,true);const again=draw(obs,false).pixels;ok('M1 off restores exact GPU HDR',off.every((v,i)=>v===again[i]));
  u.dvOpts.detailedModels=false;u.redrawSpec();document.querySelector('[data-anim=detailed-models]').click();ok('M1 toggle persists',JSON.parse(localStorage.getItem('flux/driveView')).detailedModels===true);
  draw(kit('cars'),true);for(let i=0;i<100&&!a().V.three.modelState().ready;i++){await sleep(50);draw(kit('cars'),true);}const car=draw(kit('cars'),true).state;
  ok('M1 all three CC0 bodies loaded',car.ready&&!car.error&&car.cars===3&&car.triangles===6594,car);
  const tree=draw(kit('trees'),true).state;ok('M1 near SDF and far relightable tree card',tree.nearTrees===2&&tree.farTrees===1,tree);
  return {pass:checks.every(c=>c.pass),checks,cases,thresholds};
 }
 async function bench(port){
  const u=await ready(port),V=a().V,results=[];
  Object.assign(u.dvOpts,{scene:'city',wet:true,wetSheen:true,glare:'rain',wild:true,density:3,trafficLogic:true,oncoming:true,preceding:true,mt:false,tex:true,fpsCounter:true,dynamicResolution:false,gpuRenderer:true});
  V.pinSS=0;u.redrawSpec();await sleep(1000);
  for(const on of [false,true,false,true]){
   u.dvOpts.detailedModels=on;Object.assign(u.dvAnim,{playing:true,dist:0,t:0});u.redrawSpec();await sleep(3000);D().resetStats();const started=performance.now(),frames=V.frames,trace=u.run.ctx;await sleep(8000);const elapsed=performance.now()-started,stats=D().stats();
   results.push({on,completed:V.frames-frames,elapsed,averageFPS:(V.frames-frames)*1000/elapsed,canvas:stats.canvasPx,sim:stats.sim,ss:stats.ss,p95Ms:stats.p95Ms,workMs:stats.breakdownMean.workMs,renderer:stats.renderer,sameTrace:u.run.ctx===trace,traceComplete:trace.done&&!u.needCompile,models:V.three.modelState()});
   u.dvAnim.playing=false;u.redrawSpec();
  }
  const gl=V.gl.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');return {fixture:'MG2-default-lamp.json; owner heavy settings, not her saved optics',renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,viewport:[innerWidth,innerHeight],devicePixelRatio,results};
 }
 async function actorCost(port){
  await ready(port);const V=a().V,results=[];
  for(const n of [1,8,24]) {
   const obs=[];for(let i=0;i<n;i++)obs.push(RF.Drive.Models.build(i%2?'deer':'person',{x:10+Math.floor(i/8)*14,y:n===1?0:(i%8-3.5)*.14*(12+Math.floor(i/8)*14),gait:.1,ptype:'hivis'}));
   draw(obs,true);await sleep(200);draw(obs,true);const labelled=V.three.masks(V.p,1,true),visible={};for(let i=0;i<labelled.length;i+=4)if(labelled[i]>0){const id=Math.round(labelled[i+3]);visible[id]=(visible[id]||0)+1;}
   const work=V.three.objectWork(V.p,1),timers=[];for(let i=0;i<3;i++)timers.push(await V.three.timeObjects(16));
   let frames=0,start=performance.now(),end=start+4000;while(performance.now()<end){draw(obs,true);frames++;await new Promise(requestAnimationFrame);}
   const elapsed=performance.now()-start;results.push({n,sim:[V.p.w,V.p.h],ss:1,visibleActors:Object.keys(visible).length,actorPixelsByIndex:visible,work,timers,completed:frames,elapsed,fps:frames*1000/elapsed});
  }
  return {results,note:'Fixed poses, SS1, normal app compositor; GPU timers isolate the object draw, including proxy misses. Overlapping proxies make multi-actor work counts visible-pixel counts, not total invocations.'};
 }
 async function game(port){
  const u=await ready(port);u.dvOpts.detailedModels=true;u.redrawSpec();a().toggleGame(u);document.querySelector('[data-game=start]').click();u.dvAnim.playing=false;u.redrawSpec();await new Promise(requestAnimationFrame);
  const g=u.dvAnim.game;g.next=1000;g.hazards=[{id:1,born:g.t,kind:'deer',s0:g.x+18,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,side:-1,crosswalk:false,noHiViz:false,jaywalking:false,lit:null,reaction:null,resolved:false}];g.spawned=1;delete g.pauseAt;a().frame();
  const V=a().V,frame=a().readCanvas(),background=a().gameBackground(1),restored=a().readCanvas(),result={renderer:D().stats().renderer,detailed:V.p.detailedModels,models:V.three.modelState(),bodyPixels:V.gameBodyMask.reduce((s,b)=>s+(b?1:0),0),seen:g.seen,restored:frame.every((v,i)=>v===restored[i]),background:!!background};
  result.pass=result.renderer==='three'&&result.detailed&&result.bodyPixels>0&&result.seen===1&&result.restored&&result.background;return result;
 }
 async function classCost(port){
  await ready(port);const results=[];
  for(const name of ['near-tree','far-tree','cars','buildings']){
   let obs;if(name==='near-tree'||name==='far-tree'){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.tree(name==='near-tree'?20:80,4,{h:9});obs=K.O;}
   else if(name==='cars')obs=kit('cars');else obs=RF.Drive.buildScene('city',{Lw:3.5,seed:7},{people:false,animals:false,veg:false}).objects.filter(o=>typeof o.mat==='function' && String(o.mat).includes('win(h, seed)'));
   draw(obs,true);await sleep(500);draw(obs,true);const timers=[];for(let i=0;i<3;i++)timers.push(await a().V.three.timeObjects(16));results.push({name,sim:[a().V.p.w,a().V.p.h],state:a().V.three.modelState(),timers});
  }return {results};
 }
 async function pausedAssets(port){
  const u=await ready(port);Object.assign(u.dvOpts,{scene:'city',detailedModels:true});u.dvAnim.playing=false;const before=a().V.frames;u.redrawSpec();
  for(let i=0;i<200 && !(a().V.three.modelState().ready&&a().V.three.modelState().cars>0);i++)await sleep(50);
  const state=a().V.three.modelState(),result={state,frames:a().V.frames-before,playing:u.dvAnim.playing,renderer:D().stats().renderer};
  result.pass=state.ready&&state.cars>0&&result.frames>=2&&!result.playing&&result.renderer==='three';return result;
 }
 async function lifecycle(port){
  await ready(port);const obs=kit('cars');draw(obs,true);for(let i=0;i<100&&!a().V.three.modelState().ready;i++){await sleep(50);draw(obs,true);}const before=draw(obs,true).pixels,cycles=[];
  for(let i=0;i<5;i++){await P1Page.select(false);await P1Page.select(true);const r=draw(obs,true);cycles.push({renderer:D().stats().renderer,state:r.state,identical:before.length===r.pixels.length&&before.every((v,j)=>v===r.pixels[j])});}
  return {cycles,pass:cycles.every(c=>c.renderer==='three'&&c.state.ready&&!c.state.error&&c.identical),note:'toggle smoke, not a GPU allocation soak'};
 }
 async function baseOff(port,sources){
  await ready(port);const V=a().V,root=location.origin+'/',url=s=>URL.createObjectURL(new Blob([s],{type:'text/javascript'}));
  const objects=url(sources.objects.replace("'../vendor/three/three.module.min.js'",JSON.stringify(root+'vendor/three/three.module.min.js')).replace("'./drive-three-shaders.js'",JSON.stringify(root+'js/drive-three-shaders.js')));
  const mod=url(sources.renderer.replace("'../vendor/three/three.module.min.js'",JSON.stringify(root+'vendor/three/three.module.min.js')).replace("'./drive-three-shaders.js'",JSON.stringify(root+'js/drive-three-shaders.js')).replace("'./drive-three-objects.js'",JSON.stringify(objects)));
  const old=(await import(mod)).create(V.canvas,V.gl.gl),cases=[];
  try{for(const scene of ['road','city','forest'])for(const wet of [false,true]){
   const p={...V.p,detailedModels:false,look:{...V.p.look,wet,wetSheen:wet,grain:false,ambient:0}},world=RF.Drive.buildScene(scene,{Lw:p.lane,seed:7},{people:true,animals:true,veg:true});
   const render=engine=>{V.gl.draw({hfov:p.hfov,pats:[],k:5,glare:0,flip:false,tex:0,groundGPU:(A,O)=>engine.render(p,world,0,A,O,1)});return {hdr:a().readHdr(),px:a().readCanvas()};};
   const before=render(old),after=render(V.three);let changedHDR=0,changedCanvas=0,maxHDR=0;
   before.hdr.forEach((v,i)=>{if(v!==after.hdr[i])changedHDR++;maxHDR=Math.max(maxHDR,Math.abs(v-after.hdr[i]));});before.px.forEach((v,i)=>{if(v!==after.px[i])changedCanvas++;});
   cases.push({scene,wet,changedHDR,changedCanvas,maxHDR});
  }}finally{old.dispose();URL.revokeObjectURL(mod);URL.revokeObjectURL(objects);}
  return {base:'3425a24',cases,pass:cases.every(c=>!c.changedHDR&&!c.changedCanvas)};
 }
 window.M1Page={ready,draw,kit,shot,parity,bench,actorCost,classCost,baseOff,game,lifecycle,pausedAssets};
})();
