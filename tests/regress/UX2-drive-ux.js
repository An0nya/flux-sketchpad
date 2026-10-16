// Shared page checks: external runner loads this file; Node entry launches Playwright for the tester.
(function (root) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const settle = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await sleep(80); };
  const mobile = () => matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const rect = e => { const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
  const visible = e => e && !e.hidden && e.checkVisibility() && e.getBoundingClientRect().height > 0;
  const overlaps = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > 1;
  function measure() {
    const u=RF.UI, bar=u.driveBar, primary=bar.querySelector('.drive-primary'), bounds=rect(bar), host=RF.DriveAnim._.V.canvas.parentElement;
    const controls=[...primary.querySelectorAll('button,input,select,summary')].filter(e=>!e.closest('.drive-extras')&&visible(e));
    const collisions=[];
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)if(overlaps(rect(controls[i]),rect(controls[j])))collisions.push([controls[i].outerHTML,controls[j].outerHTML]);
    const overlays=[u.driveExtras, ...document.querySelectorAll('.drive-perf,.drive-fps,.drive-game,.drive-notice,.drive-readout'),host.querySelector('.reset-view')].filter(visible);
    for(const e of overlays)if(overlaps(bounds,rect(e)))collisions.push(['toolbar',e.className]);
    const clipped=controls.filter(e=>{const r=rect(e);return r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1;}).map(e=>e.outerHTML);
    for(const e of controls)for(let parent=e.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      const r=rect(e),p=rect(parent),s=getComputedStyle(parent),cutsX=/^(hidden|clip|auto|scroll)$/.test(s.overflowX),cutsY=/^(hidden|clip|auto|scroll)$/.test(s.overflowY);
      if((cutsX&&(r.left<p.left-1||r.right>p.right+1))||(cutsY&&(r.top<p.top-1||r.bottom>p.bottom+1)))clipped.push({control:e.outerHTML,parent:parent.className,bounds:p});
    }
    const extra=rect(u.driveExtras), render=rect(host), perf=RF.DriveAnim._.V.perfLab;
    return { width:innerWidth, touch:matchMedia('(pointer: coarse)').matches, mobile:mobile(), toolbar:bounds, render, extra, collisions, clipped,
      wrap:primary.scrollWidth<=primary.clientWidth+1, extrasFit:!visible(u.driveExtras)||u.driveExtras.scrollWidth<=u.driveExtras.clientWidth+1, within:bounds.left>=0&&bounds.right<=innerWidth,
      below:!visible(u.driveExtras)||!mobile()||(extra.top>=render.bottom-1&&getComputedStyle(u.driveExtras).position==='static'),
      debugBelow:!visible(perf)||!mobile()||(rect(perf).top>=render.bottom-1&&getComputedStyle(perf).position==='static'),
      primary:controls.map(e=>e.dataset.dv||e.dataset.anim||e.dataset.game||'more') };
  }
  async function ready() {
    const u=RF.UI;
    for(let i=0;i<1800&&(RF.SolverHost.loading()||u.solving);i++)await sleep(100);
    if(RF.SolverHost.loading()||u.solving)throw Error('UX2 startup solver did not finish');
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()),'UX2 stable fixture');u.setMode('D');
    for(let i=0;i<1800&&!(u.spec&&u.spec.ev&&u.spec.full&&!u.solving&&!u.needCompile&&u.run&&u.run.ctx.done&&u.spec.ctx===u.run.ctx);i++)await sleep(100);
    if(!(u.spec&&u.spec.ev&&u.spec.full))throw Error('UX2 lamp trace did not finish');
    u.setDisplay('drive');u.setPane('result','activate');document.querySelector('.result-pane').classList.add('expanded');
    Object.assign(u.dvOpts,{scene:'city',wet:true,wetSheen:true,glare:'rain',gpuRenderer:true,mt:false,oncoming:true,preceding:true,trafficLogic:true});
    Object.assign(u.dvAnim,{view:'anim',playing:false});u.redrawSpec();
    for(let i=0;i<200&&RF.DriveAnim.stats().renderer!=='three'&&!RF.DriveAnim.stats().gpuFailure;i++)await sleep(50);
    await settle();return u;
  }
  async function run(port) {
    const checks=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+(detail?' — '+JSON.stringify(detail):''));};
    ok('UX2 RF.UI and expected port',!!root.RF?.UI&&location.port===String(port));if(location.port!==String(port))throw Error('UX2 wrong page');
    const u=await ready(),D=RF.DriveAnim,a=D._,more=u.driveBar.querySelector('.drive-more');
    ok('UX2 heavy scene uses GPU renderer',D.stats().renderer==='three',D.stats().gpuFailure);
    ok('UX2 old saved FPS enables bare badge without debug profiling',u.dvOpts.fpsCounter===true&&u.dvOpts.debugTimings===false&&!a.V.fpsLab.hidden&&a.V.perfLab.hidden&&!D.stats().profiling);
    a.V.profiles=[];a.frame();ok('UX2 badge alone creates no trace profiling samples',!D.stats().lastFrame);
    const play=u.driveBar.querySelector('[data-anim=play]'),game=u.driveBar.querySelector('[data-game=toggle]');
    ok('UX2 distinct paused Drive and Game labels',play.textContent==='▶ Drive'&&game.textContent==='Game');
    play.click();ok('UX2 animation running label',play.textContent==='⏸ Pause');play.click();
    more.open=true;await settle();
    document.querySelector('[data-anim=debug-timings]').click();
    ok('UX2 debug preference saved independently',JSON.parse(localStorage.getItem('flux/driveView')).debugTimings===true&&u.dvOpts.fpsCounter);
    a.frame();ok('UX2 Debug timings keeps full P0 breakdown',D.stats().profiling&&!!D.stats().lastFrame&&/GL submit: compose/.test(a.V.perfLab.textContent));
    document.querySelector('[data-anim=fps-counter]').click();
    ok('UX2 debug stays on when FPS is switched off',a.V.fpsLab.hidden&&!a.V.perfLab.hidden&&u.dvOpts.debugTimings);
    document.querySelector('[data-anim=fps-counter]').click();
    const layouts=[],trace=u.run.ctx;
    for(const popout of [false,true]) {
      if(popout)D.openPop(u);
      for(const state of ['drive','lobby','running','scorecard']) {
        if(state==='lobby')game.click();
        if(state==='running'){document.querySelector('[data-game=start]').click();await sleep(250);ok('UX2 game is actually running '+popout,!!u.dvAnim.game&&!u.dvAnim.game.done&&u.dvAnim.playing);}
        if(state==='scorecard'){u.dvOpts.largeCard=false;u.dvAnim.game.done=true;u.dvAnim.playing=false;u.redrawSpec();await settle();}
        if(state!=='drive')ok('UX2 Exit game label '+state+' '+popout,game.textContent==='Exit game');
        for(const open of [false,true])for(const fit of [true,false]) {
          more.open=open;u.dvOpts.fitControls=fit;u.redrawSpec();await settle();D.layoutControls(u);await settle();
          const m=measure();layouts.push({popout,state,open,fit,...m});
          ok('UX2 no toolbar overlap '+innerWidth+' '+JSON.stringify({popout,state,open,fit}),m.collisions.length===0&&m.clipped.length===0&&m.wrap&&m.extrasFit&&m.within&&m.below&&m.debugBelow,m);
          ok('UX2 primary has only driving controls',m.primary.length===6&&['scene','speed','play','toggle','glare','more'].every(k=>m.primary.includes(k)),m.primary);
          if(open)ok('UX2 More keeps advanced controls available',visible(u.driveExtras)&&['oncoming','preceding','wet','wetSheen','onMode'].every(k=>u.driveExtras.querySelector('[data-dv='+k+']'))&&['animate','popout','tiles','gpu-renderer','fps-counter','debug-timings'].every(k=>u.driveExtras.querySelector('[data-anim='+k+']')));
        }
      }
      game.click();if(popout)D.closePop(u);
    }
    ok('UX2 fixture trace stays stable throughout the layout matrix',u.run.ctx===trace&&!u.solving);
    Object.assign(u.dvOpts,{fpsCounter:false,debugTimings:false,fitControls:true});u.redrawSpec();await settle();
    ok('UX2 both readouts can be switched off',a.V.fpsLab.hidden&&a.V.perfLab.hidden);
    u.dvAnim.view='still';u.dvAnim.playing=true;u.redrawSpec();ok('UX2 still view remains available',a.V.canvas.hidden);play.click();ok('UX2 Drive starts animation from the still view',u.dvAnim.view==='anim'&&u.dvAnim.playing&&!a.V.canvas.hidden);play.click();
    Object.assign(u.dvOpts,{fpsCounter:true,debugTimings:true});u.redrawSpec();more.open=true;await settle();
    // Leave a heavy-scene screenshot with More open and both readouts enabled.
    await sleep(700);window.scrollTo({top:0,behavior:'instant'});await settle();
    return {pass:checks.every(c=>c.pass),checks,layouts,viewport:[innerWidth,innerHeight],renderer:D.stats().renderer};
  }
  root.UX2Page={run,measure,ready};
  if(typeof module!=='undefined')module.exports=root.UX2Page;
})(typeof globalThis!=='undefined'?globalThis:this);
if(typeof require!=='undefined'&&require.main===module)(async()=>{
  const fs=require('fs'),path=require('path'),pw=require(process.env.PLAYWRIGHT||'/Users/anya/Projects/agent-qa/node_modules/playwright'),port=+(process.argv[2]||8776);
  const browser=await pw.chromium.launch({channel:'chromium'});let failed=false;
  try {for(const width of [360,390,414,430,768,1280,1500]){
    const context=await browser.newContext({viewport:{width,height:950},hasTouch:width<=430}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('flux/driveView',JSON.stringify({fpsCounter:true}));});
    await page.goto('http://127.0.0.1:'+port+'/index.html');await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.loadScene);
    await page.evaluate(text=>RF.UI.loadScene(RF.State.deserialize(text),'UX2 fixture'),fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));
    await page.addScriptTag({url:'/tests/regress/UX2-drive-ux.js'});const r=await page.evaluate(p=>UX2Page.run(p),port);
    for(const c of r.checks)console.log((c.pass?'[PASS] ':'[FAIL] ')+c.name);console.log((errors.length?'[FAIL] ':'[PASS] ')+'UX2 no page errors '+JSON.stringify(errors));failed ||= !r.pass||!!errors.length;await context.close();
  }}finally{await browser.close();}console.log(failed?'UX2 FAILED':'all UX2 page checks passed');process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
