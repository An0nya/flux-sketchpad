// D6b behaviour checks used by regress-node and the standalone Node runner. No DOM / renderer required.
(function (root) {
  function run(RF, ok) {
    const A=RF.DriveAnim,J=JSON.stringify,flags={posts:false,signs:false,people:false,animals:false,veg:false,rpm:false};
    const make=(seed=7,speed=50,density=3)=>A.source('road',3.5,false,flags,{seed,speed,trafficDensity:density,trafficLogic:true,tiles:true,oncoming:true,preceding:true});
    const corners=(c)=>{const p=c.turn?A.turnPose(c):{x:c.x,off:0,yaw:0},y=p.off+(c.kind==='oncoming'?3.5:0),co=Math.cos(p.yaw),si=Math.sin(p.yaw);return [[-2.2,-.9],[2.2,-.9],[2.2,.9],[-2.2,.9]].map(([a,b])=>[p.x+a*co-b*si,y+a*si+b*co]);};
    const overlap=(p,q)=>{for(const poly of [p,q])for(let i=0;i<4;i++){const a=poly[i],b=poly[(i+1)%4],nx=a[1]-b[1],ny=b[0]-a[0],u=p.map(v=>v[0]*nx+v[1]*ny),v=q.map(v=>v[0]*nx+v[1]*ny);if(Math.max(...u)<=Math.min(...v)+1e-7||Math.max(...v)<=Math.min(...u)+1e-7)return false;}return true;};
    let maxDec=0,decAt=null,overlaps=0,overlapAt=null,starts=0,badStart=0,sideTurns=0,maxTurnSpeed=0,forward=0,minGap=Infinity,commits=0,stops=0,retired=0;
    const samples=[];
    for(const seed of [3,6,11,14])for(const speed of [20,50,80,130])for(const density of [1,3]) {
      const src=make(seed,speed,density);let prev=new Map();
      for(let i=0;i<=6000;i++) {
        const t=i*.05,own=t*speed/3.6;A.trafficCars(src,own,t);const all=src.traffic.state.cars;
        for(const c of all){const p=prev.get(c.id);if(p){const dec=(p.v-c.v)/.05;if(dec>maxDec){maxDec=dec;decAt={seed,speed,density,t,id:c.id,from:p.v,to:c.v,x:c.x,signal:A.trafficSignal(src,c,t)};}}
          if(c.turn&&(!p||!p.turn)){starts++;const q=c.turn;badStart+=Math.abs(q.x-(c.route.mid-3))>1e-7||Math.abs(q.x-c.route.mid)>3.7||Math.abs(A.turnPose(c).yaw)>.15?1:0;maxTurnSpeed=Math.max(maxTurnSpeed,c.v);if(q.side>0)sideTurns++;if(samples.length<4)samples.push({seed,speed,t,id:c.id,x:c.x,turn:{...q},v:c.v});}
          if(c.turn&&p&&p.turn&&c.x>p.x+1e-5)forward++;
          if(c.commit!==undefined&&p&&p.commit===undefined)commits++;
          const sig=!c.turn&&A.trafficSignal(src,c,t);if(sig&&sig.lit!=='green'&&c.v<.05&&sig.gap<2.1)stops++;
        }
        for(const [id,p] of prev)if(p.turn&&!all.some(c=>c.id===id)&&Math.abs(A.turnPose(p).off)>34)retired++;
        for(const kind of ['preceding','oncoming']){const lane=all.filter(c=>c.kind===kind&&!c.turn).sort((a,b)=>a.x-b.x);for(let j=1;j<lane.length;j++)minGap=Math.min(minGap,lane[j].x-lane[j-1].x-4.4);}
        const sorted=all.slice().sort((a,b)=>a.x-b.x);
        for(let a=0;a<sorted.length;a++)for(let b=a+1;b<sorted.length&&sorted[b].x-sorted[a].x<6;b++){
          const c=sorted[a],d=sorted[b];if(c.kind===d.kind&&!c.turn&&!d.turn)minGap=Math.min(minGap,d.x-c.x-4.4);
          if(overlap(corners(c),corners(d))){overlaps++;if(!overlapAt)overlapAt=JSON.parse(J({seed,speed,density,t,a:c,b:d}));}
        }
        prev=new Map(all.map(c=>[c.id,{...c,turn:c.turn&&{...c.turn}}]));
      }
    }
    ok('D6b max measured braking stays within 3.5 m/s², including yellow, followers and turns',maxDec<=A.TRAFFIC_BRAKE+1e-7,J({maxDec,decAt}));
    ok('D6b 32 seeded 300-second runs: no body overlaps, including turns vs oncoming',overlaps===0,J({overlaps,overlapAt,minGap}));
    ok('D6b departures start in junction box, move forward through arcs at turning speed, then exit',starts>30&&sideTurns>0&&badStart===0&&maxTurnSpeed<4.6&&forward>starts&&retired>0,J({starts,sideTurns,badStart,maxTurnSpeed,forward,retired,samples}));
    ok('D6b streams exercise both committed crossings and stopped red queues',commits>0&&stops>0,J({commits,stops}));
    let yellowSafe=true;const yellowRaw=[];
    for(const kind of ['preceding','oncoming'])for(const distance of [5,80]){
      const src=make(),tile=Array.from({length:100},(_,k)=>A.roadTile(7,k)).find(q=>q.kind==='intersection'),dir=kind==='preceding'?1:-1,line=tile.s0+100-dir*9.2;
      const clock=(47-tile.phase+50)%50,car={id:kind+':yellow',kind,x:line-dir*(distance+2.2),v:14,route:kind==='preceding'?{k:tile.k,mid:tile.s0+100,take:false}:undefined},state={cars:[car]};
      let maxDec=0,committed=false,crossed=false;
      for(let i=0;i<480;i++){const p=state.cars[0];A.advanceTraffic(src,state,tile.s0-500,clock+i*.05);const c=state.cars[0];if(!c){yellowSafe=false;break;}maxDec=Math.max(maxDec,(p.v-c.v)/.05);committed=committed||c.commit===tile.k;crossed=crossed||dir*(c.x-line)+2.2>0;}
      const c=state.cars[0],stopped=c&&c.v<.05&&Math.abs(dir*(line-c.x)-4.2)<.01;
      yellowSafe=yellowSafe&&maxDec<=3.5+1e-7&&(distance===5?committed&&crossed:!committed&&!crossed&&stopped);yellowRaw.push({kind,distance,maxDec,committed,crossed,stopped});
    }
    ok('D6b yellow dilemma zone commits close cars through red; distant cars stop comfortably in both directions',yellowSafe,J(yellowRaw));
    let selected=0,total=0,stable=true;const choices=[];
    for(let seed=1;seed<=10;seed++)for(let k=0;k<100;k++){const tile=A.roadTile(seed,k);if(!['intersection','t-junction'].includes(tile.kind))continue;for(let id=0;id<20;id++){
      const c={id:'preceding:'+id,kind:'preceding',x:tile.s0,v:10},src=make(seed),q=A.junctionPlan(src,c);total++;selected+=q.take?1:0;
      for(const speed of [20,80,130]){const other=A.junctionPlan(make(seed,speed),{...c,route:undefined,v:speed/3.6});stable=stable&&other.take===q.take;}
      if(choices.length<8)choices.push({seed,k,id,take:q.take});
    }}
    ok('D6b seeded per-junction turn choices stay 20–30%, independent of speed',stable&&selected/total>=.2&&selected/total<=.3,J({selected,total,rate:selected/total,choices}));
    const src=make(6),tile=Array.from({length:100},(_,k)=>A.roadTile(6,k)).find(q=>q.kind==='t-junction'&&q.side>0),route={k:tile.k,mid:tile.s0+100,start:tile.s0+97,side:1,take:true};
    const waiting={id:'preceding:yield',kind:'preceding',x:route.start,v:0,route},opponent={id:'oncoming:gap',kind:'oncoming',x:route.mid+60,v:50/3.6};
    const green=(24-tile.phase+50)%50,state={cars:[waiting,opponent]};A.advanceTraffic(src,state,tile.s0-200,green);
    const held=state.cars.find(c=>c.id===waiting.id),yielded=!held.turn&&Math.abs(held.x-route.start)<1e-7;
    state.cars=state.cars.filter(c=>c.kind==='preceding');A.advanceTraffic(src,state,tile.s0-200,green+.05);
    ok('D6b left T holds at the turn entry for oncoming traffic, releases into a clear gap',yielded&&!!state.cars[0].turn,J({held,released:state.cars[0]}));
    // Both travel directions must reach a lower limit at its boundary, with braking before entry.
    let limits=true;const limitsRaw=[];
    for(const dir of [1,-1]){
      let edge;for(let k=2;k<100;k++){const x=k*200;if(A.speedLimit(src,x-dir*.01)>A.speedLimit(src,x+dir*.01)){edge=x;break;}}
      const limit=A.speedLimit(src,edge+dir*.01);let c={id:'limit',kind:dir>0?'preceding':'oncoming',x:edge-dir*150,v:80/3.6},before=false,max=0;
      for(let i=0;i<1000&&dir*(edge-c.x)>0;i++){
        const target=A.approachSpeed(src,c),n=A.idmStep({...c,x:dir*c.x},null,.05,target,undefined,{maxBrake:A.TRAFFIC_BRAKE,maxAccel:A.approachAcceleration(src,c)});n.x*=dir;before=before||n.v<c.v-.0001;max=Math.max(max,(c.v-n.v)/.05);c=n;
      }
      limits=limits&&before&&c.v<=limit+.6&&max<=3.5+1e-7;limitsRaw.push({dir,edge,limit,v:c.v,before,max});
    }
    ok('D6b lower tile limits are anticipated in both directions',limits,J(limitsRaw));
    // Actual camera-following integration: a red queue stays on the road while the camera waits behind it.
    const camSrc=make(7,50),junction=Array.from({length:100},(_,k)=>A.roadTile(7,k)).find(q=>q.kind==='intersection'),clock=(50-junction.phase)%50,line=junction.s0+90.8;
    let camera={x:line-140,v:50/3.6},cameraGap=Infinity,cameraDec=0,queueSeen=false;
    camSrc.traffic.state={time:clock,epoch:clock,tick:0,dist:camera.x,seen:new Set(),cars:[{id:'preceding:queue',kind:'preceding',x:line-4.2,v:0,route:{k:junction.k,mid:junction.s0+100,take:false}}]};
    for(let i=0;i<440;i++){const next=A.cameraStep(camSrc,camera,.05,clock+i*.05),lead=camSrc.traffic.state.cars.find(c=>c.id==='preceding:queue');if(lead){cameraGap=Math.min(cameraGap,lead.x-next.x-4.4);queueSeen=queueSeen||lead.v<.05&&!lead.turn;}cameraDec=Math.max(cameraDec,(camera.v-next.v)/.05);camera=next;}
    ok('D6b camera brakes behind a red queue without pushing cars or forcing departures',queueSeen&&cameraGap>=2-1e-7&&camera.v<.05&&cameraDec<=3.5+1e-7,J({cameraGap,cameraDec,camera}));
    let roadFit=true;const roadRaw=[];
    for(const lane of [3.3,3.5,3.6])for(const side of [-1,1]){
      let outside=0;for(let i=0;i<=200;i++){
        const c={kind:'preceding',turn:{x:-3,side,radius:side>0?5.1:3,s:i*.1}},poly=corners(c);
        for(const [x,y] of poly)if(!(y>=-lane/2-1e-7&&y<=1.5*lane+1e-7)&&!(x>=-lane-.2-1e-7&&x<=lane+.2+1e-7&&y*side>=0))outside++;
      }
      roadFit=roadFit&&outside===0;roadRaw.push({lane,side,outside});
    }
    ok('D6b entire turning bodies stay on D4 main/side-road pavement for supported lane widths',roadFit,J(roadRaw));
    let liveSafe=true;const liveRaw=[];
    for(const seed of [3,6])for(const speed of [50,130]){
      const src=make(seed,speed);let c={x:0,v:0},min=Infinity,max=0,at100=0;
      for(let i=0;i<6000;i++){const n=A.cameraStep(src,c,.05,i*.05);max=Math.max(max,(c.v-n.v)/.05);for(const d of src.traffic.state.cars)if(d.kind==='preceding'&&d.x>=n.x&&(!d.turn||Math.abs(A.turnPose(d).off)<3.2))min=Math.min(min,d.x-n.x-4.4);c=n;if(i===2000)at100=c.x;}
      liveSafe=liveSafe&&min>=2-1e-7&&max<=3.5+1e-7&&c.x>at100+100;liveRaw.push({seed,speed,min,max,at100,x:c.x});
    }
    ok('D6b live camera maintains gaps and braking bound, and continues through queued junctions',liveSafe,J(liveRaw));
    const empty=make(7,50,0),hidden=make();hidden.traffic.preceding=false;hidden.traffic.oncoming=false;
    const emptyCamera=A.cameraStep(empty,{x:0,v:0},.05,0),hiddenCamera=A.cameraStep(hidden,{x:0,v:0},.05,0);
    ok('D6b zero-density and hidden-lane cameras advance without requiring a traffic state',emptyCamera.x>0&&hiddenCamera.x>0&&Number.isFinite(emptyCamera.v),J({emptyCamera,hiddenCamera}));
    return {maxDec,overlaps,starts,selected,total};
  }
  if(typeof module!=='undefined')module.exports={run};else root.D6bTrafficChecks={run};
})(typeof globalThis!=='undefined'?globalThis:this);
if(typeof require!=='undefined'&&require.main===module){let fails=0;module.exports.run(require('./load.js').load(),(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+' — '+detail);if(!cond)fails++;});process.exitCode=fails?1:0;}
