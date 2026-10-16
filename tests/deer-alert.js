// Behaviour invariants and optical samples; geometry/brightness are inspected separately in the page fixture.
function run(RF,ok){
 const D=RF.Drive,M=D.Models,G=RF.DriveGame,A=RF.DriveAnim;
 ok('DA defaults follow detail; explicit toggle also supports primitives',!M.deerEnabled({detailedModels:false})&&M.deerEnabled({detailedModels:true})&&!M.deerEnabled({detailedModels:true,deerBehaviour:false})&&M.deerEnabled({detailedModels:false,deerBehaviour:true}));
 const fixed=A.source('road',3.5,false,{animals:true,people:false,veg:false},{}),primitives=A.place(fixed,0,null,()=>-1,null,true),oldPrimitives=A.place(fixed,0,null,()=>-1,null,false);
 ok('DA fixed primitive deer graze when explicitly enabled; old scene reachable',primitives.some(o=>o.detail?.attention?.state==='grazing')&&!primitives.some(o=>o.mat==='eyeshine')&&oldPrimitives.some(o=>o.mat==='eyeshine'));
 const ids=Array.from({length:200},(_,i)=>'DA:'+i),normal=ids.find(id=>!M.deerProfile(id).never&&!M.deerProfile(id).early),p=M.deerProfile(normal);
 ok('DA seeded triggers and turn durations stay within tuning',ids.every(id=>{const p=M.deerProfile(id);return p.trigger>=60&&p.trigger<=200&&p.turn>=.5&&p.turn<=1&&JSON.stringify(p)===JSON.stringify(M.deerProfile(id));}));
 ok('DA variety includes head-down and early bolt deer',ids.some(id=>M.deerProfile(id).never)&&ids.some(id=>M.deerProfile(id).early));
 ok('DA grazing, turn, freeze, bolt progression',[-1,p.turn/2,p.turn+.01,p.turn+p.freeze+.01].map(t=>M.deerAttention(normal,t).state).join(',')==='grazing,turning,freeze,bolt');
 const never=ids.find(id=>M.deerProfile(id).never);ok('DA nonlooking deer keep their heads down through bolt',M.deerAttention(never,20).up===0);
 for(const face of [-1,1])for(const t of [-1,.2,p.turn,p.turn+p.freeze+.2])for(const yaw of [0,.7,2.4]){
  const attention=M.deerAttention(normal,t),K=D.kit({Lw:3.5,rand:()=>.5});K.deer(18,1,{face,attention});K.O.forEach(o=>{o.gameHazard=1;if(o.detail)o.detail.yaw=yaw;});const obs=M.actors(K.O,true),body=obs[0],eyes=obs.filter(o=>o.mat==='eyeshine');
  ok('DA finite bounded articulated pose '+face+'/'+t+'/'+yaw,body.nodes.every(Number.isFinite)&&body.nodeCount<=M.MAX_NODES&&eyes.every(e=>e.r===.0065&&e.eyeFalloff===8&&e.gameHazard===1));
  if(t<0)ok('DA grazing removes eye discs',eyes.length===0);
 }
 const vm=require('vm'),execFileSync=require('child_process').execFileSync,base={RF:{Drive:{...D}}};vm.createContext(base);for(const f of ['drive-models','drive-scenes'])vm.runInContext(execFileSync('git',['show','68bc063:js/'+f+'.js'],{encoding:'utf8'}),base);
 const B=base.RF.Drive;let identical=true;
 for(const face of [-1,1])for(const yaw of [0,.7,2.4])for(const state of ['stand','walk','trot','bound']){const opt={face,yaw,motion:{state,distance:1.3}},a=M.build('deer',opt),b=B.Models.build('deer',opt);if(JSON.stringify(Array.from(a.nodes))!==JSON.stringify(Array.from(b.nodes))||JSON.stringify(a.eyes)!==JSON.stringify(b.eyes))identical=false;}
 ok('DA behaviour OFF preserves base68bc063 detailed deer nodes and eyes',identical);
 const legacyK=D.kit({Lw:3.5,rand:()=>.5}),baseK=B.kit({Lw:3.5,rand:()=>.5});legacyK.deer(12,1);baseK.deer(12,1);const geometry=list=>list.map(o=>['k','x','y','z','rx','ry','rz','r','nx','ny','nz','z0','z1','mat'].map(k=>o[k]));ok('DA primitive default preserves base68bc063 geometry',JSON.stringify(geometry(legacyK.O))===JSON.stringify(geometry(baseK.O)));
 const low=M.build('deer',{attention:M.deerAttention(normal,-1)}),high=M.build('deer',{attention:M.deerAttention(normal,p.turn)});
 ok('DA raised head lifts eye centres',!low.eyes.length&&high.eyes.length===2&&high.eyes.every(e=>e[2]>1.4));
 const K=D.kit({Lw:3.5,rand:()=>.5});K.deer(18,1);const legacy=M.actors(K.O,true).filter(o=>o.mat==='eyeshine');ok('DA legacy eyes stay reachable at original radius',legacy.length===2&&legacy.every(o=>o.r===.013&&!o.eyeFalloff));
 const g=G.create({seed:7,speed:75}),h={id:1,kind:'deer',s0:240,off0:4,ds:0,doff:-1,spd:4,len:4.15,born:0,side:1,delay:.3,resolved:false};g.next=1000;g.hazards=[h];
 G.step(g,.01,3.5,{detailedModels:true,deerBehaviour:true});ok('DA game onset remains grazing outside trigger',G.pose(g,h,g.t).attention.state==='grazing');
 g.x=h.s0-M.deerProfile('7:1').trigger+.1;G.step(g,.01,3.5,{detailedModels:true,deerBehaviour:true});const onset=h.alertAt;
 h.resolved=true;g.v=0;g.brake=true;G.step(g,.5,3.5,{detailedModels:true,deerBehaviour:true});ok('DA braking keeps alert clock and head progress',h.alertAt===onset&&G.pose(g,h,g.t).attention.up>0);
 g.deerBehaviour=false;ok('DA game off recovers original pose',JSON.stringify(G.pose(g,h,g.t))===JSON.stringify(A.actorPose(h,g.t)));
 const recipe=require('./drive-polish.js').recipe(RF,'forest',{wet:false},128),opts={wild:false,seed:7,tiles:false},flags={people:false,animals:true,veg:false};recipe.detailedModels=true;recipe.deerBehaviour=true;recipe.src=A.source('forest',3.5,false,flags,opts);
 const clocks=new Map();for(const ob of recipe.src.objects)if(ob.detailPart==='deer'&&ob.detail)clocks.set('@0:static:'+ob.modelId,0);const tau=id=>clocks.has(id)?1-clocks.get(id):id[0]==='@'?-1:0;
 const placed=A.placedObjects(recipe,0,1,tau),expected=new Float32Array(4*recipe.w*recipe.h);A.objects(recipe,0,expected,1,null,null,placed,1);
 const worker=A.tracer();worker.cfg({id:1,p:{...recipe,src:undefined},src:['forest',3.5,false,flags,opts]});const job=worker.job({seq:1,dist:0,t:1,ss:1,act:Array.from(clocks),c:0,K:1,wid:0}),packed=new Float32Array(job.buf),rebuilt=new Float32Array(expected.length);let offset=0;
 for(const ty of job.trows){const lo=ty*16*recipe.w*4,hi=Math.min(recipe.h,(ty+1)*16)*recipe.w*4;rebuilt.set(packed.subarray(offset,offset+hi-lo),lo);offset+=hi-lo;}
 ok('DA transmitted alert clocks give identical worker/main pixels',placed.some(o=>o.attention&&o.attention.elapsed===1)&&expected.every((v,i)=>v===rebuilt[i]));
 // Actual rendered linear energy from one unobscured eye. Same beam and radius; only eye normal changes.
 const lut=D.lutFrom(()=>1000),energy=(angle,eyeFalloff=8)=>{const n=[-Math.cos(angle),Math.sin(angle)],ob={k:'disc',x:12,y:0,z:1.1,r:.0065,nx:n[0],ny:n[1],nz:0,eyeFalloff,sub:true,mat:'eyeshine'};const r=D.render({w:160,h:90,hfov:60,eye:[0,0,1.1],lamps:[[0,0,.65]],lut,conv:1,lane:3.5,look:{ambient:0},ss:1,layer:'objects',scene:{objects:[ob],markings:[]}});return r.rgb.reduce((a,b)=>a+b,0);};
 const front=energy(0),oblique=energy(Math.PI/3),back=energy(Math.PI);ok('DA raw eye return falls with lamp incidence and vanishes behind',front>0&&oblique>0&&oblique<front*.03&&back===0,JSON.stringify({front,oblique,back}));
}
module.exports={run};
if(require.main===module){let fails=0;run(require('./load.js').load(),(n,c,d)=>{if(!c||!n.startsWith('DA finite'))console.log((c?'[PASS] ':'[FAIL] ')+n+(d?' '+d:''));if(!c)fails++;});console.log(fails?fails+' FAILED':'all DA Node checks passed');process.exitCode=fails?1:0;}
