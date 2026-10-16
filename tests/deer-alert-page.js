/* DA page fixtures shared by external runner and tester wrappers. Real default-lamp fixture, EV1, ambient0. */
(function(){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),a=()=>RF.DriveAnim._;
 async function ready(port){if(!RF.UI||location.port!==String(port))throw Error('DA wrong RF.UI/port');await M2Page.ready(port);await M2Page.assets();const u=RF.UI;u.dvOpts.ev=1;u.dvAnim.playing=false;return u;}
 function draw(world){const V=a().V,p={...V.p,A:world.A,detailedModels:true,look:{...V.p.look,ambient:0,grain:false,wet:false,wetSheen:false}},k=2/RF.Drive.L_REF;V.gl.draw({hfov:p.hfov,pats:[],k,glare:0,veil:0,flip:false,tex:0,groundGPU:(A,O)=>V.three.render(p,world,0,A,O,1)});return {p,rgba:a().readCanvas(),hdr:a().readHdr(),masks:V.three.masks(p,1)};}
 function deer(range,attention,{off=0,face=1,motion}={}){const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.deer(range,off,{attention,face,motion});K.O.forEach(o=>o.gameHazard=1);return RF.Drive.Models.actors(K.O,true);}
 function sample(range,attention,opt){const objects=deer(range,attention,opt),world={A:null,objects,markings:a().V.p.src.markings},r=draw(world);let eyePixels=0,eyeEnergy=0;for(let i=0;i<r.masks.mask.length;i++)if(r.masks.mask[i]&~r.masks.body[i]){eyePixels++;const q=i*4;eyeEnergy+=r.hdr[q]+r.hdr[q+1]+r.hdr[q+2];}return {...r,world,eyePixels,eyeEnergy};}
 async function regression(port){await ready(port);const M=RF.Drive.Models,checks=[],samples=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+' '+JSON.stringify(detail||{}));};
 const id=Array.from({length:200},(_,i)=>'DA:'+i).find(id=>{const p=M.deerProfile(id);return !p.never&&!p.early&&p.trigger<100;}),profile=M.deerProfile(id),speed=75/3.6;
 for(const elapsed of [-.5,0,profile.turn*.2,profile.turn*.4,profile.turn*.6,profile.turn*.8,profile.turn,profile.turn+.2]){
  const attention=M.deerAttention(id,elapsed),range=profile.trigger-speed*elapsed,r=sample(range,attention);samples.push({elapsed,range,state:attention.state,up:attention.up,eyePixels:r.eyePixels,eyeEnergy:r.eyeEnergy});
 }
 ok('DA real-beam grazing has no eye pixels',samples[0].eyePixels===0,samples[0]);ok('DA eye pixels and return rise through head turn',samples.slice(2).some(s=>s.eyePixels>0&&s.eyeEnergy>0),samples);
 const parity=[];for(const elapsed of [-1,profile.turn*.5,profile.turn,profile.turn+profile.freeze+.3])for(const face of [-1,1]){
  const attention=M.deerAttention(id,elapsed),r=sample(12,attention,{face,motion:{state:elapsed>profile.turn+profile.freeze?'bound':'stand',distance:1.3}}),p=r.p,mask=new Uint8Array(p.w*p.h),body=new Uint8Array(mask.length),cpu=RF.Drive.render({w:p.w,h:p.h,hfov:p.hfov,eye:RF.DriveAnim.EYE,lamps:p.lamps,lut:p.lut,conv:p.conv,lane:p.lane,look:p.look,ss:1,hazardMask:mask,hazardBodyMask:body,scene:r.world});let sum=0,err=0,union=0,intersection=0;
  for(let i=0;i<body.length;i++){if(body[i]||r.masks.body[i]){union++;if(body[i]&&r.masks.body[i])intersection++;for(let c=0;c<3;c++){sum+=cpu.rgb[3*i+c];const q=i*4+c;err+=Math.abs(cpu.rgb[3*i+c]-r.hdr[q]);}}}
  const row={state:attention.state,face,IoU:intersection/Math.max(1,union),HDR:err/Math.max(sum,union*.03),cpuEyes:mask.reduce((s,b,i)=>s+((b&~body[i])?1:0),0),gpuEyes:r.eyePixels};parity.push(row);ok('DA CPU/GPU '+attention.state+'/'+face,row.IoU>=.98&&row.HDR<=.01,row);
 }
 const before=sample(12,null).hdr;sample(12,M.deerAttention(id,profile.turn));const after=sample(12,null).hdr;ok('DA behaviour OFF restores exact original HDR',before.every((v,i)=>v===after[i]));
 const u=RF.UI;u.dvOpts.detailedModels=true;u.dvOpts.deerBehaviour=true;u.redrawSpec();await sleep(100);const button=document.querySelector('[data-anim=deer-behaviour]');button.click();ok('DA behaviour toggle persists OFF',JSON.parse(localStorage.getItem('flux/driveView')).deerBehaviour===false);button.click();ok('DA behaviour toggle persists ON',JSON.parse(localStorage.getItem('flux/driveView')).deerBehaviour===true);
 sample(12,M.deerAttention(id,profile.turn));return {pass:checks.every(c=>c.pass),checks,samples,parity,id,profile};
 }
 async function shot(port,state){await ready(port);const M=RF.Drive.Models,id=Array.from({length:200},(_,i)=>'DA:'+i).find(id=>!M.deerProfile(id).never&&!M.deerProfile(id).early),p=M.deerProfile(id),elapsed={grazing:-1,turning:p.turn*.5,freeze:p.turn+.1,bolt:p.turn+p.freeze+.4}[state],attention=M.deerAttention(id,elapsed),r=sample(12,attention,{off:1,motion:{state:state==='bolt'?'bound':'stand',distance:1.3}});return {state,elapsed,attention,eyePixels:r.eyePixels,eyeEnergy:r.eyeEnergy,ambient:0,ev:1,range:12,sim:[r.p.w,r.p.h],realBeam:true};}
 // One displayed hazard pixel against the exact hazard-removed frame, using the game's contrast cutoffs.
 function pairedPixel(f){const lin=b=>{const x=b/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;},L=(px,q)=>.2126*lin(px[q])+.7152*lin(px[q+1])+.0722*lin(px[q+2]);
  for(let y=0;y<f.mh;y++)for(let x=0;x<f.mw;x++)if(f.mask[y*f.mw+x]&(1<<(f.id-1))){const xx=Math.min(f.w-1,Math.floor((x+.5)*f.w/f.mw)),yy=Math.min(f.h-1,Math.floor((y+.5)*f.h/f.mh)),q=((f.h-1-yy)*f.w+xx)*4,l=L(f.rgba,q),bg=L(f.background,q),v=RF.DriveGame.VISIBILITY;if(l>=v.luma&&l-bg>=v.delta&&(l-bg)/Math.max(.002,bg)>=v.contrast)return {x:xx,y:yy,L:l,background:bg};}return null;
 }
 async function detector(port,seed){await ready(port);const A=RF.DriveAnim,G=RF.DriveGame,V=a().V,original=V.p,results=[];
 try{for(const behaviour of [false,true]){
  const p={...original,detailedModels:true,deerBehaviour:behaviour,src:A.source('road',3.5,false,{people:false,animals:false,posts:false,signs:false,veg:false,rpm:false},{wild:true,tiles:true,seed,oncoming:false,streetLamps:'off',speed:75})};V.p=p;
  let lastWorld;const g=G.create({seed,speed:75});g.t=g.next;g.x=g.t*75/3.6;const h=G.spawn(g,3.5,p);if(!h)throw Error(g.reason);g.next=1e9;h.resolved=true;
  let firstBody=null,firstPixel=null;const samples=[];
  while(h.s0-g.x>=10){G.step(g,.1,3.5,p);const world=A.tileWorld(p,g.x,g.t);world.objects=[];A._.gameObjects(g,world,3.5);lastWorld=world;const r=draw(world),ps=G.pose(g,h,g.t),bg=draw({...world,objects:[]}),common={rgba:r.rgba,background:bg.rgba,w:V.gl.cw,h:V.gl.ch,mw:p.w,mh:p.h,cssW:1600,cssH:900,id:h.id},body=G.firstLit({...common,mask:r.masks.body}),pixel=pairedPixel({...common,mask:r.masks.mask}),range=ps.s-g.x;
   if(body&&!firstBody)firstBody={range,t:g.t,pixel:body,state:ps.attention?.state||'legacy'};if(pixel&&!firstPixel)firstPixel={range,t:g.t,pixel,state:ps.attention?.state||'legacy'};
   samples.push({range,off:ps.off,state:ps.attention?.state||'legacy',body:!!body,pixel:!!pixel});if(firstBody&&firstPixel)break;
  }
  draw(lastWorld);results.push({behaviour,firstBody,firstPixel,endRange:samples.at(-1)?.range,spawn:{range:h.s0-h.born*75/3.6,off:h.off0,kind:h.kind},profile:RF.Drive.Models.deerProfile(seed+':'+h.id),samples});
 }}finally{V.p=original;}return {seed,speed:75,realBeam:true,ev:1,ambient:0,stepSeconds:.1,collisionsDisabled:true,trafficAndScenery:false,method:'same seeded spawn, real tile route, actual pose/game masks, paired canvas; visible six-body-pixel rule and paired first-pixel cue both reported',results};
 }
 window.DAPage={ready,draw,sample,regression,shot,detector};
})();
