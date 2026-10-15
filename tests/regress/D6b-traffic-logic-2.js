// Builder: syntax-check only. Tester: node tests/regress/D6b-traffic-logic-2.js 8750 [--shots /tmp/D6b-shots]
const pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'));
const args=process.argv.slice(2),port=+(args.find(a=>/^\d+$/.test(a))||8750),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null;
let fails=0;const ok=(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+(detail?' — '+JSON.stringify(detail):''));if(!cond)fails++;};
(async()=>{
 const browser=await pw.chromium.launch(process.env.D6_REAL_GPU?{channel:'chromium'}:{});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');
  await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.store&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
  const identity=await page.evaluate(p=>!!RF.UI&&!!RF.DriveAnim&&location.port===String(p),port);ok('Flux page and port '+port,identity);if(!identity)throw Error('wrong page');
  await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:150000});await page.evaluate(()=>RF.UI.setMode('D'));
  await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
  await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});
  ok('traffic logic still defaults OFF',await page.evaluate(()=>RF.UI.dvOpts.trafficLogic===false));
  const saved=await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene));
  const yellow=await page.evaluate(()=>{
   const A=RF.DriveAnim,src=A.source('road',3.5,false,{}, {seed:7,tiles:true,trafficLogic:true,speed:50,trafficDensity:1,oncoming:true,preceding:true}),tile=Array.from({length:100},(_,k)=>A.roadTile(7,k)).find(q=>q.kind==='intersection'),t=(47-tile.phase+50)%50,line=tile.s0+90.8;
   return [5,80].map(gap=>{const state={cars:[{id:'preceding:yellow',kind:'preceding',x:line-gap-2.2,v:14,route:{k:tile.k,mid:tile.s0+100,take:false}}]};let maxDec=0,commit=false;for(let i=0;i<480;i++){const before=state.cars[0].v;A.advanceTraffic(src,state,tile.s0-500,t+i*.05);maxDec=Math.max(maxDec,(before-state.cars[0].v)/.05);commit=commit||state.cars[0].commit===tile.k;}return {gap,maxDec,commit,x:state.cars[0].x,line,v:state.cars[0].v};});
  });
  ok('yellow close car clears red; distant car stops within braking bound',yellow[0].commit&&yellow[0].x>yellow[0].line&&!yellow[1].commit&&yellow[1].v<.05&&yellow.every(c=>c.maxDec<=3.5+1e-7),yellow);
  for(const side of [-1,1]){
   const result=await page.evaluate(async side=>{
    const A=RF.DriveAnim,_=A._,u=RF.UI;Object.assign(u.dvOpts,{scene:'road',tiles:true,trafficLogic:true,seed:6,speed:50,oncoming:true,preceding:true,trafficDensity:1,mt:true,glare:'off'});Object.assign(u.dvAnim,{view:'anim',playing:false});u.redrawSpec();_.V.pinSS=1;
    const src=_.V.src,tile=Array.from({length:100},(_,k)=>A.roadTile(6,k)).find(q=>q.kind==='t-junction'&&q.side===side),clock=(24-tile.phase+50)%50,own=tile.s0,route={k:tile.k,mid:tile.s0+100,start:tile.s0+97,side,take:true};
    const state={cars:[{id:'preceding:turn',kind:'preceding',x:route.start,v:0,route},{id:'oncoming:yield',kind:'oncoming',x:route.mid+30,v:50/3.6}]};
    A.advanceTraffic(src,state,own,clock);const held=side<0||!state.cars.find(c=>c.kind==='preceding').turn;
    state.cars=state.cars.filter(c=>c.kind==='preceding');let c,first;
    for(let i=1;i<=200;i++){A.advanceTraffic(src,state,own,clock+i*.05);c=state.cars.find(c=>c.kind==='preceding');if(c.turn&&!first)first={x:c.x,v:c.v};if(c.turn&&Math.abs(A.turnPose(c).off)>2.5)break;}
    const pose=A.turnPose(c),t=clock+10;Object.assign(state,{time:t,epoch:t,tick:0,dist:own,seen:new Set()});src.traffic.state=state;Object.assign(u.dvAnim,{dist:own,t});_.frame();const before=_.readHdr();await _.frameMT(own,t);const after=_.readHdr();let worst=0;for(let i=0;i<before.length;i++)worst=Math.max(worst,Math.abs(before[i]-after[i]));
    return {held,first,pose,mid:route.mid,worst,worker:!A.stats().mtFail};
   },side);
   ok((side>0?'left T yields, then follows':'right T follows')+' a moving arc in the road opening; worker HDR matches',result.held&&result.first&&Math.abs(result.first.x-result.mid)<3.1&&result.pose.x>result.first.x&&result.pose.off*side>2.5&&Math.abs(result.pose.x-result.mid)<3.7&&result.worst===0&&result.worker,result);
   if(shots){require('fs').mkdirSync(shots,{recursive:true});await page.screenshot({path:shots+(side>0?'/left-T-arc.png':'/right-T-arc.png')});}
  }
  const camera=await page.evaluate(()=>{const A=RF.DriveAnim,src=A._.V.src,t=RF.UI.dvAnim.t,c=src.traffic.state.cars.find(c=>c.kind==='preceding');src.traffic.state.cars=[{id:'preceding:queue',kind:'preceding',x:c.x-80,v:0}];let cam={x:c.x-180,v:50/3.6},gap=Infinity,maxDec=0;for(let i=0;i<100;i++){// Freeze a leader to isolate the live camera's following rule.
    src.traffic.state.time=t+i*.05;src.traffic.state.dist=cam.x;src.traffic.state.epoch=t+i*.05;src.traffic.state.tick=0;
    const n=A.cameraStep(src,cam,.05,t+i*.05);gap=Math.min(gap,src.traffic.state.cars[0].x-n.x-4.4);maxDec=Math.max(maxDec,(cam.v-n.v)/.05);cam=n;
   }return {gap,maxDec,v:cam.v};});
  ok('camera follows a queue with bounded braking',camera.gap>=2&&camera.maxDec<=3.5+1e-7&&camera.v<50/3.6,camera);
  ok('saved optical scene unchanged',saved===await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene)));
  ok('no page errors',errors.length===0,errors);
 }finally{await browser.close();}
 console.log(fails?fails+' FAILED':'all D6b traffic logic page checks passed');process.exitCode=fails?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
