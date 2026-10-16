// Tester only. Real hardware GPU required for frame-time measurements.
// python3 tests/serve.py 8770
// P0_REAL_GPU=1 node tests/bench/P0-drive-perf.js 8770 > /tmp/P0-browser-profile.jsonl
// Optional P0_SS=1 freezes SS and scale for controlled comparisons. Default uses existing adaptive SS.
// Phone is viewport/DPR emulation on the tester's desktop hardware, not physical-phone performance.
const fs=require('fs'),path=require('path');
const pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'));
const port=+(process.argv[2]||8770),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const browser=await pw.chromium.launch(process.env.P0_REAL_GPU?{channel:'chromium'}:{});
  try {
    for(const phone of [false,true]) {
      const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:2000,height:1120},deviceScaleFactor:phone?3:1,isMobile:phone}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');
      await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.store&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
      if(!await page.evaluate(p=>!!RF.UI&&location.port===String(p),port))throw Error('wrong RF.UI or port');
      await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:180000});
      await page.evaluate(s=>{RF.UI.loadScene(RF.State.deserialize(s),'P0 fixture');RF.UI.setMode('D');},fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));
      await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
      await page.evaluate(()=>{const u=RF.UI;u.setDisplay('drive');u.setPane('result','activate');Object.assign(u.dvAnim||(u.dvAnim={}),{view:'anim',playing:false});u.redrawSpec();RF.DriveAnim.openPop(u);});
      if(!phone)await page.evaluate(()=>{const s=RF.DriveAnim._.V.popStage;s.style.width='1600px';s.style.height='900px';RF.UI.redrawSpec();});
      const gpu=await page.evaluate(()=>{const gl=RF.DriveAnim._.V.gl.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';});
      console.log(JSON.stringify({type:'environment',phoneEmulation:phone,gpu,port,cores:await page.evaluate(()=>navigator.hardwareConcurrency),ss:process.env.P0_SS||'adaptive',note:'CPU GL submission only; gpuMs null. Fresh-frame cadence includes GPU/pacing/back-pressure. Fixture is not owner lamp.'}));
      if(/SwiftShader|llvmpipe|unknown/i.test(gpu))throw Error('real GPU required; no software-renderer frame measurements accepted');
      for(const condition of ['owner','tiles','tiles-cache','static-road'])for(const mt of [true,false]) {
        await page.evaluate(({condition,mt,pin})=>{const D=RF.DriveAnim,u=RF.UI,baseline=condition==='static-road';D._.killWorkers();u.dvAnim.playing=false;Object.assign(u.dvOpts,{scene:baseline?'road':'city',wet:!baseline,wetSheen:!baseline,glare:baseline?'off':'rain',wild:!baseline,density:3,seed:7,tiles:condition.startsWith('tiles'),tileCache:condition==='tiles-cache',trafficLogic:!baseline,oncoming:!baseline,preceding:!baseline,trafficDensity:1,speed:50,mt,dynamicResolution:false,fpsCounter:false,debugTimings:false,frameTargetMs:33,streetLamps:'sodium'});Object.assign(u.dvAnim,{dist:condition.startsWith('tiles')?495:0,total:0,t:12,camera:null});D._.V.pinSS=pin;D._.V.ss=2;D._.V.avg=undefined;u.redrawSpec();}, {condition,mt,pin:+process.env.P0_SS||0});
        const result={};
        // Paired profiler off/on, resetting pose each time; report perturbation rather than hiding it.
        for(const profile of [false,true]) {
          await page.evaluate(({profile,condition})=>{const u=RF.UI;u.dvAnim.playing=false;Object.assign(u.dvAnim,{dist:condition.startsWith('tiles')?495:0,total:0,t:12,camera:null});u.dvOpts.debugTimings=profile;u.redrawSpec();u.dvAnim.playing=true;u.redrawSpec();},{profile,condition});
          await sleep(3000);const start=await page.evaluate(()=>{RF.DriveAnim.resetStats();return RF.DriveAnim.stats().frames;});await sleep(12000);
          result[profile?'profiled':'unprofiled']=await page.evaluate(start=>{const D=RF.DriveAnim,s=D.stats(),a=D._,rect=a.V.canvas.getBoundingClientRect();return {...s,freshFrames:s.frames-start,cssCanvas:[rect.width,rect.height],effectiveWild:!!a.V.src.chunk,options:{...RF.UI.dvOpts}};},start);
          await page.evaluate(()=>{RF.UI.dvAnim.playing=false;RF.UI.redrawSpec();});
        }
        // Isolated GPU timings: query actual draw execution without gl.finish() in the live animation.
        // Upload queries measure GPU-side command latency, not the JS copy/driver cost already in stats.
        result.gpuPasses=await page.evaluate(async()=>{
          const a=RF.DriveAnim._,V=a.V,gl=V.gl.gl,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
          if(!ext)return {status:'not measured: EXT_disjoint_timer_query_webgl2 unavailable'};
          const queries=[],oldDraw=gl.drawArrays;let frame=null;
          const query=(name,fn)=>{const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);try{fn();}finally{gl.endQuery(ext.TIME_ELAPSED_EXT);}queries.push({name,q});};
          const o=V.info.o,st=RF.UI.dvAnim,sources=a.frameSources(st.dist,st.t),f={hfov:o.fov,pats:V.g.layers.map(L=>({pat:L.pat,dist:st.dist%L.pat.period})),A:V.info.A,k:a.exposure(sources),glare:RF.Drive.glareStrength(o.glare),veil:RF.Drive.veilStrength(o.glare),sources,flip:V.info.mirrored,tex:o.tex&&!o.tiles?0.4*(o.wet?0.5:1):0,texDist:st.dist%76.8,lane:V.p.lane};
          try {
            gl.drawArrays=function(...args){query('draw',()=>oldDraw.apply(gl,args));frame.push(queries[queries.length-1]);};
            for(let i=0;i<10;i++) {
              const start=queries.length;frame=[];
              query('upload',()=>V.gl.setObjects(V.rgba,V.band[0],V.band[1]));V.gl.draw(f);
              if(frame.length){frame[0].name='compose';frame[frame.length-1].name='finalVeil';for(let j=1;j<frame.length-1;j++)frame[j].name='glare';}
              for(const q of queries.slice(start))q.warmup=i<2;
            }
          }finally{gl.drawArrays=oldDraw;}
          gl.flush();const deadline=performance.now()+10000;
          while(queries.some(r=>!gl.getQueryParameter(r.q,gl.QUERY_RESULT_AVAILABLE))&&performance.now()<deadline)await new Promise(r=>setTimeout(r,25));
          const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT),available=queries.every(r=>gl.getQueryParameter(r.q,gl.QUERY_RESULT_AVAILABLE)),totals={upload:0,compose:0,glare:0,finalVeil:0};
          if(!disjoint&&available)for(const r of queries)if(!r.warmup)totals[r.name]+=gl.getQueryParameter(r.q,gl.QUERY_RESULT)/1e6/8;
          for(const r of queries)gl.deleteQuery(r.q);
          return disjoint||!available?{status:'not measured: '+(disjoint?'GPU disjoint':'GPU query timeout')}:{status:'measured GPU query; 8 static-pose repetitions',ms:totals};
        });
        const s=result.profiled;if(s.freshFrames<5||!s.fps||!s.breakdownMean.frames||(mt&&!s.workers)||s.mtFail||s.contextLost||errors.length)throw Error('invalid bench '+JSON.stringify({condition,mt,s,errors}));
        console.log(JSON.stringify({type:'measurement',phoneEmulation:phone,condition,mt,...result}));
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error('[FAIL] P0 bench',e);process.exitCode=1;});
