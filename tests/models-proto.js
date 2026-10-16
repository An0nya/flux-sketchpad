// Pure model geometry and reference-render checks; actual GPU parity lives in models-proto-page.js.
function run(RF,ok){
 const D=RF.Drive,M=D.Models,crypto=require('crypto'),cp=require('child_process'),vm=require('vm');
 const K=D.kit({Lw:3.5,rand:()=>.5});K.person(10,0,'hivis',{gait:.11});K.deer(12,2,{gait:-.14});K.car(20,0);K.tree(40,8);
 ok('M1 off returns original list unchanged',M.actors(K.O,false)===K.O);
 const detailed=M.actors(K.O,true),sdfs=detailed.filter(o=>o.k==='sdf');
 ok('M1 only actors change on CPU; car/tree primitives stay',sdfs.length===2 && detailed.filter(o=>o.detailPart==='car').length===K.O.filter(o=>o.detailPart==='car').length && detailed.filter(o=>o.detailPart==='tree').length===4);
 ok('M1 eyes remain analytic retroreflectors',detailed.filter(o=>o.mat==='eyeshine').length===2 && detailed.filter(o=>o.mat==='eyeshine').every(o=>o.sub));
 for(const kind of ['person','deer','tree']) {
  const ob=M.build(kind,{gait:.1,ptype:'hivis',yaw:.4,bound:true});D.boundOf(ob);
  const a=M.trace(ob,-5,0,kind==='tree'?3:1.2,1,0,0,20);
  ok('M1 finite bounded '+kind+' hit',Number.isFinite(a.t)&&a.steps<=M.STEPS && a.n.every(Number.isFinite),a);
  let finite=true,escaped=false;
  for(let x=-2;x<=2;x+=.25)for(let y=-2;y<=2;y+=.25)for(let z=-1;z<=2;z+=.25){const d=M.distance(ob,x,y,z);finite=finite&&Number.isFinite(d);if(d<0 && Math.hypot(x,y,z)>ob.r)escaped=true;}
  ok('M1 '+kind+' field finite and inside proxy sphere',finite&&!escaped);
 }
 const p0=M.build('person',{gait:0}),p1=M.build('person',{gait:.11}),d0=M.build('deer',{gait:.14}),d1=M.build('deer',{gait:.14,bound:true});
 ok('M1 joint angles alter walk and bound geometry',!p0.nodes.every((v,i)=>v===p1.nodes[i])&&!d0.nodes.every((v,i)=>v===d1.nodes[i]));
 // Compare raw default-off reference frames with the specified main base in a separate global context.
 const ctx=vm.createContext({console,performance});ctx.globalThis=ctx;for(const f of ['core','road','drive','drive-scenes','drive-anim'])vm.runInContext(cp.execFileSync('git',['show','3425a24:js/'+f+'.js'],{encoding:'utf8'}),ctx);
 const old=ctx.RF,hash=a=>crypto.createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
 for(const scene of ['road','city','forest'])for(const wet of [false,true]) {
  const recipe=rf=>{const D=rf.Drive;return D.render({w:128,h:72,hfov:60,eye:[-2,.37,1.2],lamps:[[0,-.6,.65],[0,.6,.65]],lut:D.lutFrom((h,v)=>Math.abs(h)<20&&v<1?10000:0),ss:1,look:{wet,wetSheen:wet,ambient:.1,RL:.2},lane:3.5,scene:D.buildScene(scene,{Lw:3.5,seed:7},{people:true,animals:true,veg:true})});};
  const a=recipe(RF),b=recipe(old);ok('M1 base-off raw frame identical '+scene+'/'+wet,hash(a.rgb)===hash(b.rgb)&&hash(a.mat)===hash(b.mat));
 }
 const recipe=require('./drive-polish.js').recipe(RF,'forest',{wet:true,wetSheen:true},128);recipe.detailedModels=true;
 const opts={wild:true,seed:7,density:3,tiles:false},src=RF.DriveAnim.source('forest',3.5,false,{people:true,animals:true,veg:true},opts);recipe.src=src;
 const tracer=RF.DriveAnim.tracer();tracer.cfg({id:1,p:{...recipe,src:undefined},src:['forest',3.5,false,{people:true,animals:true,veg:true},opts]});
 const job=tracer.job({seq:1,dist:25,t:12,ss:1,act:[],c:0,K:1,wid:0});
 // Repeat both paths with identical activation clocks; worker rows are packed and must be expanded before comparing.
 const expected=new Float32Array(4*recipe.w*recipe.h);RF.DriveAnim.objects(recipe,25,expected,1,null,null,RF.DriveAnim.placedObjects(recipe,25,12),12);
 const rebuilt=new Float32Array(expected.length),packed=new Float32Array(job.buf);let offset=0;for(const ty of job.trows){const lo=ty*16*recipe.w*4,hi=Math.min(recipe.h,(ty+1)*16)*recipe.w*4;rebuilt.set(packed.subarray(offset,offset+hi-lo),lo);offset+=hi-lo;}
 ok('M1 detailed CPU worker equals main reference pixels',expected.every((v,i)=>v===rebuilt[i]));
 const fs=require('fs'),path=require('path'),manifest=require('../vendor/models/manifest.json');
 for(const [file,hash] of Object.entries(require('../vendor/three/addons/pins.json')))ok('M1 pinned r180 addon '+file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../vendor/three/addons',file))).digest('hex')===hash);
 for(const a of manifest.assets){const b=fs.readFileSync(path.join(__dirname,'../vendor/models',a.file));ok('M1 pinned CC0 asset '+a.file,b.length===a.bytes&&crypto.createHash('sha256').update(b).digest('hex')===a.sha256);}
}
module.exports={run};
if(require.main===module){let fails=0;run(require('./load.js').load(),(n,c,d)=>{console.log((c?'[PASS] ':'[FAIL] ')+n+(d?' '+JSON.stringify(d):''));if(!c)fails++;});console.log(fails?fails+' FAILED':'all M1 Node checks passed');process.exitCode=fails?1:0;}
