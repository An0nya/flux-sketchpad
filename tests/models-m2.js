// Shared gait geometry: invariants independent of the renderer and UI.
function run(RF,ok){
 const M=RF.Drive.Models;
 for(const kind of ['person','deer'])for(const state of kind==='person'?['walk']:['walk','trot','bound']){
  const stride=M.GAITS[state].stride;
  for(let step=0;step<16;step++)for(const yaw of [0,.6,1.57,3.14]){
   const m=M.build(kind,{motion:{state,distance:stride*step/16},yaw,ptype:'hivis'});
   ok('M2 finite bounded pose '+kind+'/'+state+'/'+step+'/'+yaw,m.nodeCount<=M.MAX_NODES&&Array.from(m.nodes).every(Number.isFinite)&&m.feet.every(f=>f.p.every(Number.isFinite)&&f.p[2]>=.044));
  }
  const duty=M.GAITS[state].duty,d0=.1*stride,d1=.2*stride,f0=M.foot(state,d0/stride,0),f1=M.foot(state,d1/stride,0);
  ok('M2 planted stance cancels ground travel '+kind+'/'+state,duty>.2&&f0.stance&&f1.stance&&Math.abs((f1.x+d1)-(f0.x+d0))<1e-12);
 }
 ok('M2 state machine starts through walk and trot',M.locomotion('deer',.1,5,true).state==='walk'&&M.locomotion('deer',.6,5,true).state==='trot'&&M.locomotion('deer',1,5,true).state==='bound'&&M.locomotion('deer',1,5,false).state==='stand');
 const m=M.build('deer',{motion:{state:'bound',distance:1.5}});
 ok('M2 bound has airborne phase',m.feet.every(f=>!f.stance)&&m.feet.every(f=>f.z>.045));
 const tree=M.tree({id:'test',h:9,x:12,y:3,birch:true});
 ok('M2 analytic trees use exact spheres and cylinders only',tree.length>=13&&tree.every(o=>o.k==='cyl'||o.k==='ell'&&o.rx===o.ry&&o.ry===o.rz)&&tree[0].mat==='trunk-birch');
 const forward=M.build('deer',{face:1,motion:{state:'trot',distance:.6}}),reverse=M.build('deer',{face:-1,motion:{state:'trot',distance:.6}});
 ok('M2 mirrored deer preserves anatomical fore/hind placement',forward.feet.every((f,i)=>Math.abs(f.p[0]-reverse.feet[i].p[0])<1e-12&&Math.abs(f.p[1]+reverse.feet[i].p[1])<1e-12&&f.p[2]===reverse.feet[i].p[2]));
 const branch={k:'cyl',x:0,y:0,z0:-1,z1:1,r:.2,axis:[Math.SQRT1_2,0,Math.SQRT1_2]};
 const side=M.cylinder(branch,0,-2,0,0,1,0,10),cap=M.cylinder(branch,2,0,2,-Math.SQRT1_2,0,-Math.SQRT1_2,10),miss=M.cylinder(branch,0,-2,2,0,1,0,10);
 ok('M2 exact angled cylinder side, cap and miss',Math.abs(side.t-1.8)<1e-12&&Math.abs(side.n[1]+1)<1e-12&&Math.abs(cap.t-(Math.sqrt(8)-1))<1e-12&&!Number.isFinite(miss.t));
 ok('M2 stable variants survive reordering',M.stableId('prop:17')===['prop:2','prop:17'].map(M.stableId)[1]);
 const K=RF.Drive.kit({Lw:3.5,rand:()=>.5});K.deer(12,0,{motion:{state:'trot',distance:.8}});K.person(15,2,'hivis',{motion:{state:'walk',distance:.8}});
 const obs=M.actors(K.O,true);ok('M2 named gait metadata reaches shared actors',obs.filter(o=>o.k==='sdf').map(o=>o.state).join(',')==='trot,walk');
 ok('M2 eyeshine and hi-vis preserved',obs.filter(o=>o.mat==='eyeshine').length===2&&obs.some(o=>o.ptype==='hivis'));
}
module.exports={run};
if(require.main===module){let fails=0;run(require('./load.js').load(),(n,c)=>{if(!c||!n.startsWith('M2 finite'))console.log((c?'[PASS] ':'[FAIL] ')+n);if(!c)fails++;});console.log(fails?fails+' FAILED':'all M2 Node checks passed');process.exitCode=fails?1:0;}
