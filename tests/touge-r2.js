// TR: actual production integrators, exact rendered curvature sections, and intervention controls.
const { load } = require('./load.js');
function source(A, logic=false) { return A.source('road',3.5,false,{}, {mountainPass:true,seed:7,speed:80,trafficLogic:logic,trafficDensity:1}); }
function trace(RF,kind,logic=false,A=RF.DriveAnim) {
  const src=source(A,logic), dir=kind==='oncoming'?-1:1, dt=.05;
  let car={id:kind+':trace',kind:kind==='camera'?'preceding':kind,x:dir<0?5000:0,v:kind==='camera'?80/3.6:A.TRAFFIC_SPEED[kind]}, t=0;
  // Seeking/spawning must start within the local brake-ahead envelope.
  if(A.curveEnvelope) car.v=Math.min(car.v,A.approachSpeed(src,car));
  const samples=[[car.x,car.v]], state={cars:[car]};
  while(dir>0?car.x<5000:car.x>0) {
    if(kind==='camera') car=A.cameraStep(src,car,dt,t);
    else {state.cars=[car];A.advanceTraffic(src,state,car.x-1,t);car=state.cars[0];}
    if(!car || t>2000)throw Error('trace did not finish: '+kind);
    t+=dt;samples.push([car.x,car.v]);
  }
  return samples;
}
function metrics(RF,samples,kind) {
  const off=kind==='oncoming'?3.5:0, A=RF.DriveAnim, src=source(A);
  let lateral=0,decel=0,variation=0;
  for(let i=1;i<samples.length;i++) {
    const [x,v]=samples[i],prev=samples[i-1];
    lateral=Math.max(lateral,v*v*Math.abs(A.curvatureAt(src,x,off)));
    decel=Math.max(decel,(prev[1]-v)/.05);variation+=Math.abs(v-prev[1]);
  }
  // Three tightest distinct stations in 5 km (the recipe repeats; seed affects traffic, not road geometry).
  const hairpins=[700,2300,3900].map(s=>({station:s,kmh:[-80,-50,0,50,80].map(d=>{
    const q=samples.reduce((a,b)=>Math.abs(b[0]-s-d)<Math.abs(a[0]-s-d)?b:a);return +(q[1]*3.6).toFixed(2);
  })}));
  return {lateral:+lateral.toFixed(4),decel:+decel.toFixed(4),rollercoaster:+(variation/(Math.abs(samples.at(-1)[0]-samples[0][0])/1000)).toFixed(4),hairpins};
}
function run(RF,ok) {
  const A=RF.DriveAnim,D=RF.Drive,src=source(A);
  const {flatHairpinRoute}=require('./touge-r2-fixtures.js');
  const parts=r=>r.tiles.reduce((n,t)=>n+A.curveSections(t).length,0);
  let fixtureFits=true,nearbyUnchanged=true,maxFlatParts=0,maxMountainParts=0,maxFixtureParts=0;
  for(let k=0;k<8;k++)for(const u of [0,49.5,50,149.5,150,199.5]){
    const dist=k*A.TILE_LEN+u,mountain=RF.Touge.route(dist,3.5,false),flat=flatHairpinRoute(RF,dist);
    maxFlatParts=Math.max(maxFlatParts,parts(A.tileRoute(7,dist)));
    maxMountainParts=Math.max(maxMountainParts,parts(mountain));
    maxFixtureParts=Math.max(maxFixtureParts,parts(flat));fixtureFits&&=parts(flat)<=16;
    for(let s=-50;s<=350;s+=10)for(const off of [0,1,3.5]){
      const a=mountain.at(s,off),b=flat.at(s,off);
      nearbyUnchanged&&=a.p.every((v,i)=>Math.abs(v-b.p[i])<1e-9)&&a.t.every((v,i)=>Math.abs(v-b.t[i])<1e-9);
    }
  }
  console.log('  route fixture '+JSON.stringify({originalAt655:parts(RF.Touge.route(655,3.5,false)),fixedAt655:parts(flatHairpinRoute(RF,655)),maxFlatParts,maxMountainParts,maxFixtureParts}));
  ok('TR flat parity fixture fits 16 slots at all recipe phases and section edges',fixtureFits&&maxFlatParts<=12);
  ok('TR flat parity fixture preserves nearby mountain hairpin positions and tangents',nearbyUnchanged);
  ok('TR POSITIVE CONTROL: original flat-mountain fixture exceeds GPU route slots',parts(RF.Touge.route(655,3.5,false))>16);
  let matches=true;for(let x=-200;x<5200;x+=.5){const r=RF.Touge.route(x,3.5,false),a=r.at(0).t,b=r.at(.0001).t;const c=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1])/.0001;matches&&=Math.abs(c-RF.Touge.curvature(x))<1e-7;}
  ok('TR curvature matches the raw drawn route sections (including boundaries)',matches);
  for(const logic of [false,true])for(const kind of ['camera','preceding','oncoming']) {
    const m=metrics(RF,trace(RF,kind,logic),kind);console.log('  '+JSON.stringify({logic,kind,...m}));
    ok(`TR ${kind}, logic ${logic}: 5 km lateral <=3.3, decel <=1.6`,m.lateral<=3.3&&m.decel<=1.6);
  }
  // Real seeded traffic stream, not just isolated integrators. Check every live car each tick.
  const stream=A.source('road',3.5,false,{}, {mountainPass:true,seed:7,speed:80,oncoming:true,preceding:true,trafficLogic:true});
  let camera={x:0,v:80/3.6},t=0,max=0,counts={oncoming:0,preceding:0};
  while(camera.x<5000){camera=A.cameraStep(stream,camera,.05,t);t+=.05;for(const c of stream.traffic.state.cars){max=Math.max(max,c.v*c.v*Math.abs(A.curvatureAt(stream,c.x,c.kind==='oncoming'?3.5:0)));counts[c.kind]++;}}
  ok('TR seeded 5 km stream: both traffic kinds stay <=3.3 everywhere',max<=3.3&&counts.oncoming>100&&counts.preceding>100);console.log('  stream '+JSON.stringify({max,counts}));
  const coarse=3/Math.abs(RF.Touge.tile(0,3).curvature)*Math.abs(A.curvatureAt(src,700,3.5));
  ok('TR POSITIVE CONTROL: tile centerline cap exceeds lateral bound on inside lane',coarse>3.3);
  const signCheck=()=>[700,1300].every(x=>A.afsTarget(src,x,10)*RF.Touge.curvature(x)>0);
  ok('TR AFS sign follows left and right curves',signCheck());
  const real=A.afsTarget;A.afsTarget=()=>0;try{ok('TR POSITIVE CONTROL: forced zero swivel fails sign check',!signCheck());}finally{A.afsTarget=real;}
  let st=null,bounded=true,rate=true,prev=0;
  for(let i=0;i<1000;i++){st=A.lightingStep(st,src,i<500?700:1300,10,.02,true,true);bounded&&=Math.abs(st.yaw)<=Math.PI/12+1e-12;rate&&=Math.abs(st.yaw-prev)<=A.AFS_RETURN*.02+1e-12;prev=st.yaw;}
  ok('TR AFS clamp <=15 degrees and slew <=30 degrees/s, including reversal',bounded&&rate);
  // Bend exit: swivel must come back with the wheels, not linger into the bend (owner report: beam still pointed into a hairpin after exiting).
  let xe=700;while(Math.abs(A.curvatureAt(src,xe))>1e-9&&xe<1300)xe+=.5;
  let ex={yaw:A.AFS_MAX*Math.sign(A.curvatureAt(src,xe-1)),left:0,right:0};for(let i=0;i<28;i++)ex=A.lightingStep(ex,src,xe,10,.02,true,false);
  ok('TR AFS beam is back on centre 0.56 s after the bend ends (15 deg at 30 deg/s)',xe<1300&&ex.yaw===0);console.log('  exit x',xe,'yaw',ex.yaw);
  ok('TR POSITIVE CONTROL: at the old 12 deg/s the same exit is still off centre',Math.abs(A.AFS_MAX-A.AFS_RATE*.56)>1e-6&&A.AFS_MAX-A.AFS_RATE*.56>0);
  for(let i=0;i<200;i++)st=A.lightingStep(st,src,300,10,.02,true,true);
  ok('TR AFS settles to zero on straights',st.yaw===0&&st.left===0&&st.right===0);
  ok('TR corner lamps select the bend side and fade out above 40 km/h',A.lightingStep(null,src,700,8,1,false,true).left===1&&A.lightingStep(null,src,1300,8,1,false,true).right===1&&A.lightingStep(null,src,700,12,1,false,true).left===0);
  // Actual oncoming lane distance per tick must match integrated v, even at curvature joins.
  let laneMotion=true;const motion=trace(RF,'oncoming');
  for(let i=1;i<motion.length;i++){const a=motion[i-1],b=motion[i],actual=A.laneDistance(src,a[0],b[0],3.5),expected=(a[1]+b[1])*.025;laneMotion&&=Math.abs(actual-expected)<1e-7;}
  ok('TR rendered oncoming lane motion matches physical speed across section joins',laneMotion);
  ok('TR static corner lamp emits only from its selected mounting side',D.ownBeamAt({lut:D.lutFrom(()=>0,{win:[-90,90,-45,45],step:1}),cornerLeft:1},10,10,-1,-.7)===0);
  const lut=D.lutFrom((h,v)=>1000+10*h+v,{win:[-70,70,-30,30],step:1}),p={lut,conv:'A',pitch:.01};
  const off=A.lightingStep({yaw:.2,left:1,right:1},src,700,10,.05,false,false);let same=true;
  const before=new Float32Array(2000),after=new Float32Array(2000);
  for(let i=0;i<2000;i++){const dx=10,dy=(i%100-50)/4,dz=-1-Math.floor(i/100)/10;before[i]=D.beamAt(lut,'A',dx,dy,dz,p.pitch);after[i]=D.ownBeamAt({...p,yaw:off.yaw,cornerLeft:off.left,cornerRight:off.right},dx,dy,dz);}
  same=Buffer.from(before.buffer).equals(Buffer.from(after.buffer));ok('TR AFS/cornering off: byte-identical lamp lookup',same);
  // Read actual renderer output too: inside-left road samples gain light when lookup swivels left.
  const low=D.lutFrom(D.Headlamp.generic,{win:[-90,90,-45,45],step:.5}),base={lut:low,conv:'A'};
  let lightOff=0,lightOn=0;for(let i=0;i<10;i++){const q=RF.Touge.route(655,3.5,false).at(20+i*2,1);lightOff+=D.ownBeamAt(base,...q.p,-.7);lightOn+=D.ownBeamAt({...base,yaw:Math.PI/12},...q.p,-.7);}
  ok('TR raw low-beam samples brighten inside hairpin with left swivel',lightOn>lightOff);console.log('  raw cd sum '+JSON.stringify({lightOff,lightOn}));
}
function baselineMetrics(RF) {
  const vm=require('vm'),cp=require('child_process'),sandbox={RF:{...RF}};
  // Explicit brief base; never compare against a moving main or the implementation under test.
  vm.runInNewContext(cp.execFileSync('git',['show','a46cb0b:js/drive-anim.js'],{encoding:'utf8'}),sandbox);
  const old=sandbox.RF.DriveAnim,rows=[];
  for(const logic of [false,true])for(const kind of ['camera','preceding','oncoming']) {
    let samples;
    if(logic||kind==='camera')samples=trace(RF,kind,logic,old);
    else {const v=old.TRAFFIC_SPEED[kind],dir=kind==='oncoming'?-1:1;samples=[];for(let t=0;t<5000/v;t+=.05)samples.push([dir<0?5000-v*t:v*t,v]);}
    const commanded=metrics(RF,samples,kind);
    // Old traffic advances centerline station directly; recover the actual offset-lane speed.
    if(kind==='oncoming')samples=samples.map(([x,v])=>[x,v*(1-3.5*RF.Touge.curvature(x))]);
    rows.push({logic,kind,...metrics(RF,samples,kind),commandedDecel:commanded.decel,commandedRollercoaster:commanded.rollercoaster});
  }
  return rows;
}
module.exports={run,trace,metrics,baselineMetrics};
if(require.main===module&&process.argv.includes('--baseline')){for(const row of baselineMetrics(load()))console.log(JSON.stringify(row));}
else if(require.main===module){let fails=0;run(load(),(n,c)=>{console.log((c?'[PASS] ':'[FAIL] ')+n);if(!c)fails++;});console.log(fails?fails+' FAILED':'all TR Node checks passed');process.exitCode=fails?1:0;}
