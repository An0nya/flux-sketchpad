/* TG page-side checks/bench, also used by the fixed external runner. */
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function ready(){
    const u=await P1Page.ready(),D=RF.DriveAnim;
    Object.assign(u.dvOpts,{scene:'road',mountainPass:true,tiles:false,gpuRenderer:true,ambient:0,mt:false,wet:false,wetSheen:false,tex:false,trafficLogic:false,oncoming:false,preceding:false,detailedModels:true,dynamicResolution:false});
    D.openPop(u);u.dvAnim.dist=125;u.redrawSpec();await P1Page.select(true);
    if(D.stats().renderer!=='three')throw Error('GPU unavailable: '+D.stats().gpuFailure);
    return u;
  }
  async function run(port){
    const checks=[],ok=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log((pass?'[PASS] ':'[FAIL] ')+name+(detail?' '+JSON.stringify(detail):''));};
    ok('TG RF.UI exists and correct page port',!!RF.UI&&location.port===String(port));if(location.port!==String(port))throw Error('wrong page');
    const u=await ready(),D=RF.DriveAnim,V=D._.V,P=RF.Touge;V.pinSS=1;
    ok('TG Mountain pass UI setting is on',u.dvOpts.mountainPass&&document.querySelector('[data-dv=scene]').value==='__pass');
    const trace=u.run.ctx,beam=V.p.lut;
    function maskAt(dist,station){
      u.dvAnim.dist=dist;u.redrawSpec();D._.frame();const p=V.p,world=P.world(p,dist,0);world.objects=world.objects.filter(ob=>ob.cls!=='deer');
      const K=RF.Drive.kit({Lw:p.lane,A:world.A,rand:()=>.5});K.deer(station-dist,0);
      world.objects.push(...RF.Drive.Models.actors(K.O,true).map(ob=>P.lift({...ob,gameHazard:1},world.A)));
      V.gl.draw({hfov:p.hfov,pats:[],A:null,k:V.white?1/V.white:.2,sources:[],glare:0,veil:0,tex:0,groundGPU:(t,o)=>V.three.render(p,world,dist,t,o,1)});
      const masks=V.three.masks(p,1);return {mask:masks.mask.reduce((n,v)=>n+!!(v&1),0),body:masks.body.reduce((n,v)=>n+!!(v&1),0)};
    }
    const hidden=maskAt(80,300),visible=maskAt(125,160);
    ok('TG terrain hides far-side deer from game masks',hidden.mask===0&&hidden.body===0,hidden);
    ok('TG crest deer body reaches actual GPU detector mask',visible.body>6,visible);
    ok('TG actual completed lamp LUT retained across pass frames',u.run.ctx===trace&&u.run.ctx.done&&V.p.lut===beam);
    u.dvAnim.dist=700;u.redrawSpec();D._.frame();ok('TG hairpin banks camera and lamp frame',Math.abs(D.stats().mountain.roll)>.01&&P.tile(0,3).kind==='30L');
    // Repeated terrain updates must reuse GPU buffers (new BufferAttributes each frame leak their old buffers).
    u.dvOpts.signs=false;u.redrawSpec();D._.frame();const gl=V.gl.gl,create=gl.createBuffer;let buffers=0;
    try{gl.createBuffer=function(){buffers++;return create.call(this);};for(let i=0;i<8;i++)D._.frame();}finally{gl.createBuffer=create;}
    ok('TG steady terrain frames reuse GPU buffers',buffers===0,{buffers});u.dvOpts.signs=true;
    // A/B/A must restore the legacy GPU image exactly, using the same completed beam.
    Object.assign(u.dvOpts,{mountainPass:false,detailedModels:false,scene:'road',tiles:false});u.dvAnim.dist=25;u.redrawSpec();D._.frame();const before=V.gl.readCanvas();
    u.dvOpts.mountainPass=true;u.redrawSpec();D._.frame();u.dvOpts.mountainPass=false;u.redrawSpec();D._.frame();const after=V.gl.readCanvas();
    ok('TG off restores legacy GPU pixels byte-for-byte',before.length===after.length&&before.every((v,i)=>v===after[i]));
    u.dvOpts.mountainPass=true;u.dvAnim.dist=125;u.redrawSpec();await P1Page.select(false);D._.frame();
    ok('TG CPU fallback flat with one-line notice',!V.p.touge&&/CPU fallback stays flat/.test(V.why)&&D.stats().renderer==='cpu',V.why);
    await P1Page.select(true);D._.frame();
    const g=RF.DriveGame.create({seed:7,speed:30,wet:false});g.next=1e9;g.x=125;g.hazards=[{id:1,kind:'deer',s0:160,off0:0,ds:0,doff:0,spd:0,len:0,born:0,side:1,resolved:false,lit:null}];
    const world=P.world(V.p,125,0);D._.gameObjects(g,world);const hazard=world.objects.find(ob=>ob.gameHazard===1&&ob.k==='sdf');
    ok('TG minigame uses elevated M2 body',!!hazard&&hazard.tougePlaced&&hazard.z>0);
    u.dvAnim.game=g;D._.frame();const displayed=V.gl.readCanvas(),background=D._.gameBackground(1),restored=V.gl.readCanvas();
    ok('TG paired minigame background removes hazard and restores exact pass image',!!background&&background.some((v,i)=>v!==displayed[i])&&displayed.every((v,i)=>v===restored[i]));
    ok('TG real-beam game detector sees crest body',g.seen===1&&g.hazards[0].firstPixel&&g.hazards[0].firstPixel.pixels>=6,{seen:g.seen,pixel:g.hazards[0].firstPixel});
    delete u.dvAnim.game;
    // Inspect actual placement, not only the high-level traffic result.
    Object.assign(u.dvOpts,{trafficLogic:true,oncoming:true,preceding:true});u.dvAnim.dist=435;u.redrawSpec();D._.frame();
    const actual=P.world(V.p,435,0).objects.filter(ob=>ob.traffic);
    ok('TG traffic bodies and emitters use surface roots',actual.length>0&&actual.every(ob=>ob.tougePlaced)&&actual.filter(ob=>ob.k==='box').every(ob=>ob.passSlope),{objects:actual.length});
    Object.assign(u.dvOpts,{trafficLogic:false,oncoming:false,preceding:false});u.dvAnim.dist=125;u.redrawSpec();D._.frame();
    return {pass:checks.every(c=>c.pass),checks};
  }
  async function bench({phone=false,port=8792,station=400}={}){
    if(!RF.UI || location.port!==String(port))throw Error('TG benchmark wrong page/port');
    const u=await ready(),D=RF.DriveAnim,V=D._.V;
    Object.assign(u.dvOpts,{mountainPass:true,wet:true,wetSheen:true,surfaceSheen:true,trafficBeams:true,lampPitch:true,glare:'rain',wild:true,density:3,trafficLogic:true,oncoming:true,preceding:true,trafficDensity:3,debugTimings:true,fpsCounter:true,dynamicResolution:false,detailedModels:true,tex:true,speed:40});
    if(!phone)Object.assign(V.popStage.style,{position:'fixed',left:'0',top:'0',width:'1600px',height:'900px'});
    u.dvAnim.dist=station;V.pinSS=0;u.dvAnim.playing=true;u.redrawSpec();await sleep(3000);D.resetStats();const trace=u.run.ctx,beam=V.p.lut,start=performance.now(),frames=V.frames;await sleep(8000);
    const stats=D.stats(),elapsed=performance.now()-start,completed=V.frames-frames;u.dvAnim.playing=false;u.redrawSpec();
    const gl=V.gl.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {stationStart:station,fixture:'MG2-default-lamp.json (real completed aimed optics, not owner saved scene)',viewport:[innerWidth,innerHeight],phoneViewportOnDesktop:phone,devicePixelRatio,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',sameTrace:trace===u.run.ctx,sameBeam:beam===V.p.lut,traceComplete:trace.done&&!u.needCompile,elapsed,completed,averageFPS:completed*1000/elapsed,stats};
  }
  window.TGPage={ready,run,bench};
})();
