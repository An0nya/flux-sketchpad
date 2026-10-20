/* M2 browser functions; run through the owner-operated GPU runner. */
(function(){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),a=()=>RF.DriveAnim._;
 async function ready(port){if(!RF.UI||location.port!==String(port))throw Error('M2 wrong RF.UI/port');const u=await M1Page.ready(port);return u;}
 let zeroBeam;
 function draw(obs,on,{ambient=0,wet=false,noBeam=false}={}){
  const V=a().V,p={...V.p,lut:noBeam?(zeroBeam||(zeroBeam=RF.Drive.lutFrom(()=>0))):V.p.lut,detailedModels:on,look:{...V.p.look,wet,wetSheen:wet,grain:false,ambient}},objects=RF.Drive.Models.actors(obs,on),world={objects,A:null,markings:p.src.markings},k=Math.pow(2,RF.UI.dvOpts.ev||0)/RF.Drive.L_REF;
  V.gl.draw({hfov:p.hfov,pats:[],k,glare:0,veil:0,flip:false,tex:0,groundGPU:(A,O)=>V.three.render(p,world,0,A,O,1)});
  return {p,world,pixels:a().readHdr(),state:V.three.modelState(),k};
 }
 async function assets(){for(let i=0;i<100;i++){draw(M1Page.kit('cars'),true);if(a().V.three.modelState().ready||a().V.three.modelState().error)return;await sleep(50);}throw Error('M2 car load timeout');}
 async function regression(port){
  const defaultOff=RF.UI.dvOpts.detailedModels===false,u=await ready(port),checks=[],cases=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+(detail?' '+JSON.stringify(detail):''));};
  ok('M2 detail default off',defaultOff);Object.assign(a().V.popStage.style,{width:'640px',height:'360px'});u.redrawSpec();await sleep(100);await assets();
  const car=draw(M1Page.kit('cars'),true).state;
  ok('M2 loaded cars and flush mounts',car.ready&&!car.error&&car.cars===3&&car.mounts.length>0&&car.mounts.every(m=>m.gap===.001),car);
  ok('M2 EU rectangular plate dimensions',car.mounts.filter(m=>m.type==='plate').every(m=>m.width===.520&&m.height===.110));
  const originalUS=a().V.p.us;a().V.p.us=true;const us=draw(M1Page.kit('cars'),true).state;ok('M2 US rectangular plate dimensions',us.mounts.filter(m=>m.type==='plate').every(m=>m.width===.305&&m.height===.152));a().V.p.us=originalUS;
  // LP: the SUV's head lamps are centred in the light housings flanking the plate (car coords; housing bounds measured from a head-on render: |y| 0.30-0.64, z 0.55-0.86, centre ~(0.47,0.70)).
  {let suvHeads=null;for(let x=5;x<=8&&!suvHeads;x+=.5){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.car(x,0,{face:-1,turn:0,lamps:'head',kcd:.5});const h=draw(K.O,true).state.mounts.filter(m=>m.type==='head'&&m.variant==='suv');if(h.length===2)suvHeads=h;}
   const inHousing=m=>{const ay=Math.abs(m.p[1]),z=m.p[2];return ay>=.30&&ay<=.64&&z>=.55&&z<=.86&&Math.abs(ay-.47)<=.03&&Math.abs(z-.70)<=.03;};
   ok('LP SUV head-lamp centres lie in the flanking housings',!!suvHeads&&suvHeads.every(inHousing),suvHeads&&suvHeads.map(m=>m.p));}
  const reversed=draw(M1Page.kit('cars').reverse(),true).state,variants=x=>JSON.stringify(x.mounts.map(m=>[m.id,m.variant,m.type,m.side,m.end]).sort());ok('M2 stable variants independent of render order',variants(car)===variants(reversed));
  const before=draw(M1Page.kit('cars'),false).pixels;draw(M1Page.kit('cars'),true);const after=draw(M1Page.kit('cars'),false).pixels;
  ok('M2 off/on/off exact HDR restoration',before.every((v,i)=>v===after[i]));
  for(const kind of ['person','deer','tree'])for(const state of kind==='person'?['walk']:kind==='tree'?['stand']:['walk','trot','bound'])for(const face of kind==='deer'?[-1,1]:[1])for(const yaw of Array.from({length:8},(_,i)=>i*Math.PI/4))for(let pose=0;pose<(kind==='tree'?1:8);pose++){
   const M=RF.Drive.Models,stride=M.GAITS[state].stride,obs=kind==='tree'?M.tree({x:18,y:0,h:6,id:'parity'}):[M.build(kind,{x:12,y:0,yaw,face,motion:{state,distance:stride*pose/8},ptype:'hivis',gameHazard:1})];obs.forEach(o=>o.gameHazard=1);
   const r=draw(obs,true,{ambient:.3}),p=r.p,body=new Uint8Array(p.w*p.h),cpu=RF.Drive.render({w:p.w,h:p.h,hfov:p.hfov,eye:RF.DriveAnim.EYE,lamps:p.lamps,lut:p.lut,conv:p.conv,lane:p.lane,look:p.look,ss:1,hazardBodyMask:body,scene:{objects:obs,markings:p.src.markings,verge:p.src.verge}}),gpu=a().V.three.masks(p,1).body;
   let err=0,sum=0,pixels=0,union=0,intersection=0;for(let i=0;i<body.length;i++){if(body[i]&&gpu[i])intersection++;if(body[i]||gpu[i]){union++;pixels++;for(let c=0;c<3;c++){err+=Math.abs(cpu.rgb[3*i+c]-r.pixels[4*i+c]);sum+=cpu.rgb[3*i+c];}}}
   const result={kind,state,face,yaw,pose,pixels,IoU:intersection/Math.max(1,union),HDR:err/Math.max(sum,pixels*3*.01)};cases.push(result);ok('M2 parity '+kind+'/'+state+'/'+face+'/'+yaw+'/'+pose,pixels>0&&result.IoU>=.98&&result.HDR<=.01,result);
  }
  const EK=RF.Drive.kit({Lw:3.5,rand:()=>.5});EK.deer(12,0,{motion:{state:'walk',distance:.2}});EK.O.forEach(o=>o.gameHazard=1);const er=draw(EK.O,true),ep=er.p,mask=new Uint8Array(ep.w*ep.h),body=new Uint8Array(ep.w*ep.h);
  RF.Drive.render({w:ep.w,h:ep.h,hfov:ep.hfov,eye:RF.DriveAnim.EYE,lamps:ep.lamps,lut:ep.lut,conv:ep.conv,lane:ep.lane,look:ep.look,ss:1,hazardMask:mask,hazardBodyMask:body,scene:{objects:RF.Drive.Models.actors(EK.O,true),markings:ep.src.markings,verge:ep.src.verge}});
  const gm=a().V.three.masks(ep,1),cpuEyes=mask.reduce((s,b,i)=>s+((b&~body[i])?1:0),0),gpuEyes=gm.mask.reduce((s,b,i)=>s+((b&~gm.body[i])?1:0),0);ok('M2 actual visible eyeshine pixels excluded from body',cpuEyes>0&&gpuEyes>0,{cpuEyes,gpuEyes});
  const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.tree(20,5,{id:'near'});K.tree(180,10,{id:'far'});const trees=draw(K.O,true).state;ok('M2 analytic near trees and fixed-view far cards',trees.nearTrees===1&&trees.farTrees===1,trees);
  return {pass:checks.every(c=>c.pass),checks,cases,thresholds:{IoU:.98,HDR:.01}};
 }
 async function shot(port,kind,on){await ready(port);await assets();let obs=M1Page.kit(kind);
  if(kind==='actors'){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.person(9,-1,'hivis',{dir:[0,1],motion:{state:'walk',distance:.22}});K.deer(11,1,{motion:{state:'walk',distance:.35}});obs=K.O;}
  if(kind==='buildings')obs=RF.Drive.buildScene('city',{Lw:3.5,seed:7},{people:false,animals:false,veg:false}).objects;
  const r=draw(obs,on,{ambient:0});return {kind,on,realBeam:true,sim:[r.p.w,r.p.h],state:r.state};
 }
 function cars(face){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});for(let variant=0;variant<3;variant++){let n=0;while(RF.Drive.Models.stableId('M2-car-'+n)%3!==variant)n++;K.car(11,(-1+variant)*3.4,{id:'M2-car-'+n,face,turn:.22,lamps:face===-1?'head':'tail',kcd:.2});}return K.O;}
 async function carShot(port,face,us=false){await ready(port);await assets();a().V.p.us=us;const r=draw(cars(face),true,{ambient:25,noBeam:true});return {face,us,state:r.state};}
 async function bench(port,{scene='forest',phone=false,count=RF.Drive.Models.TREE_COUNT,distance=RF.Drive.Models.TREE_DISTANCE}={}){
  const u=await ready(port),V=a().V;RF.Drive.Models.TREE_COUNT=count;RF.Drive.Models.TREE_DISTANCE=distance;
  if(phone)Object.assign(V.popStage.style,{width:innerWidth+'px',height:innerHeight+'px'});
  Object.assign(u.dvOpts,{scene,wet:scene==='city',wetSheen:scene==='city',glare:scene==='city'?'rain':'off',wild:true,density:3,trafficLogic:true,oncoming:true,preceding:true,mt:false,tex:true,fpsCounter:true,dynamicResolution:false,gpuRenderer:true,people:true,animals:true,veg:true});V.pinSS=0;
  const results=[];for(const on of [false,true,false,true]){u.dvOpts.detailedModels=on;Object.assign(u.dvAnim,{playing:true,dist:0,t:0});u.redrawSpec();await sleep(3000);RF.DriveAnim.resetStats();const t=performance.now(),f=V.frames,trace=u.run.ctx;await sleep(6000);const elapsed=performance.now()-t,s=RF.DriveAnim.stats();results.push({on,frames:V.frames-f,elapsed,fps:(V.frames-f)*1000/elapsed,canvas:s.canvasPx,sim:s.sim,ss:s.ss,p95:s.p95Ms,work:s.breakdownMean,renderer:s.renderer,sameTrace:u.run.ctx===trace,traceComplete:trace.done&&!u.needCompile,models:V.three.modelState()});u.dvAnim.playing=false;u.redrawSpec();}
  const gl=V.gl.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return {scene,phone,count,distance,viewport:[innerWidth,innerHeight],touch:navigator.maxTouchPoints,hardware:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null,results};
 }
 async function treeCompare(port,scales){
  await ready(port);await assets();const M=RF.Drive.Models,obs=[],names=['primitive','cluster','sdf','card'];
  for(let i=0;i<4;i++){const kind=names[i],scale=scales[kind],x=24,y=(1.5-i)*6,h=9*scale;let list;
   if(kind==='primitive'){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.tree(x,y,{h});list=K.O.map(o=>({...o,detailPart:undefined,detail:undefined,rx:o.rx?o.rx*scale:undefined,ry:o.ry?o.ry*scale:undefined,rz:o.rz?o.rz*scale:undefined}));}
   if(kind==='cluster')list=M.tree({x,y,h,id:'cost'}).map(o=>({...o,detailPart:undefined,detail:undefined}));
   if(kind==='sdf')list=[M.build('tree',{x,y,h})];
   if(kind==='card')list=[{k:'impostor',x,y,z:h*.5,rx:h*.4,rz:h*.5,r:h*.75,nx:-1,ny:0,nz:0,cardIndex:4,mat:'foliage',bs:[x,y,h*.5,h*.75]}];obs.push(...list);
  }draw(obs,true,{ambient:60,noBeam:true});return {leftToRight:names,calibration:'individual centred silhouettes ~18000 pixels; lateral positions change projection slightly',scales};
 }
 async function treeFade(port){await ready(port);await assets();const checks=[];for(const range of [130,134,138,142]){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.tree(range-2,.37,{id:'fade'});const r=draw(K.O,true,{ambient:30,noBeam:true}),near=r.state.nearTrees,far=r.state.farTrees;checks.push({range,near,far,pass:near===(range<140?1:0)&&far===(range>132?1:0)});}return {checks,pass:checks.every(c=>c.pass)};}
 async function treeCost(port){
  await ready(port);await assets();const V=a().V,M=RF.Drive.Models,results=[],target=18000;
  // Equal actual silhouette area. Height and distance are controlled; radius/height scale is calibrated separately per representation.
  function make(kind,scale){const x=24,h=9*scale;
   if(kind==='sdf')return [M.build('tree',{x,h,gameHazard:1})];
   if(kind==='cluster')return M.tree({x,h,id:'cost'}).map(o=>({...o,gameHazard:1,detailPart:undefined,detail:undefined}));
   if(kind==='primitive'){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.tree(x,0,{h});return K.O.map(o=>({...o,gameHazard:1,detailPart:undefined,detail:undefined,rx:o.rx?o.rx*scale:undefined,ry:o.ry?o.ry*scale:undefined,rz:o.rz?o.rz*scale:undefined}));}
   return [{k:'impostor',x,y:0,z:h*.5,rx:h*.4,rz:h*.5,r:h*.75,nx:-1,ny:0,nz:0,cardIndex:4,mat:'foliage',gameHazard:1,bs:[x,0,h*.5,h*.75]}];
  }
  draw([],true);await sleep(200);
  for(const kind of ['primitive','cluster','sdf','card']){let lo=.2,hi=2,scale=1,area=0,obs;
   for(let i=0;i<12;i++){scale=(lo+hi)/2;obs=make(kind,scale);const r=draw(obs,true,{ambient:.1});area=V.three.masks(r.p,1).body.reduce((s,v)=>s+(v?1:0),0);if(area<target)lo=scale;else hi=scale;}
   draw(obs,true,{ambient:.1});const timers=[];for(let i=0;i<3;i++)timers.push(await V.three.timeObjects(16));results.push({kind,scale,area,target,sim:[V.p.w,V.p.h],timers});
  }return {results,method:'actual body-mask area calibrated to target; complete GPU object pass, 3 queries x 16 draws; same distance, sampled silhouettes, no extrapolated FPS'};
 }
 async function detector(port){
  await ready(port);await assets();const D=RF.Drive,V=a().V,buildings=D.buildScene('city',{Lw:3.5,seed:7},{people:false,animals:false,veg:false}).objects.filter(o=>typeof o.mat==='function'&&String(o.mat).includes('win(h, seed)')),results=[];
  for(const on of [false,true]){let first=null,samples=[];
   for(let distance=230;distance>=10;distance-=2){const K=D.kit({Lw:3.5,rand:()=>.5});K.person(distance,7.5,'dark');const hazard=RF.Drive.Models.actors(K.O,true);hazard.forEach(o=>o.gameHazard=1);const obs=buildings.concat(hazard),r=draw(obs,on),rgba=a().readCanvas(),mask=V.three.masks(r.p,1).body;
    draw(buildings,on);const background=a().readCanvas(),lit=RF.DriveGame.firstLit({rgba,background,mask,w:V.gl.cw,h:V.gl.ch,mw:r.p.w,mh:r.p.h,cssW:1600,cssH:900,id:1});samples.push({distance,lit:!!lit,pixel:lit});if(lit){first=distance;break;}
   }const facade=draw(buildings,on),labels=V.three.masks(facade.p,1,true);let windowPixels=0,windowRGB=0;for(let i=0;i<labels.length;i+=4)if(labels[i]===28||labels[i]===29){windowPixels++;const y=Math.floor(i/4/facade.p.w),x=i/4%facade.p.w,k=((facade.p.h-1-y)*facade.p.w+x)*4;windowRGB+=facade.pixels[k]+facade.pixels[k+1]+facade.pixels[k+2];}results.push({facadeDetail:on,firstSeenMetres:first,windowPixels,windowRGB,samples});
  }return {seed:7,hazard:'same detailed dark person, stand, left sidewalk 7.5 m offset; only facade rendering toggled',stepMetres:2,realBeam:true,results};
 }
 async function assetFailure(port){await ready(port);const original=window.fetch;window.fetch=(url,...args)=>String(url.url||url).includes('/vendor/models/')?Promise.reject(Error('M2 injected asset failure')):original(url,...args);await assets();const r=draw(M1Page.kit('cars'),true),notice=a().V.why,result={state:r.state,notice};result.pass=!r.state.ready&&/M2 injected asset failure/.test(r.state.error)&&r.state.cars===0&&/using primitive cars/.test(notice);console.log((result.pass?'[PASS] ':'[FAIL] ')+'M2 asset failure fallback '+JSON.stringify(result));return result;}
 async function baseOff(port,sources){
  await ready(port);const V=a().V,url=s=>URL.createObjectURL(new Blob([s],{type:'text/javascript'})),absolute=s=>s.replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,q,path)=>'from '+JSON.stringify(new URL(path,location.origin+'/js/').href));
  const objectURL=url(absolute(sources.objects)),moduleURL=url(absolute(sources.renderer).replace(JSON.stringify(location.origin+'/js/drive-three-objects.js'),JSON.stringify(objectURL))),old=(await import(moduleURL)).create(V.canvas,V.gl.gl),cases=[];
  try{for(const scene of ['road','city','forest'])for(const wet of [false,true]){const p={...V.p,detailedModels:false,look:{...V.p.look,wet,wetSheen:wet,grain:false,ambient:0}},world=RF.Drive.buildScene(scene,{Lw:p.lane,seed:7},{people:true,animals:true,veg:true}),render=engine=>{V.gl.draw({hfov:p.hfov,pats:[],k:5,glare:0,flip:false,tex:0,groundGPU:(A,O)=>engine.render(p,world,0,A,O,1)});return {hdr:a().readHdr(),canvas:a().readCanvas()};},before=render(old),after=render(V.three);cases.push({scene,wet,changedHDR:before.hdr.reduce((s,v,i)=>s+(v!==after.hdr[i]?1:0),0),changedCanvas:before.canvas.reduce((s,v,i)=>s+(v!==after.canvas[i]?1:0),0)});}}
  finally{old.dispose();URL.revokeObjectURL(objectURL);URL.revokeObjectURL(moduleURL);}return {base:'c5231d9',cases,pass:cases.every(c=>!c.changedHDR&&!c.changedCanvas)};
 }
 window.M2Page={ready,draw,assets,regression,shot,carShot,bench,treeCost,treeCompare,treeFade,detector,baseOff,assetFailure};
})();
