// Tester only: python3 tests/serve.py 8737; D5_REAL_GPU=1 node tests/regress/D5-drive-realism.js 8737 [--shots /tmp/D5-shots]
const pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'));
const args=process.argv.slice(2),port=+(args.find(a=>/^\d+$/.test(a))||8737),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+(detail?' — '+detail:''));if(!cond)fails++;};
(async()=>{
 const browser=await pw.chromium.launch(process.env.D5_REAL_GPU?{channel:'chromium'}:{});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('flux/driveView',JSON.stringify({glare:.3,onKcd:30,wet:false}));});
  await page.goto('http://localhost:'+port+'/index.html');
  await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.store&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
  ok('Flux UI and expected page port',await page.evaluate(p=>!!RF.UI&&location.port===String(p),port));
  await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:150000});await page.evaluate(()=>RF.UI.setMode('D'));
  await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
  await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});await sleep(600);
  // Old setDV saved the WHOLE option set, so onKcd 30 (the old default) is in every existing user's storage: it must migrate to symmetric, not manual.
  ok('old saved low glare + default 30 kcd (no onMode) load as rain/symmetric',await page.evaluate(()=>RF.UI.dvOpts.glare==='rain'&&RF.UI.dvOpts.onMode==='symmetric'));
  await page.evaluate(()=>{localStorage.setItem('flux/driveView',JSON.stringify({glare:.3,onKcd:45,wet:false}));RF.UI.dvOpts=null;RF.UI.redrawSpec();});
  ok('old saved non-default kcd (45) stays manual',await page.evaluate(()=>RF.UI.dvOpts.glare==='rain'&&RF.UI.dvOpts.onMode==='manual'&&RF.UI.dvOpts.onKcd===45));
  const saved=await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene));
  await page.evaluate(()=>{localStorage.removeItem('flux/driveView');RF.UI.dvOpts=null;RF.UI.redrawSpec();});
  ok('fresh defaults are symmetric/dry; sheen has an independent setting',await page.evaluate(()=>RF.UI.dvOpts.onMode==='symmetric'&&RF.UI.dvOpts.glare==='dry'&&RF.UI.dvOpts.wetSheen&&document.querySelector('[data-dv="wetSheen"]')));
  const levels=[];for(let i=0;i<4;i++){levels.push(await page.locator('[data-dv="glare"]').textContent());await page.click('[data-dv="glare"]');}
  ok('glare button visits all four named levels',new Set(levels).size===4&&levels.every(v=>/glare (off|dry-low|dry|rain)$/.test(v)),JSON.stringify(levels));
  const bloom=await page.evaluate(()=>{
   const D=RF.Drive,w=640,h=360,canvas=document.createElement('canvas'),gl=RF.DriveAnim.makeGL(canvas);canvas.width=w;canvas.height=h;gl.resize(w,h,w,h);
   const rgb=new Float32Array(w*h*3);for(let y=176;y<184;y++)for(let x=316;x<324;x++)for(let c=0;c<3;c++)rgb[3*(y*w+x)+c]=65504;
   gl.setGround({A:rgb,layers:[]});const params={hfov:60,k:.2,pats:[],glare:D.glareStrength('rain'),veil:0,sources:[],flip:false};gl.draw(params);
   const px=gl.readCanvas(),cpu=D.tonemap({w,h,hfov:60,rgb},{mode:'fixed',ev:1,glare:'rain'}).px;
   let worst=0,sum=0,saturatedOutside=0,halo=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=4*(y*w+x),g=px[4*((h-1-y)*w+x)];worst=Math.max(worst,Math.abs(g-cpu[q]));sum+=Math.abs(g-cpu[q]);if(Math.abs(x-319.5)>8||Math.abs(y-179.5)>8){halo+=g;if(g>245)saturatedOutside++;}}
   const sample=(x,y)=>px[4*((h-1-y)*w+x)], profile={worst,mean:sum/(w*h),saturatedOutside,halo,axis:sample(330,180),diagonal:sample(330,190),far:sample(345,180)};
   const flat=new Float32Array(w*h*3).fill(.1),sources=[[Math.cos(.1),Math.sin(.1),0,.2]];gl.setGround({A:flat,layers:[]});gl.draw({...params,glare:D.glareStrength('dry'),veil:1,sources});
   const gpuVeil=gl.readCanvas(),cpuVeil=D.tonemap({w,h,hfov:60,rgb:flat},{mode:'fixed',ev:1,glare:'dry',sources}).px;let veilWorst=0,veilSum=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const e=Math.abs(gpuVeil[4*((h-1-y)*w+x)]-cpuVeil[4*(y*w+x)]);veilWorst=Math.max(veilWorst,e);veilSum+=e;}
   return {...profile,veilWorst,veilMean:veilSum/(w*h)};
  });
  ok('capped Gaussian bloom: no saturated rectangle around an HDR lamp, rounded falloff and long tail',bloom.saturatedOutside===0&&bloom.halo>0&&bloom.axis>=bloom.diagonal&&bloom.axis>bloom.far,JSON.stringify(bloom));
  ok('CPU/GPU tone maps agree on the same extreme HDR fixture',bloom.mean<1&&bloom.worst<15,JSON.stringify(bloom));
  ok('CPU/GPU disability veil agrees in value and screen direction',bloom.veilWorst<3&&bloom.veilMean<.5,JSON.stringify({worst:bloom.veilWorst,mean:bloom.veilMean}));
  await page.evaluate(()=>{const u=RF.UI;Object.assign(u.dvOpts,{oncoming:true,preceding:true,onMode:'symmetric',wet:true,wetSheen:true,glare:'dry',expMode:'adapt',tiles:false,mt:true});Object.assign(u.dvAnim,{view:'anim',playing:false,dist:40,t:2});u.redrawSpec();RF.DriveAnim._.V.pinSS=1;});await sleep(400);
  const parity=await page.evaluate(async()=>{
   const u=RF.UI,D=RF.DriveAnim,_=D._;let worst=0,n=0,workers=true,finite=true,opaque=true;const modes=[];
   for(const tiles of [false,true])for(const mode of ['symmetric','generic','high','manual']){
    Object.assign(u.dvOpts,{tiles,onMode:mode});Object.assign(u.dvAnim,{dist:40,t:2,playing:false});u.redrawSpec();_.frame();const a=_.readHdr();modes.push({tiles,mode,white:1/_.exposure(),sources:_.frameSources(40,2)});workers=await _.frameMT(40,2)&&workers;const b=_.readHdr();
    for(let i=0;i<a.length;i++){worst=Math.max(worst,Math.abs(a[i]-b[i]));finite=finite&&Number.isFinite(b[i]);if(i%4===3)opaque=opaque&&_.V.rgba[i]===1;n++;}
   }return {worst,n,workers,finite,opaque,modes,fail:D.stats().mtFail};
  });
  ok('wet full frames with symmetric/generic/high/manual lamps match workers on bends/tiles',parity.worst===0&&parity.workers&&parity.finite&&parity.opaque&&!parity.fail,JSON.stringify(parity));
  ok('adapt mode reports the actual animated white level',await page.evaluate(()=>document.querySelector('[data-dv="ev"]').textContent.includes(RF.DriveAnim.stats().white.toPrecision(3))));
  await page.click('[data-dv="wetSheen"]');await sleep(200);
  ok('wet sheen toggle restores cached ground with tiles off',await page.evaluate(()=>{const u=RF.UI;u.dvOpts.tiles=false;u.redrawSpec();RF.DriveAnim._.frame();return !u.dvOpts.wetSheen&&RF.DriveAnim._.V.rgba.some((x,i)=>i%4===3&&x===0);}));
  await page.selectOption('[data-dv="onMode"]','generic');
  ok('lamp-mode setting persists to localStorage',await page.evaluate(()=>JSON.parse(localStorage.getItem('flux/driveView')).onMode==='generic'));
  if(shots){
   require('fs').mkdirSync(shots,{recursive:true});
   // Still view reproduces the owner's original close-pass distances. Keep exposure fixed for comparisons.
   for(const distance of [12,20,30])for(const glare of ['off','dry-low','dry','rain']){
    await page.evaluate(({distance,glare})=>{const u=RF.UI;Object.assign(u.dvOpts,{onDist:distance,onMode:'high',glare,wet:false,expMode:'fixed',ev:1.5});u.dvAnim.view='still';u.redrawSpec();},{distance,glare});await sleep(100);await page.screenshot({path:shots+'/still-'+distance+'m-'+glare+'.png'});
   }
   for(const streetLamps of ['sodium','led']){await page.evaluate(streetLamps=>{const u=RF.UI,D=RF.DriveAnim,tile=Array.from({length:160},(_,k)=>D.roadTile(7,k)).find(t=>t.kind==='urban');Object.assign(u.dvOpts,{tiles:true,streetLamps,wet:true,wetSheen:true,glare:'rain',onMode:'generic'});Object.assign(u.dvAnim,{view:'anim',dist:tile.s0+55,t:2,playing:false});u.redrawSpec();},streetLamps);await sleep(200);await page.screenshot({path:shots+'/wet-'+streetLamps+'.png'});}
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>RF.UI.setPane('result','activate'));await sleep(300);
  ok('mobile toolbar has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  ok('Drive preferences preserve the saved optical scene',saved===await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene)));
  ok('no browser page errors',errors.length===0,errors.join(' | '));
 }finally{await browser.close();}
 console.log(fails?fails+' FAILED':'all D5 realism page checks passed');process.exitCode=fails?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
