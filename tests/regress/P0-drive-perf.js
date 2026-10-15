// Tester only; builder cannot run browsers.
// python3 tests/serve.py 8770
// P0_REAL_GPU=1 node tests/regress/P0-drive-perf.js 8770
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8770); let fails = 0;
const ok = (n,c,d) => { console.log((c?'[PASS] ':'[FAIL] ')+n+(d?' — '+JSON.stringify(d):'')); if(!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch(process.env.P0_REAL_GPU ? {channel:'chromium'} : {});
  try {
    const page = await browser.newPage({viewport:{width:1900,height:1050}}), errors=[];
    page.on('pageerror',e=>errors.push(String(e))); await page.addInitScript(()=>localStorage.clear());
    await page.goto('http://localhost:'+port+'/index.html');
    await page.waitForFunction(()=>window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(),null,{timeout:60000});
    const identity=await page.evaluate(p=>!!RF.UI && location.port===String(p),port); ok('P0 RF.UI and expected port',identity); if(!identity) throw Error('wrong page');
    await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:180000});
    await page.evaluate(s=>{RF.UI.loadScene(RF.State.deserialize(s),'P0 fixture');RF.UI.setMode('D');},fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));
    await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
    await page.evaluate(()=>{const u=RF.UI;u.setDisplay('drive');u.setPane('result','activate');Object.assign(u.dvAnim||(u.dvAnim={}),{view:'anim',playing:false});Object.assign(u.dvOpts,{mt:false,scene:'city',wet:true,wetSheen:true,oncoming:true,preceding:true,trafficLogic:true});u.redrawSpec();document.querySelector('.drive-more').open=true;RF.DriveAnim._.V.pinSS=1;});
    ok('P0 defaults off and 33 ms target',await page.evaluate(()=>!RF.UI.dvOpts.fpsCounter&&!RF.UI.dvOpts.dynamicResolution&&RF.UI.dvOpts.frameTargetMs===33));
    await page.locator('[data-anim=fps-counter]').click();
    ok('P0 counter remembered in drive preferences',await page.evaluate(()=>RF.UI.dvOpts.fpsCounter&&JSON.parse(localStorage.getItem('flux/driveView')).fpsCounter));
    const parity=await page.evaluate(()=>{const u=RF.UI,a=RF.DriveAnim._;const draw=on=>{u.dvOpts.fpsCounter=on;u.redrawSpec();a.frame();return {cpu:new Float32Array(a.V.rgba),canvas:a.readCanvas()};};const off=draw(false),on=draw(true);return {cpu:off.cpu.every((v,i)=>v===on.cpu[i]),canvas:off.canvas.every((v,i)=>v===on.canvas[i]),stats:RF.DriveAnim.stats()};});
    ok('P0 profiler preserves CPU and canvas pixels',parity.cpu&&parity.canvas);
    ok('P0 stats exposes sampled trace and CPU GL breakdown',parity.stats.lastFrame&&parity.stats.breakdown.sampledRays>0&&parity.stats.breakdown.gpuMs===null&&parity.stats.breakdown.components.finalVeilMs.ms>=0,parity.stats.breakdown);
    await page.locator('[data-anim=dynamic-resolution]').click();
    ok('P0 resolution preference remembered',await page.evaluate(()=>JSON.parse(localStorage.getItem('flux/driveView')).dynamicResolution===true));
    const scales=await page.evaluate(()=>{const D=RF.DriveAnim,a=D._,u=RF.UI;const full=a.V.p.w;a.V.pinSS=0;a.V.resolution={...D.resolutionState(),index:2,scale:0.7};a.frame();const small=a.V.p.w;a.V.pinSS=1;a.frame();const pin=a.V.p.w;a.V.pinSS=0;u.dvOpts.dynamicResolution=false;u.redrawSpec();return {full,small,pin,restored:a.V.p.w};});
    ok('P0 render integration reduces dimensions, pinSS and off restore',scales.small<scales.full&&scales.pin===scales.full&&scales.restored===scales.full,scales);
    const worker=await page.evaluate(async()=>{const D=RF.DriveAnim,a=D._,u=RF.UI;a.Wk.forced=2;u.dvOpts.mt=true;u.redrawSpec();D.resetStats();const drawn=await a.frameMT(25,5);return {drawn,...D.stats()};});
    ok('P0 worker round-trip and main work exposed',worker.drawn&&worker.workers===2&&worker.breakdown.workerCpuMs>0&&worker.breakdown.components.workerRoundTripMs.ms>0&&worker.breakdown.mainMs>0&&!worker.mtFail,worker.breakdown);
    // Both normal and narrow popout; counter must remain within the canvas host, with primary controls scrollable.
    for(const width of [1900,390]) {
      await page.setViewportSize({width,height:width===390?844:1050});
      await page.evaluate(()=>{RF.UI.dvOpts.mt=false;RF.UI.dvAnim.playing=false;RF.UI.setPane('result','activate');RF.DriveAnim.openPop(RF.UI);RF.UI.redrawSpec();});
      const fit=await page.evaluate(()=>{const a=RF.DriveAnim._,r=a.V.perfLab.getBoundingClientRect(),h=a.V.canvas.parentElement.getBoundingClientRect(),p=RF.UI.driveBar.querySelector('.drive-primary');return {mounted:a.V.perfLab.parentElement===a.V.canvas.parentElement,visible:!a.V.perfLab.hidden,inside:r.left>=h.left-1&&r.right<=h.right+1,width:r.width,host:h.width,primary:p.clientWidth,scroll:p.scrollWidth,overflow:getComputedStyle(p).overflowX};});
      ok('P0 counter and toolbar fit '+width,fit.mounted&&fit.visible&&fit.inside&&fit.primary>0&&fit.overflow==='auto',fit);
      await page.evaluate(()=>RF.DriveAnim.closePop(RF.UI));
    }
    // Real detector and paired background at reduced trace dimensions, with a nearby deterministic hazard.
    const detector=await page.evaluate(()=>{const u=RF.UI,D=RF.DriveAnim,a=D._;u.dvOpts.dynamicResolution=true;u.dvOpts.mt=false;a.V.pinSS=0;a.toggleGame(u);document.querySelector('[data-game=start]').click();u.dvAnim.playing=false;u.redrawSpec();a.V.resolution={...D.resolutionState(),index:2,scale:0.7};const g=u.dvAnim.game;g.next=1000;g.hazards=[{id:1,born:g.t,kind:'deer',s0:g.x+18,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,side:-1,crosswalk:false,noHiViz:false,jaywalking:false,lit:null,reaction:null,resolved:false}];g.spawned=1;delete g.pauseAt;a.frame();const before=a.readCanvas(),background=a.gameBackground(1),after=a.readCanvas(),rect=a.V.canvas.getBoundingClientRect(),pixel=RF.DriveGame.firstLit({rgba:before,background,cssW:rect.width,cssH:rect.height,mask:a.V.gameBodyMask,id:1,w:a.V.gl.cw,h:a.V.gl.ch,mw:a.V.p.w,mh:a.V.p.h,flip:a.V.info.mirrored});return {scale:a.V.renderScale,mask:a.V.gameBodyMask.length,sim:a.V.p.w*a.V.p.h,background:!!background,pixel,restored:before.every((v,i)=>v===after[i]),stats:D.stats().lastFrame};});
    ok('P0 reduced detector has matching mask, paired background and lit body pixel',detector.scale<1&&detector.mask===detector.sim&&detector.background&&!!detector.pixel&&detector.restored&&detector.stats.detectorMs>0,detector);
    await page.evaluate(()=>{const u=RF.UI;RF.DriveAnim._.toggleGame(u);u.dvAnim.view='still';u.dvAnim.playing=false;u.redrawSpec();});
    ok('P0 still remains available and readout hidden',await page.evaluate(()=>RF.DriveAnim._.V.canvas.hidden&&RF.DriveAnim._.V.perfLab.hidden));
    ok('P0 no page errors',errors.length===0,errors);
  } finally {await browser.close();}
  console.log(fails?fails+' FAILED':'all P0 page checks passed');process.exitCode=fails?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
