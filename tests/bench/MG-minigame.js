// Tester only: python3 tests/serve.py 8754
// MG_REAL_GPU=1 node tests/bench/MG-minigame.js 8754 > /tmp/MG-bench.jsonl
// Tiles + main thread held constant, OFF/ON/OFF/ON. ON includes full displayed-pixel readback/detection every frame (worst case).
const pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'));
const port=+(process.argv.slice(2).find(a=>/^\d+$/.test(a))||8754),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await pw.chromium.launch(process.env.MG_REAL_GPU?{channel:'chromium'}:{});
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1500,height:950},deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');
   await page.waitForFunction(()=>window.RF&&RF.UI&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
   if(!await page.evaluate(p=>!!RF.UI&&!!RF.DriveGame&&location.port===String(p),port))throw Error('wrong app or port');
   await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:150000});await page.evaluate(()=>RF.UI.setMode('D'));
   await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
   await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});
   const environment=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl&&gl.getExtension('WEBGL_debug_renderer_info');return {gpu:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',cores:navigator.hardwareConcurrency};});
   console.log(JSON.stringify({type:'environment',port,mobileEmulation:mobile,...environment}));if(/SwiftShader|llvmpipe|unknown/i.test(environment.gpu))throw Error('real GPU required (MG_REAL_GPU=1)');
   for(const wet of [false,true])for(const popout of [false,true]){
    if(mobile)await page.setViewportSize(popout?{width:844,height:390}:{width:390,height:844});
    for(const [condition,on] of [['off-before',false],['on',true],['off-after',false],['on-again',true]]){
     await page.evaluate(({wet,popout})=>{const u=RF.UI,A=RF.DriveAnim;if(u.dvAnim.gameMode)A._.toggleGame(u);if(u.dvAnim.popout)A.closePop(u);Object.assign(u.dvOpts,{scene:'road',tiles:true,wet,wetSheen:false,seed:7,speed:75,people:false,animals:false,obstacle:false,oncoming:true,preceding:false,trafficLogic:false,trafficDensity:1,mt:false,glare:'dry',streetLamps:'sodium'});Object.assign(u.dvAnim,{view:'anim',playing:false,dist:0,t:0,total:0});u.redrawSpec();A._.V.pinSS=1;if(popout)A.openPop(u);},{wet,popout});
     if(on){await page.click('[data-game=toggle]');await page.fill('[data-game=speed]','75');await page.selectOption('[data-game=wet]',wet?'wet':'dry');await page.fill('[data-game=seed]','7');await page.click('[data-game=start]');}
     const free=await page.evaluate(on=>{const u=RF.UI,A=RF.DriveAnim,_=A._;u.dvAnim.playing=false;u.redrawSpec();if(on){const g=u.dvAnim.game;g.x=g.t=0;g.next=1000;g.hazards=[{id:1,born:0,kind:'deer',s0:100,off0:0,ds:0,doff:0,spd:0,len:0,side:-1,lit:null,reaction:null,resolved:false}];}Object.assign(u.dvAnim,{dist:0,t:0});
      for(let i=0;i<12;i++){if(on)u.dvAnim.game.hazards[0].lit=null;_.frame();}A.resetStats();const samples=[];for(let i=0;i<80;i++){if(on){u.dvAnim.game.hazards[0].lit=null;u.dvAnim.game.seen=0;}const t=performance.now();_.frame();_.V.gl.sync();samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return {medianMs:samples[40],p95Ms:samples[76],meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,...A.stats()};},on);
     await page.evaluate(()=>{RF.UI.dvAnim.playing=true;RF.UI.redrawSpec();});await sleep(700);
     const start=await page.evaluate(()=>{RF.DriveAnim.resetStats();return RF.DriveAnim.stats().frames;});await sleep(3000);
     const cadence=await page.evaluate(start=>({...RF.DriveAnim.stats(),freshFrames:RF.DriveAnim.stats().frames-start}),start);
     await page.evaluate(()=>{RF.UI.dvAnim.playing=false;RF.UI.redrawSpec();});
     if(cadence.freshFrames<5||errors.length)throw Error('invalid sample '+JSON.stringify({cadence,errors}));
     console.log(JSON.stringify({type:'measurement',mobileEmulation:mobile,wet,popout,condition,seed:7,speed:75,samples:80,free,cadence}));
    }
   }
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
