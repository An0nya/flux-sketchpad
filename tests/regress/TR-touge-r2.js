// Claude: python3 tests/serve.py 8793; node tests/regress/TR-touge-r2.js 8793
const fs=require('fs'),path=require('path'),pw=require(process.env.PLAYWRIGHT||'/Users/anya/Projects/agent-qa/node_modules/playwright');
const port=+(process.argv[2]||8793);
(async()=>{const browser=await pw.chromium.launch({channel:'chromium',args:['--use-angle=metal']});let fails=0;const ok=(n,c,d)=>{console.log((c?'[PASS] ':'[FAIL] ')+n+(d?' '+JSON.stringify(d):''));if(!c)fails++;};try{
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
  await page.exposeFunction('trCheck',ok);
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/favicon\.ico/.test(m.location().url||''))errors.push(m.text());}); /* the dev server has no favicon.ico; that 404 is not an app error */
  await page.addInitScript(()=>localStorage.clear());await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.loadScene);
  await page.evaluate(s=>RF.UI.loadScene(RF.State.deserialize(s),'TR fixture'),fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));
  await page.addScriptTag({url:'/tests/drive-three-page.js'});await page.addScriptTag({url:'/tests/regress/UX2-drive-ux.js'});
  await page.addScriptTag({url:'/tests/touge-r2-fixtures.js'});
  await page.evaluate(async()=>{
    const u=await P1Page.ready(),A=RF.DriveAnim,D=RF.Drive,V=A._.V;
    const check=window.trCheck;
    Object.assign(u.dvOpts,{scene:'road',mountainPass:true,tiles:false,gpuRenderer:true,afs:false,corneringLamps:false,ambient:0,mt:false,wet:false,wetSheen:false,tex:false,trafficLogic:false,oncoming:false,preceding:false,people:false,animals:false,signs:false,posts:false,veg:false,obstacle:false,glare:'off',trafficBeams:false,surfaceSheen:false,lampPitch:false,dynamicResolution:false});
    u.dvAnim.dist=655;u.dvAnim.playing=false;u.redrawSpec();await P1Page.select(true);V.pinSS=1;
    await check('TR both toggles default off and appear once',document.querySelectorAll('[data-anim=afs]').length===1&&document.querySelectorAll('[data-anim=cornering-lamps]').length===1&&document.querySelector('[data-anim=afs]').getAttribute('aria-pressed')==='false');
    document.querySelector('[data-anim=afs]').click();await check('TR AFS click updates option and aria-pressed',u.dvOpts.afs&&document.querySelector('[data-anim=afs]').getAttribute('aria-pressed')==='true');
    // Exercise the live controller, then compare same-position HDR frames with/without the swivel.
    for(let i=0;i<150;i++)A._.advanceCamera(u.dvAnim,.02);
    A._.frame();await check('TR live drive feeds AFS into debug readout',A.stats().swivel>0&&A.stats().swivel<=Math.PI/12+1e-9,A.stats().swivel);
    document.querySelector('[data-anim=afs]').click();u.dvAnim.dist=655;u.redrawSpec();A._.frame();
    const original=V.p.lut, data=new Float32Array(original.data);
    // A deterministic generic low beam isolates aim from whatever lamp the fixture traced.
    const lut=D.lutFrom((h,v)=>D.Headlamp.generic(h,v,false),{win:[-90,90,-45,45],step:.25});
    // Compare the same local hairpin fixture on CPU/GPU, then the unmodified elevated pass.
    for(const elevated of [false,true]) {
      const p={...V.p,w:640,h:360,lut,lampRGB:[1,1,1],afs:true,touge:elevated,pitch:0,yaw:0,cornerLeft:0,cornerRight:0,trafficBeams:false,surfaceSheen:false,look:{...V.p.look,ambient:0,wet:false,grain:false}};
      V.gl.resize(p.w,p.h,640,360);const world=RF.Touge.world(p,655,0);world.objects=[];world.markings=[];
      if(!elevated)world.A=TRFixtures.flatHairpinRoute(RF,655);
      const parts=world.A.tiles.reduce((n,t)=>n+A.curveSections(t).length,0);
      await check(`TR ${elevated?'terrain bypasses':'flat fixture fits'} route uniforms`,elevated?p.touge:parts<=16,{tiles:world.A.tiles.length,parts,terrain:p.touge});
      function gpu(yaw,cornerLeft=0,afs=true){const pp={...p,yaw,cornerLeft,afs};V.gl.resize(p.w,p.h,640,360);V.gl.draw({hfov:p.hfov,pats:[],k:.2,glare:0,flip:false,groundGPU:(t,o)=>V.three.render(pp,world,655,t,o,1)});return A._.readHdr();}
      function cpu(yaw,cornerLeft=0){return D.render({w:p.w,h:p.h,hfov:p.hfov,eye:A.EYE,lamps:p.lamps,lut:p.lut,conv:p.conv,lampRGB:p.lampRGB,lane:p.lane,arc:world.A,look:p.look,ss:1,yaw,cornerLeft,scene:{objects:[],markings:[],verge:p.src.verge}}).rgb;}
      // Sample actual road points 20..38 m into the bend, slightly inside our lane. HDR buffers are top-down after the renderer blit.
      const indices=[];const attitude=RF.Touge.attitude(655),axes=[attitude.forward,attitude.left,attitude.up];
      for(let s=20;s<=38;s+=2)for(const off of [.3,.7,1.1]){
        let q=elevated?world.A.surface(s,off).p:[...world.A.at(s,off).p,0];
        if(elevated)q=axes.map(a=>a.reduce((sum,v,i)=>sum+v*q[i],0));
        const d=q.map((v,i)=>v-A.EYE[i]),tanH=Math.tan(p.hfov*Math.PI/360),tanV=tanH*p.h/p.w;
        const x=Math.floor((1-d[1]/d[0]/tanH)*p.w/2),y=Math.floor((1-d[2]/d[0]/tanV)*p.h/2);
        if(d[0]>0&&x>1&&x<p.w-2&&y>1&&y<p.h-2)indices.push(y*p.w+x);
      }
      const sum=(a,channels)=>indices.reduce((s,i)=>s+a[i*channels]+a[i*channels+1]+a[i*channels+2],0);
      const off=gpu(0,0,false),on=gpu(Math.PI/12),offAgain=gpu(0,0,false),corner=gpu(0,1),m={samples:indices.length,off:sum(off,4),on:sum(on,4)};
      await check(`TR ${elevated?'elevated':'flat'} GPU AFS brightens inside hairpin`,m.samples>=10&&m.on>m.off*1.01,m);
      await check(`TR ${elevated?'elevated':'flat'} GPU A/B/A restores exact HDR`,off.every((v,i)=>v===offAgain[i]));
      await check(`TR ${elevated?'elevated':'flat'} GPU corner lamp adds light`,corner.some((v,i)=>i%4!==3&&v>off[i]+1e-6));
      if(!elevated){const co=cpu(0),cn=cpu(Math.PI/12),cc=cpu(0,1),cm={samples:indices.length,off:sum(co,3),on:sum(cn,3)};
        await check('TR CPU AFS brightens inside hairpin',cm.samples>=10&&cm.on>cm.off*1.01,cm);
        let err=0,den=0,cerr=0,cden=0;for(let i=0;i<co.length;i++){const g=on[Math.floor(i/3)*4+i%3],c=corner[Math.floor(i/3)*4+i%3];err+=Math.abs(cn[i]-g);den+=Math.max(.01,cn[i]);cerr+=Math.abs(cc[i]-c);cden+=Math.max(.01,cc[i]);}
        await check('TR swivel CPU/GPU parity <=3%',err/den<.03,{relativeError:err/den});await check('TR cornering CPU/GPU parity <=3%',cerr/cden<.03,{relativeError:cerr/cden});
      }
    }
    await check('TR own LUT identity and bytes retained',V.p.lut===original&&original.data.every((v,i)=>v===data[i]));
    V.gkey=null;Object.assign(u.dvOpts,{afs:true,corneringLamps:true});u.redrawSpec();A._.frame();
  });
  await page.setViewportSize({width:360,height:800});await page.evaluate(()=>{const u=RF.UI;u.dvOpts.debugTimings=true;u.redrawSpec();RF.DriveAnim._.frame();});await page.waitForTimeout(200);
  const layout=await page.evaluate(()=>{const u=RF.UI;u.driveBar.querySelector('.drive-more').open=true;u.redrawSpec();RF.DriveAnim._.frame();return UX2Page.measure();});
  ok('TR 360px controls do not overlap or clip',layout.collisions.length===0&&layout.clipped.length===0&&layout.extrasFit&&layout.wrap,layout);
  const toggles=await page.evaluate(()=>{const es=[...document.querySelectorAll('[data-anim=afs],[data-anim=cornering-lamps]')];return es.map(e=>{const r=e.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,shown:e.checkVisibility()};});});
  ok('TR 360px new toggles remain visible within viewport',toggles.length===2&&toggles.every(r=>r.shown&&r.width>0&&r.left>=0&&r.right<=360),toggles);
  ok('TR no page or shader errors',errors.length===0,errors);
}finally{await browser.close();}console.log(fails?fails+' FAILED':'all TR page checks passed');process.exitCode=fails?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
