// Tester only: python3 tests/serve.py 8744
// D6_REAL_GPU=1 node tests/bench/D6-traffic-logic.js 8744 > /tmp/D6-traffic-bench.jsonl
// Same settings, OFF/ON/OFF/ON; 60 simulated seconds warm traffic, 3 s cadence, 80 awaited worker frames.
// Mobile is desktop hardware emulation. The sim dimensions are reported; tiles retain D4's 640 px cap.
const pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'));
const port=+(process.argv.slice(2).find(a=>/^\d+$/.test(a))||8744),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const browser=await pw.chromium.launch(process.env.D6_REAL_GPU?{channel:'chromium'}:{});
  try {
    for(const mobile of [false,true]) {
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1500,height:950},deviceScaleFactor:mobile?3:1,isMobile:mobile}),page=await context.newPage();
      await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');
      await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.store&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
      if(!await page.evaluate(p=>!!RF.UI&&!!RF.DriveAnim&&location.port===String(p),port))throw Error('wrong app or port');
      await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:150000});await page.evaluate(()=>RF.UI.setMode('D'));
      await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
      await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});await sleep(700);
      const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl&&gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';});
      console.log(JSON.stringify({type:'environment',port,gpu,mobileEmulation:mobile,cores:await page.evaluate(()=>navigator.hardwareConcurrency)}));
      if(/SwiftShader|llvmpipe|unknown/i.test(gpu))throw Error('real GPU required (set D6_REAL_GPU=1)');
      for(const [scene,tiles] of [['road',false],['road',true],['city',true]])for(const popout of [false,true]) {
        if(mobile)await page.setViewportSize(popout?{width:844,height:390}:{width:390,height:844});
        await page.evaluate(({scene,tiles})=>{const u=RF.UI,A=RF.DriveAnim;if(u.dvAnim&&u.dvAnim.popout)A.closePop(u);Object.assign(u.dvOpts,{scene,tiles,trafficLogic:false,mt:true,seed:7,trafficDensity:3,oncoming:true,preceding:true,speed:50,safeGap:true,wild:true,density:1.5,wet:false,wetSheen:false,glare:'dry',streetLamps:'sodium'});Object.assign(u.dvAnim,{view:'anim',playing:false,dist:0,t:0});u.redrawSpec();}, {scene,tiles});await sleep(500);
        if(popout){await page.evaluate(()=>RF.DriveAnim.openPop(RF.UI));await sleep(400);}
        if(!await page.evaluate(()=>RF.DriveAnim._.V.canvas.getClientRects().length>0))throw Error('animation not visible');
        for(const [condition,logic] of [['off-before',false],['on',true],['off-after',false],['on-again',true]]) {
          const position=await page.evaluate(logic=>{
            const u=RF.UI,A=RF.DriveAnim,_=A._,tile=Array.from({length:100},(_,k)=>A.roadTile(7,k)).find(t=>t.kind==='intersection'),t=63,dist=tile.s0+30;
            u.dvAnim.playing=false;u.dvOpts.trafficLogic=logic;Object.assign(u.dvAnim,{dist,t});u.redrawSpec();_.V.pinSS=1;_.V.src.traffic.state=null;
            if(logic)for(let i=0;i<=600;i++)A.trafficCars(_.V.src,dist-(60-i*.1)*50/3.6,t-60+i*.1);
            _.frame();return {dist,t};
          },logic);
          await page.evaluate(()=>{RF.UI.dvAnim.playing=true;RF.UI.redrawSpec();});await sleep(750);
          const n=await page.evaluate(()=>{RF.DriveAnim.resetStats();return RF.DriveAnim.stats().frames;});await sleep(3000);
          const cadence=await page.evaluate(n=>({...RF.DriveAnim.stats(),freshFrames:RF.DriveAnim.stats().frames-n,trafficCars:RF.DriveAnim._.V.src.traffic.state?.cars.length||0}),n);
          if(!cadence.workers||cadence.mtFail||cadence.freshFrames<10||!cadence.rafMedianMs)throw Error('invalid worker cadence: '+JSON.stringify(cadence));
          await page.evaluate(()=>{RF.UI.dvAnim.playing=false;RF.UI.redrawSpec();});await sleep(300);
          const free=await page.evaluate(async({dist,t})=>{
            const A=RF.DriveAnim,_=A._,u=RF.UI;Object.assign(u.dvAnim,{dist,t});_.V.src.traffic.state=null;
            if(u.dvOpts.trafficLogic)for(let i=0;i<=600;i++)A.trafficCars(_.V.src,dist-(60-i*.1)*50/3.6,t-60+i*.1);
            return A.benchMT(80);
          },position);
          console.log(JSON.stringify({type:'measurement',scene,tiles,popout,mobileEmulation:mobile,condition,position,seed:7,trafficDensity:3,ss:1,cadence,free}));
        }
      }
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
