// Shared page checks: external runner loads this file; Node entry launches Playwright for the tester.
(function (root) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const settle = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await sleep(80); };
  const mobile = () => matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const rect = e => { const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
  const visible = e => e && !e.hidden && e.checkVisibility() && e.getBoundingClientRect().height > 0;
  const shown = e => { let r = rect(e); for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { if (!/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(p).overflowY)) continue; const c = rect(p); r = { left:Math.max(r.left,c.left), top:Math.max(r.top,c.top), right:Math.min(r.right,c.right), bottom:Math.min(r.bottom,c.bottom) }; } r.width = Math.max(0, r.right - r.left); r.height = Math.max(0, r.bottom - r.top); return r; };   // the part of e a scrolling ancestor actually shows
  const overlaps = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > 1;
  // UI step C (10-29): the drive layout shell. The invariants, restated for it: the top bar and strip hold only the driving controls and none of
  // them overlap or are cut off; no readout or overlay sits on the bars; the large-view button is reachable and clear of the bar controls;
  // in push mode nothing covers the picture (the canvas lies inside the stage and the panels outside it); every control is placed (none in
  // Performance > Other); the game dock keeps the picture; phones keep the dialog bars clear of the 96 px browser-chrome band.
  function measure() {
    const u=RF.UI, L=u.driveLayout, bar=u.driveBar, bounds=rect(bar), host=RF.DriveAnim._.V.canvas.parentElement;
    const bars=[L.top,L.strip], inBars=bars.flatMap(b=>[...b.querySelectorAll('button,input,select,summary')].filter(e=>visible(e)&&shown(e).height>1)), controls=inBars;   // on screen only: the closed sheet clips the strip below its first row (10-29)
    const collisions=[];
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)if(overlaps(rect(controls[i]),rect(controls[j])))collisions.push([controls[i].outerHTML.slice(0,120),controls[j].outerHTML.slice(0,120)]);
    const guide=document.getElementById('first-guide'),guideOpen=!document.querySelector('.drive-popout')?[guide]:[];   // GS: first-visit guide (skipped under the full-viewport popout)
    const overlays=[...document.querySelectorAll('.drive-perf,.drive-fps,.drive-game,.drive-notice,.drive-readout')].filter(visible), guides=guideOpen.filter(visible);
    const cornerBtn=document.querySelector('[data-anim=popout]');
    for(const c of [...controls,...(visible(cornerBtn)?[cornerBtn]:[])])for(const e of overlays)if(overlaps(rect(c),shown(e)))collisions.push([c.dataset.dv||c.dataset.anim||c.dataset.game||c.tagName,e.className||e.id]);   // no readout covers a bar control or the large-view button
    // the first-visit guide (dismissable) keeps the TOP bar clear (scene, Drive, Game); on phones the strip sits under the canvas, under the guide sheet until Got it (UI step C, flagged to the owner)
    for(const c of [...L.top.querySelectorAll('button,input,select')].filter(visible))for(const e of guides)if(overlaps(rect(c),shown(e)))collisions.push([c.dataset.dv||c.dataset.anim||c.dataset.game||c.tagName,'first-guide']);
    const clipped=[];
    for(const e of controls){const r=rect(e),b=rect(e.closest('.dl-top,.dl-strip'));if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)clipped.push(e.outerHTML.slice(0,120));}
    const render=rect(host), perf=RF.DriveAnim._.V.perfLab, picture=rect(RF.DriveAnim._.V.canvas), stage=rect(L.stage), panel=document.querySelector('[data-game=panel]'), card=visible(panel)?shown(panel):null, pop=document.querySelector('.drive-popout'), corner=document.querySelector('[data-anim=popout]');
    const gameOverlap=card?Math.max(0,Math.min(card.right,picture.right)-Math.max(card.left,picture.left))*Math.max(0,Math.min(card.bottom,picture.bottom)-Math.max(card.top,picture.top))/(picture.width*picture.height):0;
    const mode=bar.classList.contains('dl-overlay')?'overlay':bar.classList.contains('dl-tall')?'stack':'push';
    const panels=[L.left,L.right].filter(visible).map(rect), covered=mode==='overlay'?[]:panels.filter(p=>overlaps(p,picture));
    return { width:innerWidth, touch:matchMedia('(pointer: coarse)').matches, mobile:mobile(), mode, toolbar:bounds, render, stage, collisions, clipped,
      picture, game:card, gameOverlap, gameBelow:!card||card.top>=render.bottom-1, popout:pop?rect(pop):null,
      expand:visible(corner)&&!controls.some(e=>overlaps(rect(e),rect(corner))),
      safe:!pop||!matchMedia('(pointer: coarse)').matches||[...pop.querySelectorAll('.dl-top,.dl-strip,.reset-view,.drive-below')].filter(visible).every(e=>shown(e).bottom<=innerHeight-96+1),
      within:bounds.left>=0&&bounds.right<=innerWidth+1, inStage:mode==='overlay'||(picture.left>=stage.left-1&&picture.right<=stage.right+1&&picture.top>=stage.top-1&&picture.bottom<=stage.bottom+1),
      covered:covered.length, unplaced:RF.DriveLayout.unplaced(u),
      debugIn:!visible(perf)||!!perf.closest('[data-dl-pane=timings]'),
      primary:controls.map(e=>e.dataset.dv||e.dataset.anim||e.dataset.game||e.tagName) };
  }
  async function ready() {
    const u=RF.UI;
    for(let i=0;i<1800&&(RF.SolverHost.loading()||u.solving);i++)await sleep(100);
    if(RF.SolverHost.loading()||u.solving)throw Error('UX2 startup solver did not finish');
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()),'UX2 stable fixture');u.setMode('D');
    for(let i=0;i<1800&&!(u.spec&&u.spec.ev&&u.spec.full&&!u.solving&&!u.needCompile&&u.run&&u.run.ctx.done&&u.spec.ctx===u.run.ctx);i++)await sleep(100);
    if(!(u.spec&&u.spec.ev&&u.spec.full))throw Error('UX2 lamp trace did not finish');
    u.setDisplay('drive');u.setPane('result','activate');document.querySelector('.result-pane').classList.add('expanded');
    Object.assign(u.dvOpts,{scene:'city',wet:true,wetSheen:true,glare:'rain',gpuRenderer:true,mt:false,oncoming:true,preceding:true,trafficLogic:true,samples:'auto'});
    Object.assign(u.dvAnim,{view:'anim',playing:false});u.redrawSpec();
    for(let i=0;i<200&&RF.DriveAnim.stats().renderer!=='three'&&!RF.DriveAnim.stats().gpuFailure;i++)await sleep(50);
    await settle();return u;
  }
  async function run(port) {
    const checks=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+(detail?' — '+JSON.stringify(detail):''));};
    ok('UX2 RF.UI and expected port',!!root.RF?.UI&&location.port===String(port));if(location.port!==String(port))throw Error('UX2 wrong page');
    const u=await ready(),D=RF.DriveAnim,a=D._,DL=RF.DriveLayout;
    ok('UX2 heavy scene uses GPU renderer',D.stats().renderer==='three',D.stats().gpuFailure);
    ok('UX2 old saved FPS enables bare badge without debug profiling',u.dvOpts.fpsCounter===true&&u.dvOpts.debugTimings===false&&!a.V.fpsLab.hidden&&a.V.perfLab.hidden&&!D.stats().profiling);
    a.V.profiles=[];a.frame();ok('UX2 badge alone creates no trace profiling samples',!D.stats().lastFrame);
    const play=u.driveBar.querySelector('[data-anim=play]'),game=u.driveBar.querySelector('[data-game=toggle]');
    ok('UX2 distinct paused Drive and Game labels',play.textContent==='▶ Drive'&&game.textContent==='Game');
    play.click();ok('UX2 animation running label',play.textContent==='⏸ Pause');play.click();
    DL.reveal(u,'[data-anim=debug-timings]');await settle();
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
        for(const open of [false,true])for(const fit of [true]) {   // fit controls retired 10-29: one spacing

          DL.setOpen(u,'left',open);DL.setOpen(u,'right',open);u.redrawSpec();await settle();D.layoutControls(u);await settle();
          const m=measure();layouts.push({popout,state,open,fit,...m});
          ok('UX2 no toolbar overlap '+innerWidth+' '+JSON.stringify({popout,state,open,fit}),m.collisions.length===0&&m.clipped.length===0&&m.within&&m.debugIn,m);
          ok('UX2 nothing covers the picture in push or stack '+JSON.stringify({popout,state,open,fit,mode:m.mode}),m.inStage&&m.covered===0,{mode:m.mode,picture:m.picture,stage:m.stage});
          ok('UX3 expand reachable, clear of the bar controls '+JSON.stringify({popout,state,open,fit}),m.expand);
          ok('UX3 game dock preserves the actual picture '+JSON.stringify({popout,state,open,fit}),m.gameBelow&&m.gameOverlap<=.20,{game:m.game,render:m.render,picture:m.picture,overlap:m.gameOverlap,below:m.gameBelow});
          if(popout)ok('UX3 full viewport overlay and toolbar clearance '+JSON.stringify({state,open,fit}),m.popout.left===0&&m.popout.top===0&&Math.abs(m.popout.right-innerWidth)<1&&Math.abs(m.popout.bottom-innerHeight)<1&&m.safe,m.popout);
          // stacked (10-29 bottom sheet): closed keeps the strip's first row, the speed slider; in a game the anim bar's controls (oncoming headlamps, high beam) hide, as V.bar did
          const stowed=m.mode==='stack'&&!open, gaming=state!=='drive', want=['scene','play','toggle',...(stowed?['speed']:['oncoming','preceding','speed','glare','ev',...(gaming?[]:['traffic-beams','high-beam'])])];
          ok('UX2 top bar and strip hold only the driving controls',m.primary.length===want.length&&want.every(k=>m.primary.includes(k)),{got:m.primary,want});
          if(open&&state==='drive')ok('UX2 every control is placed in a tab and reachable',m.unplaced.length===0&&['wetness','wetSheen','onMode'].every(k=>DL.reveal(u,'[data-dv='+k+']')&&visible(u.driveBar.querySelector('[data-dv='+k+']')))&&['tiles','gpu-renderer','fps-counter','debug-timings'].every(k=>DL.reveal(u,'[data-anim='+k+']')&&visible(u.driveBar.querySelector('[data-anim='+k+']'))),m.unplaced);
        }
      }
      game.click();if(popout)D.closePop(u);
    }
    u.dvOpts.debugTimings=false;u.redrawSpec();await settle();
    for(const how of ['close','escape','corner']) {
      window.scrollTo({top:Math.min(180,document.documentElement.scrollHeight-innerHeight),behavior:'instant'});await settle();
      const before=[scrollX,scrollY],corner=document.querySelector('[data-anim=popout]');corner.focus({preventScroll:true});corner.click();await settle();
      ok('UX3 corner opens the large view, focus on its close button '+how,u.dvAnim.popout&&corner.getAttribute('aria-label')==='Close large view'&&document.activeElement===corner);
      const items=[...a.V.pop.querySelectorAll('button,input,select,summary')].filter(e=>!e.disabled&&visible(e)&&e.tabIndex>=0);items[items.length-1].focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      ok('UX3 keyboard focus stays in dialog '+how,document.activeElement===items[0]);
      if(how==='escape')document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));else if(how==='close')document.querySelector('.dp-close').click();else corner.click();
      await settle();ok('UX3 '+how+' restores inline view, scroll and opener',!u.dvAnim.popout&&!document.querySelector('.drive-popout')&&Math.abs(scrollX-before[0])<1&&Math.abs(scrollY-before[1])<1&&document.activeElement===corner&&corner.getAttribute('aria-label')==='Large view',{before,after:[scrollX,scrollY]});
    }
    u.setDisplay('ff');await settle();const reset=document.querySelector('[data-reset=heat]');
    ok('UX3 other views retain recenter',reset.textContent==='⌖'&&reset.getAttribute('aria-label')==='Reset zoom'&&!reset.dataset.anim);
    u.setDisplay('drive');await settle();
    document.querySelector('.result-pane').classList.remove('expanded');await settle();document.querySelector('[data-anim=popout]').click();await settle();
    ok('UX3 large opens above collapsed result panel',u.dvAnim.popout&&rect(a.V.pop).top===0&&document.elementFromPoint(2,2).closest('.drive-popout')===a.V.pop);
    D.closePop(u);document.querySelector('.result-pane').classList.add('expanded');await settle();
    ok('UX2 fixture trace stays stable throughout the layout matrix',u.run.ctx===trace&&!u.solving);
    Object.assign(u.dvOpts,{fpsCounter:false,debugTimings:false});u.redrawSpec();await settle();
    ok('UX2 both readouts can be switched off',a.V.fpsLab.hidden&&a.V.perfLab.hidden);
    u.dvAnim.view='still';u.dvAnim.playing=true;u.redrawSpec();ok('UX2 legacy still view becomes paused animation',u.dvAnim.view==='anim'&&!u.dvAnim.playing&&!a.V.canvas.hidden);play.click();ok('UX2 Drive resumes the migrated paused view',u.dvAnim.view==='anim'&&u.dvAnim.playing&&!a.V.canvas.hidden);play.click();
    Object.assign(u.dvOpts,{fpsCounter:true,debugTimings:true});u.redrawSpec();DL.reveal(u,'[data-anim=debug-timings]');await settle();
    // ANIMATE UI (10-29): with the option on, a panel or sheet move is a transition (mid-way between its ends at 90 ms of 200), and the canvas
    // re-render is held (L.hold) until it ends; with it off, the move is instant. Wide hosts move the left panel, tall hosts the sheet.
    { const L=u.driveLayout, at=()=>L.tall?L.sheet.getBoundingClientRect().top:L.left.getBoundingClientRect().width, move=(open)=>{ if(L.tall)DL.setSheet(u,open?DL.detents(u)[0][0]:'closed'); else DL.setOpen(u,'left',open); };
      move(true); await sleep(450); u.dvOpts.animateUI=true; u.redrawSpec(); await settle(); await sleep(300);
      const a0=at(); move(false); await sleep(90); const mid=at(), hold=!!L.hold; await sleep(450); const a1=at(), held=!!L.hold;
      ok('UX2 animate UI: the move is a transition and the re-render waits for its end '+innerWidth,L.root.classList.contains('dl-animate')&&Math.abs(mid-a0)>2&&Math.abs(mid-a1)>2&&hold&&!held,{a0,mid,a1,hold,held,tall:L.tall});
      move(true); await sleep(450); u.dvOpts.animateUI=false; u.redrawSpec(); await settle();
      const b0=at(); move(false); await settle(); const b1=at();
      ok('UX2 animate UI off: the move is instant '+innerWidth,!L.root.classList.contains('dl-animate')&&Math.abs(b1-b0)>2&&!L.hold,{b0,b1});
      move(true); await settle(); }
    // Leave a heavy-scene screenshot with the Timings tab shown and both readouts enabled.
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
    for(const c of r.checks)console.log((c.pass?'[PASS] ':'[FAIL] ')+c.name+(!c.pass&&c.detail?' — '+JSON.stringify(c.detail).slice(0,1500):''));console.log((errors.length?'[FAIL] ':'[PASS] ')+'UX2 no page errors '+JSON.stringify(errors));failed ||= !r.pass||!!errors.length;await context.close();
  }}finally{await browser.close();}console.log(failed?'UX2 FAILED':'all UX2 page checks passed');process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
