/* Page-side P1 checks, shared by the external runner and tests/regress/P1-drive-three.js. */
(function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function ready() {
    const u=RF.UI;u.setMode('D');
    for(let i=0;i<1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx===u.run.ctx);i++)await sleep(100);
    if(!(u.spec && u.spec.ev && u.spec.full))throw Error('lamp trace did not finish');
    await sleep(500);u.setDisplay('drive');u.setPane('result','activate');Object.assign(u.dvAnim||(u.dvAnim={}),{view:'anim',playing:false});u.redrawSpec();
    return u;
  }
  async function select(gpu) {
    const u=RF.UI;u.dvOpts.gpuRenderer=gpu;u.redrawSpec();
    if(gpu)for(let i=0;i<200 && RF.DriveAnim.stats().renderer!=='three' && !RF.DriveAnim.stats().gpuFailure;i++)await sleep(50);
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    if(!gpu)for(let i=0;i<20 && RF.DriveAnim.stats().renderer!=='cpu';i++)await sleep(50);
    RF.DriveAnim._.frame();return RF.DriveAnim.stats();
  }
  function category(key){
    if(['asphalt','concrete','gravel','grass','leaves'].includes(key))return 'road';
    if(/paint|rpm/.test(key))return 'markings';
    if(/sign|reflector/.test(key))return 'signs';
    if(['car-paint','plate','tyre','lamp-head'].includes(key))return 'vehicles';
    if(/wall|win-/.test(key))return 'buildings';
    if(key==='sky')return 'sky';
    return 'actors/vegetation';
  }
  // Sum absolute RGB error / sum reference luminance, with a .01 cd/m² per-channel floor
  // for nearly black classes. Tight photometric gates; max error is reported separately.
  const thresholds={road:.03,markings:.03,signs:.05,vehicles:.05,buildings:.02,sky:.005,'actors/vegetation':.05};
  async function run(port) {
    const checks=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+(detail?' — '+JSON.stringify(detail):''));};
    ok('P1 RF.UI and expected port',!!RF.UI && location.port===String(port));
    if(location.port!==String(port))throw Error('wrong page port');
    const u=await ready(),D=RF.DriveAnim,a=D._;
    ok('P1 GPU renderer defaults off',u.dvOpts.gpuRenderer===false);
    a.V.pinSS=1;Object.assign(u.dvOpts,{mt:false,tex:false,dynamicResolution:false,fpsCounter:false,trafficLogic:false,trafficDensity:1,speed:50,oncoming:true,preceding:true,wild:true});
    D.openPop(u);Object.assign(a.V.popStage.style,{position:'fixed',left:'0',top:'90px',width:'1280px',height:'720px'});
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    // Warm the lazy module before taking paired snapshots; its redraw can replace the initial UI beam cache.
    await select(true);await select(false);
    const cases=[];
    for(const name of ['road','city','forest','tiles'])for(const wet of [false,true]) {
      Object.assign(u.dvOpts,{scene:name==='tiles'?'city':name,tiles:name==='tiles',wet,wetSheen:wet,ambient:0});
      Object.assign(u.dvAnim,{dist:name==='tiles'?495:25,t:12,playing:false});
      await select(false);const cpu=a.readHdr();
      const traceContext=u.run.ctx,p=a.V.p,dist=u.dvAnim.dist,t=u.dvAnim.t,world=p.src.tiles?D.tileWorld(p,dist,t):{A:p.A,objects:D.placedObjects(p,dist,t)};
      const labelled=RF.Drive.render({w:p.w,h:p.h,hfov:p.hfov,eye:D.EYE,lamps:p.lamps,lut:p.lut,conv:p.conv,arc:world.A,lane:p.lane,look:p.look,ss:1,pointLights:world.lights,crossings:world.crossings,scene:{objects:world.objects,markings:world.markings||p.src.markings,verge:p.src.verge}});
      const selected=await select(true),gpu=a.readHdr();
      ok('P1 GPU selected '+name+'/'+wet,selected.renderer==='three'&&!selected.gpuFailure);
      ok('P1 same completed beam '+name+'/'+wet,u.run.ctx===traceContext&&!u.needCompile&&a.V.p.lut===p.lut,{context:u.run.ctx===traceContext,pending:!!u.needCompile,lut:a.V.p.lut===p.lut});
      ok('P1 matching frame dimensions '+name+'/'+wet,p.w===a.V.p.w&&p.h===a.V.p.h&&cpu.length===gpu.length,{cpu:[p.w,p.h],gpu:[a.V.p.w,a.V.p.h]});
      if(cpu.length!==gpu.length || p.w!==a.V.p.w)throw Error('parity dimensions changed');
      const groups={};let finite=true;
      for(let i=0;i<p.w*p.h;i++){const key=category(labelled.keys[labelled.mat[i]]),g=groups[key]||(groups[key]={pixels:0,error:0,reference:0,max:0});g.pixels++;
        for(let c=0;c<3;c++){const x=cpu[4*i+c],y=gpu[4*i+c],d=Math.abs(x-y);finite=finite&&Number.isFinite(y);g.error+=d;g.reference+=x;g.max=Math.max(g.max,d);}}
      for(const [key,g]of Object.entries(groups)){g.relative=g.error/Math.max(g.reference,g.pixels*3*.01);g.meanAbs=g.error/(g.pixels*3);g.threshold=thresholds[key];ok('P1 parity '+name+'/'+(wet?'wet':'dry')+'/'+key,g.relative<=g.threshold,g);}
      ok('P1 finite nonblack HDR '+name+'/'+wet,finite&&gpu.some((v,i)=>i%4!==3&&v>.01));
      cases.push({name,wet,groups,sim:[p.w,p.h]});
    }
    // Switching back must restore the exact CPU frame, including after three has used the GL context.
    await select(false);const before=a.readCanvas();await select(true);await select(false);const after=a.readCanvas();
    ok('P1 GPU off restores identical CPU canvas',before.length===after.length&&before.every((v,i)=>v===after[i]));
    const button=document.querySelector('[data-anim=gpu-renderer]');button.click();await select(true);
    ok('P1 toggle remembered with drive settings',JSON.parse(localStorage.getItem('flux/driveView')).gpuRenderer===true);
    const original=a.V.three.render;a.V.three.render=()=>{throw Error('P1 injected shader failure');};a.frame();
    ok('P1 shader failure falls back to CPU with notice',D.stats().renderer==='cpu'&&/P1 injected/.test(D.stats().gpuFailure)&&/CPU/.test(a.V.why));
    await select(false);await select(true);
    // Actual Play path, then a fixed nearby hazard for a repeatable lit-body assertion.
    a.toggleGame(u);document.querySelector('[data-game=start]').click();u.dvAnim.playing=false;u.redrawSpec();
    await new Promise(requestAnimationFrame);const g=u.dvAnim.game;g.next=1000;g.hazards=[{id:1,born:g.t,kind:'deer',s0:g.x+18,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,side:-1,crosswalk:false,noHiViz:false,jaywalking:false,lit:null,reaction:null,resolved:false}];g.spawned=1;delete g.pauseAt;a.frame();
    const frame=a.readCanvas(),background=a.gameBackground(1),restored=a.readCanvas(),mask=a.V.gameBodyMask;
    ok('P1 GPU hazard mask and paired background',D.stats().renderer==='three'&&mask.some(v=>v&1)&&!!background&&frame.every((v,i)=>v===restored[i]));
    ok('P1 lit body detected',g.seen===1&&!!g.hazards[0].firstPixel,{seen:g.seen,range:g.hazards[0].firstRange,pixel:g.hazards[0].firstPixel});
    u.dvAnim.playing=true;u.redrawSpec();const count=a.V.frames;await sleep(2500);const live={done:g.done,reason:g.reason,frames:a.V.frames-count};u.dvAnim.playing=false;u.redrawSpec();
    ok('P1 Play advances GPU frames',a.V.frames>count+1,{...live,renderer:D.stats().renderer});
    return {checks,cases,thresholds,pass:checks.every(c=>c.pass),game:{seen:g.seen,range:g.hazards[0].firstRange,frames:a.V.frames-count}};
  }
  async function bench({phone=false}={}) {
    const u=await ready(),D=RF.DriveAnim,a=D._,results=[];
    Object.assign(u.dvOpts,{scene:'city',tiles:false,wet:true,wetSheen:true,glare:'rain',wild:true,density:3,trafficLogic:true,oncoming:true,preceding:true,mt:false,fpsCounter:true,dynamicResolution:false,tex:true});D.openPop(u);
    // Exact desktop display size; phone uses its normal responsive popout.
    if(!phone)Object.assign(a.V.popStage.style,{position:'fixed',left:'0',top:'0',width:'1600px',height:'900px'});
    a.V.pinSS=0;
    for(const gpu of [false,true]){
      const selected=await select(gpu);if(gpu&&selected.renderer!=='three')throw Error('GPU bench fell back: '+selected.gpuFailure);u.dvAnim.playing=true;u.redrawSpec();await sleep(3000);D.resetStats();const trace=u.run.ctx,started=performance.now(),frames=a.V.frames;await sleep(8000);
      const stats=D.stats(),elapsed=performance.now()-started;results.push({requested:gpu?'three':'cpu',traceComplete:u.run.ctx.done&&!u.needCompile,sameTrace:u.run.ctx===trace,elapsed,completed:a.V.frames-frames,averageFPS:(a.V.frames-frames)*1000/elapsed,stats});u.dvAnim.playing=false;u.redrawSpec();
    }
    const gl=a.V.gl.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {viewport:[innerWidth,innerHeight],phoneEmulation:phone,devicePixelRatio,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',fixture:'MG2-default-lamp.json; owner-like settings, not owner optical scene',results};
  }
  async function aux() {
    const u=await ready(),D=RF.DriveAnim,a=D._;Object.assign(u.dvOpts,{scene:'road',tiles:false,wet:true,wetSheen:true,tex:false,mt:false});a.V.pinSS=1;D.openPop(u);await select(true);
    if(!a.V.three)throw Error('GPU unavailable: '+D.stats().gpuFailure);
    const results=[];
    for(const conv of ['A','B','S']){
      const p={...a.V.p,conv},world={objects:[],markings:p.src.markings};
      const ref=RF.Drive.render({w:p.w,h:p.h,hfov:p.hfov,eye:D.EYE,lamps:p.lamps,lut:p.lut,conv,lane:p.lane,look:p.look,ss:1,scene:{...world,verge:p.src.verge}});
      a.V.gl.draw({hfov:p.hfov,pats:[],k:.2,glare:0,flip:false,groundGPU:(A,O)=>a.V.three.render(p,world,0,A,O,1)});const gpu=a.readHdr();let error=0,sum=0,max=0;
      for(let i=0;i<p.w*p.h;i++)for(let c=0;c<3;c++){const x=ref.rgb[3*i+c],d=Math.abs(x-gpu[4*i+c]);error+=d;sum+=x;max=Math.max(max,d);}
      results.push({conv,relative:error/Math.max(sum,1e-9),max,pass:error/Math.max(sum,1e-9)<.005});
    }
    a.frame();const gl=a.V.gl.gl,ext=gl.getExtension('WEBGL_lose_context');let context={measured:false};
    if(ext){ext.loseContext();await sleep(250);const lost=D.stats().contextLost;ext.restoreContext();for(let i=0;i<40&&D.stats().contextLost;i++)await sleep(100);await sleep(250);context={measured:true,lost,stats:D.stats(),notice:a.V.why,pass:lost&&!D.stats().contextLost&&D.stats().renderer==='cpu'&&/CPU/.test(a.V.why)};}
    return {conventions:results,context,pass:results.every(r=>r.pass)&&context.pass};
  }
  window.P1Page={run,bench,ready,select,thresholds,aux};
})();
