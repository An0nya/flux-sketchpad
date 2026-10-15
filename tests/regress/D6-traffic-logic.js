// Builder: syntax-check only. Tester: node tests/regress/D6-traffic-logic.js 8744 [--shots /tmp/D6-shots]
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const args=process.argv.slice(2),port=+(args.find(a=>/^\d+$/.test(a))||8744),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null;
let fails=0;const ok=(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+(detail?'  — '+detail:''));if(!cond)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const browser=await pw.chromium.launch(process.env.D6_REAL_GPU?{channel:'chromium'}:{});
  try {
    const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');
    await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.store&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
    const identity=await page.evaluate(p=>!!RF.UI&&!!RF.DriveAnim&&location.port===String(p),port);ok('Flux page and port '+port,identity);if(!identity)throw Error('wrong page');
    await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:150000});await page.evaluate(()=>RF.UI.setMode('D'));
    await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
    await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});await sleep(700);
    const saved=await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene));
    ok('traffic logic starts off for existing behaviour',await page.evaluate(()=>RF.UI.dvOpts.trafficLogic===false));
    await page.evaluate(()=>{const u=RF.UI;Object.assign(u.dvOpts,{scene:'road',tiles:true,mt:true,seed:7,trafficDensity:3,oncoming:true,preceding:true,safeGap:true,speed:50,glare:'off'});Object.assign(u.dvAnim,{view:'anim',playing:false,dist:40,t:0});u.redrawSpec();RF.DriveAnim._.V.pinSS=1;RF.DriveAnim._.frame();window.d6Before=RF.DriveAnim._.readHdr();});
    await page.click('[data-anim="traffic-logic"]');await sleep(150);
    ok('toggle enables IDM, persists, and replaces the old gap guard',await page.evaluate(()=>RF.UI.dvOpts.trafficLogic&&RF.DriveAnim._.V.src.traffic.logic&&document.querySelector('[data-anim="traffic-logic"]').getAttribute('aria-pressed')==='true'&&document.querySelector('[data-anim="gap"]').disabled&&JSON.parse(localStorage.getItem('flux/driveView')).trafficLogic));
    await page.click('[data-anim="traffic-logic"]');await sleep(150);
    const off=await page.evaluate(()=>{const _=RF.DriveAnim._;_.frame();const out=_.readHdr();let worst=0;for(let i=0;i<out.length;i++)worst=Math.max(worst,Math.abs(out[i]-window.d6Before[i]));return {worst,logic:_.V.src.traffic.logic,gapDisabled:document.querySelector('[data-anim="gap"]').disabled};});
    ok('OFF restores the exact pre-toggle HDR and the D5 gap guard',!off.logic&&!off.gapDisabled&&off.worst===0,JSON.stringify(off));
    await page.click('[data-anim="traffic-logic"]');
    const signal=await page.evaluate(async()=>{
      const u=RF.UI,A=RF.DriveAnim,_=A._;Object.assign(u.dvOpts,{tiles:true,trafficLogic:true,speed:5});u.redrawSpec();
      const src=_.V.src;src.traffic.speed=5;const tile=Array.from({length:100},(_,k)=>A.roadTile(7,k)).find(t=>t.kind==='intersection'),clock=(50-tile.phase)%50,own=tile.s0-100;
      src.traffic.state={time:clock,epoch:clock,tick:0,dist:own,seen:new Set(),cars:['preceding','oncoming'].map(kind=>{const dir=kind==='preceding'?1:-1,line=tile.s0+100+dir*(-src.lane-5.7);return {id:kind+':fixture',kind,x:line-dir*80,v:10,route:kind==='preceding'?{k:tile.k,mid:tile.s0+100,take:false}:undefined};})};
      for(let i=0;i<=440;i++)A.trafficCars(src,own+i*.05*5/3.6,clock+i*.05);
      const t=clock+22,dist=own+22*5/3.6;Object.assign(u.dvAnim,{dist,t,playing:false});_.frame();
      const stopped=src.traffic.state.cars.filter(c=>c.id.endsWith(':fixture')).map(c=>({kind:c.kind,v:c.v,signal:A.trafficSignal(src,c,t)}));
      const world=A.tileWorld(_.V.p,dist,t),heads=world.objects.filter(o=>o.tile===tile.k&&o.cls==='signal'&&o.k==='disc'&&o.emit&&o.emit[0]===12000);
      const before=_.readHdr(),worked=await _.frameMT(dist,t),after=_.readHdr();let worst=0;for(let i=0;i<before.length;i++)worst=Math.max(worst,Math.abs(before[i]-after[i]));
      window.d6Fixture={tile,clock,own};return {stopped,heads:heads.length,opposingNormals:heads.map(o=>o.nx),worst,worked,fail:A.stats().mtFail,lit:before.some((v,i)=>i%4!==3&&v>0)};
    });
    ok('both traffic directions stop at their painted red line; opposing heads agree',signal.stopped.length===2&&signal.stopped.every(c=>c.v<.05&&c.signal.lit==='red'&&c.signal.gap>=2-1e-7&&c.signal.gap<2.1)&&signal.heads===2&&signal.opposingNormals.some(n=>n>0)&&signal.opposingNormals.some(n=>n<0),JSON.stringify(signal));
    ok('worker uses the page traffic history: identical HDR including signals and stopped cars',signal.worked&&!signal.fail&&signal.lit&&signal.worst===0,JSON.stringify({worst:signal.worst,worked:signal.worked}));
    if(shots){require('fs').mkdirSync(shots,{recursive:true});await page.screenshot({path:shots+'/red-queue.png'});}
    const green=await page.evaluate(async()=>{
      const A=RF.DriveAnim,_=A._,u=RF.UI,{clock,own}=window.d6Fixture,src=_.V.src;
      for(let i=441;i<=840;i++)A.trafficCars(src,own+i*.05*5/3.6,clock+i*.05);
      const dist=own+42*5/3.6,t=clock+42;Object.assign(u.dvAnim,{dist,t});_.frame();await _.frameMT(dist,t);
      return src.traffic.state.cars.filter(c=>c.id.endsWith(':fixture')).map(c=>({kind:c.kind,v:c.v,x:c.x,line:window.d6Fixture.tile.s0+100+(c.kind==='preceding'?1:-1)*(-3.5-5.7)}));
    });
    ok('green releases both previously stopped cars',green.length===2&&green.every(c=>c.v>1&&(c.kind==='preceding'?1:-1)*(c.x-c.line)>0),JSON.stringify(green));
    if(shots)await page.screenshot({path:shots+'/green-release.png'});
    const preserved=await page.evaluate(async()=>{const A=RF.DriveAnim,tr=A._.V.src.traffic,pack=()=>JSON.stringify({cars:tr.state.cars,time:tr.state.time,tick:tr.state.tick,seen:[...tr.state.seen]}),before=pack();A.bench(3);const main=before===pack();await A.benchMT(3);return {main,worker:before===pack()};});
    ok('both bench helpers preserve the current traffic state',preserved.main&&preserved.worker,JSON.stringify(preserved));
    const liveSpeed=await page.evaluate(async()=>{const e=document.querySelector('[data-anim="speed"]');e.value='130';e.dispatchEvent(new Event('input',{bubbles:true}));const u=RF.UI,_=RF.DriveAnim._;await _.frameMT(u.dvAnim.dist,u.dvAnim.t);return {ui:u.dvOpts.speed,source:_.V.src.traffic.speed,fail:RF.DriveAnim.stats().mtFail};});
    ok('live speed input reaches the physics and worker job',liveSpeed.ui===130&&liveSpeed.source===130&&!liveSpeed.fail,JSON.stringify(liveSpeed));
    const stream=await page.evaluate(async()=>{
      const u=RF.UI,A=RF.DriveAnim,_=A._;Object.assign(u.dvOpts,{speed:130,tiles:true});Object.assign(u.dvAnim,{dist:0,t:0});u.redrawSpec();let turn=null,min=Infinity;
      for(let i=0;i<=1600;i++){const t=i*.05,dist=t*130/3.6,cars=A.trafficCars(_.V.src,dist,t);for(const c of cars)if(c.kind==='preceding'){if(!c.turning)min=Math.min(min,c.rel);if(c.turning&&Math.abs(c.off)>3.2&&!turn)turn={dist,t,id:c.id,off:c.off,yaw:c.yaw};}}
      if(turn){ // Replay to the departure moment for an actual traced picture, not just the final raw positions.
        _.V.src.traffic.state=null;for(let i=0;i<=Math.round(turn.t/.05);i++)A.trafficCars(_.V.src,i*.05*130/3.6,i*.05);
        Object.assign(u.dvAnim,{dist:turn.dist,t:turn.t});_.frame();await _.frameMT(turn.dist,turn.t);
      }
      return {turn,min,speed:_.V.src.traffic.speed,fail:A.stats().mtFail};
    });
    ok('seeded car follows a turn while the selected target speed stays unchanged',!!stream.turn&&stream.speed===130&&!stream.fail,JSON.stringify(stream));
    if(shots)await page.screenshot({path:shots+'/junction-departure.png'});
    for(const key of ['oncoming','preceding']){await page.click('[data-dv="'+key+'"]');await sleep(120);}
    ok('both lane toggles off suppress all traffic with logic enabled',await page.evaluate(()=>{const _=RF.DriveAnim._,u=RF.UI;return RF.DriveAnim.trafficCars(_.V.src,u.dvAnim.dist,u.dvAnim.t).length===0;}));
    await page.click('[data-dv="oncoming"]');await page.click('[data-dv="preceding"]');
    const start=await page.evaluate(()=>{const u=RF.UI;u.dvAnim.playing=true;u.redrawSpec();return {d:u.dvAnim.dist,n:u.dvAnimFrames};});await sleep(1600);
    ok('live worker animation advances with logic enabled',await page.evaluate(s=>RF.UI.dvAnim.dist>s.d&&RF.UI.dvAnimFrames>s.n&&RF.DriveAnim.stats().workers>0&&!RF.DriveAnim.stats().mtFail,start));
    await page.evaluate(()=>{RF.UI.dvAnim.playing=false;RF.UI.redrawSpec();});
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>RF.UI.setPane('result','activate'));await sleep(400);
    ok('390 px controls fit without horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(shots)await page.screenshot({path:shots+'/mobile.png'});
    ok('saved optical scene is unchanged',saved===await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene)));
    ok('no page errors',errors.length===0,errors.join(' | '));
  } finally {await browser.close();}
  console.log(fails?fails+' FAILED':'all D6 traffic logic page checks passed');process.exitCode=fails?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
