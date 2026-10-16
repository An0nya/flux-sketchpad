// TG: continuity, road placement, terrain line of sight and grade physics; no browser mocks.
function run(RF, ok) {
  const P=RF.Touge,A=RF.DriveAnim,D=RF.Drive,G=RF.DriveGame,near=(a,b,e=1e-5)=>Math.abs(a-b)<e;
  let continuous=true,maxGrade=0;
  for(const s of [-1600,0,80,240,400,560,880,1080,1280,1480,1600,3200]){
    const a=P.profile(s-1e-6),b=P.profile(s+1e-6);continuous&&=near(a.z,b.z)&&near(a.grade,b.grade);
  }
  for(let s=-1600;s<3200;s++)maxGrade=Math.max(maxGrade,Math.abs(P.profile(s).grade));
  ok('TG height and grade continuous across curves and repeating route',continuous && maxGrade<=.10000001);
  ok('TG true crest and sag, grades change sign',near(P.profile(160).grade,0)&&P.profile(130).grade>0&&P.profile(190).grade<0&&near(P.profile(480).grade,0)&&P.profile(450).grade<0&&P.profile(510).grade>0);
  let joins=true;
  for(let s=0;s<=1800;s+=50){const r=P.route(s,3.5),a=r.surface(-.000001,1),b=r.surface(.000001,1);joins&&=a.p.every((v,i)=>near(v,b.p[i]))&&a.t.every((v,i)=>near(v,b.t[i]));}
  ok('TG horizontal/vertical joins share position and tangent',joins);
  ok('TG recipe includes 30/40 m hairpins and 150/250 m bends', ['30L','40R','150R','250L'].every(k=>P.kinds.includes(k)));
  const bank=P.route(700,3.5),left=bank.surface(0,3),right=bank.surface(0,0);
  ok('TG bank changes cross-road height and normal',Math.abs(left.p[2]-right.p[2])>.1&&Math.abs(left.normal[1])>0);
  const pose=P.attitude(700),axes=[pose.forward,pose.left,pose.up];
  ok('TG camera/lamp axes orthonormal and banked',axes.every(a=>near(Math.hypot(...a),1))&&near(axes[0].reduce((s,v,i)=>s+v*axes[1][i],0),0)&&Math.abs(pose.roll)>.01);
  const r=P.route(125,3.5),q=r.at(40,0),ob=P.lift({k:'box',x:q.p[0],y:q.p[1],z0:0,z1:1,hx:1,hy:1},r);
  ok('TG object base uses surface API, lift is idempotent',near(ob.z0,r.surface(40).p[2])&&P.lift(ob,r)===ob);
  const flat=P.route(125,3.5,false);
  ok('TG CPU fallback surface stays flat',flat.surface(40,2).p[2]===0&&!flat.touge);
  const lut=D.lutFrom(()=>1000,{win:[-90,90,-90,90],step:1});
  const p={A:P.route(80,3.5),touge:true,lamps:[[0,0,.7]],lut,conv:'A'};
  ok('TG crest blocks actual beam sampler, sag has line of sight',P.eyeLux(p,{rel:200,off:0})===0&&P.eyeLux({...p,A:P.route(435,3.5)},{rel:40,off:0})>0);
  const up=G.stoppingDistance(75,1,false,.08),level=G.stoppingDistance(75,1,false),down=G.stoppingDistance(75,1,false,-.08);
  ok('TG downhill braking longer, uphill shorter',up<level&&down>level);
  const v=20,dt=.25,m=G.motion(v,dt,true,false,.08),a=G.G*(.8+.08)/Math.sqrt(1+.08*.08);
  ok('TG grade braking matches gravity plus tyre friction',near(m.v,v-a*dt)&&near(m.dx,v*dt-a*dt*dt/2));
  const src=A.source('road',3.5,false,{},{}),pass=A.source('road',3.5,false,{}, {mountainPass:true});
  ok('TG old source has no pass/tile state; pass explicitly selected',!src.tiles&&pass.tiles.mountain===true);
}
module.exports={run};
if(require.main===module){let fails=0;run(require('./load.js').load(),(n,c)=>{console.log((c?'[PASS] ':'[FAIL] ')+n);if(!c)fails++;});console.log(fails?fails+' FAILED':'all TG Node checks passed');process.exitCode=fails?1:0;}
