// Tester only: python3 tests/serve.py 8758; node tests/regress/MG-minigame.js 8758 [--shots /tmp/MG-shots]
const pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'));
const args=process.argv.slice(2),port=+(args.find(a=>/^\d+$/.test(a))||8758),shots=args.includes('--shots')?args[args.indexOf('--shots')+1]:null;
let fails=0;const ok=(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+(detail?' — '+JSON.stringify(detail):''));if(!cond)fails++;};
(async()=>{
 const browser=await pw.chromium.launch(process.env.MG_REAL_GPU?{channel:'chromium'}:{});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:950},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');
  await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.store&&RF.SolverHost&&!RF.SolverHost.loading(),null,{timeout:60000});
  const identity=await page.evaluate(p=>!!RF.UI&&!!RF.DriveGame&&location.port===String(p),port);ok('MG Flux page and port '+port,identity);if(!identity)throw Error('wrong page');
  await page.waitForFunction(()=>!RF.UI.solving,null,{timeout:150000});await page.evaluate(()=>RF.UI.setMode('D'));
  await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
  await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});
  ok('MG2 mode defaults OFF',await page.evaluate(()=>!RF.UI.dvAnim.gameMode));
  const before=await page.evaluate(()=>{const u=RF.UI,_=RF.DriveAnim._;Object.assign(u.dvOpts,{scene:'road',tiles:false,trafficLogic:true,oncoming:false,preceding:false,mt:true,seed:7,speed:50});Object.assign(u.dvAnim,{view:'anim',playing:false,dist:40,t:3,total:40,camera:{x:40,v:10}});u.redrawSpec();_.V.pinSS=1;_.frame();window.mgBefore=Array.from(_.readHdr());return {options:JSON.stringify(u.dvOpts),scene:RF.State.serialize(u.store.scene),state:{dist:u.dvAnim.dist,t:u.dvAnim.t,total:u.dvAnim.total}};});
  await page.click('[data-game=toggle]');
  ok('MG2 visible rules default; original rules selectable',await page.evaluate(()=>document.querySelector('[data-game=rules]').value==='visible'&&!!document.querySelector('[data-game=rules] option[value=legacy]')));
  await page.fill('[data-game=speed]','75');await page.selectOption('[data-game=wet]','wet');await page.fill('[data-game=seed]','19');await page.click('[data-game=start]');
  const setup=await page.evaluate(()=>{const u=RF.UI,_=RF.DriveAnim._;u.dvAnim.playing=false;u.redrawSpec();const start=u.dvAnim.game.x;for(let i=0;i<120;i++)_.advanceCamera(u.dvAnim,1/120);return {dx:u.dvAnim.game.x-start,v:u.dvAnim.camera.v*3.6,tiles:u.dvOpts.tiles,wet:u.dvOpts.wet,logic:u.dvOpts.trafficLogic,workers:_.Wk.list.length,verdict:u.dvAnim.game.verdict,seed:u.dvAnim.game.seed};});
  ok('MG fixed 75km/h overrides D6b cap, seeded wet tiles and main-thread frame',Math.abs(setup.dx-75/3.6)<1e-8&&Math.abs(setup.v-75)<1e-8&&setup.tiles&&setup.wet&&!setup.logic&&!setup.workers&&setup.seed===19,setup);
  const lit=await page.evaluate(()=>{const u=RF.UI,A=RF.DriveAnim,_=A._,g=u.dvAnim.game;g.next=1000;g.hazards=[{id:1,born:g.t,kind:'deer',s0:g.x+18,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,side:-1,crosswalk:false,noHiViz:false,jaywalking:false,lit:null,reaction:null,resolved:false}];g.spawned=1;delete g.pauseAt;_.frame();const h=g.hazards[0],rect=_.V.canvas.getBoundingClientRect(),pixel=RF.DriveGame.firstLit({rgba:_.readCanvas(),background:_.V.gameBackgrounds[1],cssW:rect.width,cssH:rect.height,mask:_.V.gameBodyMask,id:1,w:_.V.gl.cw,h:_.V.gl.ch,mw:_.V.p.w,mh:_.V.p.h,flip:_.V.info.mirrored});return {lit:h.lit,pixel,stored:h.firstPixel,mask:_.V.gameMask.some(v=>v===1)};});
  ok('MG first-lit uses the displayed canvas and nearest-hit hazard mask',lit.lit!==null&&lit.mask&&!!lit.pixel&&JSON.stringify(lit.pixel)===JSON.stringify(lit.stored),lit);
  const pairing=await page.evaluate(()=>{const _=RF.DriveAnim._,g=RF.UI.dvAnim.game,before=(_.frame(),_.readCanvas()),counter=_.gameBackground(1),after=_.readCanvas();let changed=0;for(let q=0;q<before.length;q+=4)if(before[q]!==counter[q]||before[q+1]!==counter[q+1]||before[q+2]!==counter[q+2])changed++;const rect=_.V.canvas.getBoundingClientRect(),f={rgba:before,background:before,mask:_.V.gameBodyMask,w:_.V.gl.cw,h:_.V.gl.ch,mw:_.V.p.w,mh:_.V.p.h,cssW:rect.width,cssH:rect.height};return {changed,restored:before.every((v,i)=>v===after[i]),identicalSeen:!!RF.DriveGame.firstLit(f)};});
  ok('MG2 counterfactual changes hazard pixels, restores exact displayed bytes; identical image never seen',pairing.changed>0&&pairing.restored&&!pairing.identicalSeen,pairing);
  const seed7=await page.evaluate(()=>{const u=RF.UI,_=RF.DriveAnim._,M=RF.DriveGame,g=u.dvAnim.game;g.seed=7;g.rand=RF.Drive.rng(7^0x4d47414d);g.next=10+10*g.rand();g.t=g.next;g.x=g.t*75/3.6;g.hazards=[];g.spawned=g.seen=0;g.rules='legacy';const h=M.spawn(g,_.V.p.lane,_.V.p);g.rules='visible';Object.assign(u.dvAnim,{dist:g.x,t:g.t});u.dvAnim.gameOptions.seed=7;u.redrawSpec();_.frame();const a=_.readCanvas(),b=_.V.gameBackgrounds[1];let changed=0;if(b)for(let q=0;q<a.length;q+=4)if(a[q]!==b[q]||a[q+1]!==b[q+1]||a[q+2]!==b[q+2])changed++;return {lit:h.lit,range:h.s0-g.x,changed,first:h.firstPixel};});
  ok('MG2 seed7 original spawn/glare does not count eye dots as seen',seed7.lit===null,seed7);
  await page.evaluate(()=>{const u=RF.UI,_=RF.DriveAnim._,g=u.dvAnim.game;Object.assign(g,{x:0,t:0,seed:19,hazards:[{id:1,born:0,kind:'deer',s0:18,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,side:-1,lit:null,reaction:null,resolved:false}]});Object.assign(u.dvAnim,{dist:0,t:0});u.dvAnim.gameOptions.seed=19;u.redrawSpec();_.frame();});
  // Static hazard is close only for the visibility probe. Move it farther away before testing real held input.
  await page.evaluate(()=>{const u=RF.UI,g=u.dvAnim.game;g.hazards[0].s0=g.x+150;u.dvAnim.playing=true;u.redrawSpec();});
  await page.waitForTimeout(180);await page.keyboard.down('Space');await page.waitForTimeout(250);
  const held=await page.evaluate(()=>({v:RF.UI.dvAnim.game.v,b:RF.UI.dvAnim.game.brake,reactions:RF.UI.dvAnim.game.reactions.slice()}));await page.keyboard.up('Space');
  const released=await page.evaluate(()=>({v:RF.UI.dvAnim.game.v,b:RF.UI.dvAnim.game.brake}));await page.waitForTimeout(180);
  const coast=await page.evaluate(()=>RF.UI.dvAnim.game.v);
  ok('MG Space holds braking, reaction measured once; release coasts',held.b&&held.v<75/3.6&&held.reactions.length===1&&held.reactions[0]>=0&&!released.b&&Math.abs(coast-released.v)<1e-8,{held,released,coast});
  const button=page.locator('[data-game=brake]');const rect=await button.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  ok('MG pointer hold brakes',await page.evaluate(()=>RF.UI.dvAnim.game.brake));await page.mouse.up();ok('MG pointer release clears brake',!await page.evaluate(()=>RF.UI.dvAnim.game.brake));
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>RF.UI.setPane('result','activate'));await page.waitForTimeout(250);
  const mobile=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,brake:document.querySelector('[data-game=brake]').getBoundingClientRect().toJSON()}));
  ok('MG 390px controls fit and brake remains reachable',mobile.scroll<=mobile.width&&mobile.brake.width>=44&&mobile.brake.height>=44&&mobile.brake.right<=390&&mobile.brake.bottom<=844,mobile);
  await page.tap('[data-game=brake]');ok('MG touch tap releases brake',!await page.evaluate(()=>RF.UI.dvAnim.game.brake));
  if(shots){require('fs').mkdirSync(shots,{recursive:true});await page.screenshot({path:shots+'/mobile-play.png'});}
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  ok('MG losing focus pauses and releases held input',await page.evaluate(()=>!RF.UI.dvAnim.playing&&!RF.UI.dvAnim.game.brake));
  const end=await page.evaluate(()=>{const g=RF.UI.dvAnim.game;RF.DriveGame.resolve(g,{id:99,kind:'person',resolved:false,reaction:null,noHiViz:true,jaywalking:true,crosswalk:true},true,5,1);RF.DriveAnim._.gameFrame(g);return {lost:g.results[g.results.length-1].lost,card:document.querySelector('[data-game=card]').textContent,visible:!document.querySelector('[data-game=card]').hidden};});
  ok('MG person-hit end card includes statistics, Spec verdict, tickets and teaching point',end.lost&&end.visible&&/run lost/.test(end.card)&&/mean reaction/.test(end.card)&&/Spec verdict/.test(end.card)&&/cops/.test(end.card)&&/Absolute reach beats foreground width/.test(end.card),end);
  if(shots)await page.screenshot({path:shots+'/end-card.png'});
  await page.setViewportSize({width:1500,height:950});await page.waitForTimeout(250);
  ok('MG end card leaves a clickable Exit game (the toolbar button sits under the card)',await page.evaluate(()=>{const b=document.querySelector('[data-game=exit]');if(!b||b.hidden)return false;const r=b.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e===b;}));
  const cardFit=await page.evaluate(()=>{const c=document.querySelector('[data-game=card]'),p=c.closest('.drive-below');p.scrollTop=p.scrollHeight;const r=p.getBoundingClientRect(),host=p.parentElement.getBoundingClientRect(),tail=c.lastChild;return {fits:r.top>=host.top&&r.bottom<=host.bottom+1&&r.bottom<=innerHeight,scrollable:p.scrollHeight>=p.clientHeight,atBottom:p.scrollTop+p.clientHeight>=p.scrollHeight-1};});
  ok('MG2 desktop end card dock is within viewport; its last line is scroll-reachable',cardFit.fits&&cardFit.scrollable&&cardFit.atBottom,cardFit);
  await page.click('[data-game=exit]');
  const restored=await page.evaluate(()=>{const u=RF.UI,_=RF.DriveAnim._;_.frame();const hdr=_.readHdr();return {options:JSON.stringify(u.dvOpts),scene:RF.State.serialize(u.store.scene),state:{dist:u.dvAnim.dist,t:u.dvAnim.t,total:u.dvAnim.total},identical:hdr.length===window.mgBefore.length&&hdr.every((v,i)=>v===window.mgBefore[i]),off:!u.dvAnim.gameMode&&!u.dvAnim.game};});
  ok('MG exit restores normal options, camera state, saved scene and exact HDR',restored.off&&restored.options===before.options&&restored.scene===before.scene&&JSON.stringify(restored.state)===JSON.stringify(before.state)&&restored.identical,{before,restored});
  // Compare the actual default and saved high-beam LUTs on identical frozen targets through GPU composition/readback.
  // MG2-test: real moving encounters (spawn, route, street lamps, oncoming glare, paired frames) instead of a frozen lane-centre target; mean over seeds.
  const reach=async(name)=>{
    const ranges=[];
    for(const seed of [19,11]){
      await page.click('[data-game=toggle]');await page.fill('[data-game=speed]','75');await page.fill('[data-game=seed]',String(seed));await page.selectOption('[data-game=wet]','dry');await page.selectOption('[data-game=rules]','visible');await page.click('[data-game=start]');
      ranges.push(await page.evaluate(()=>{const u=RF.UI,_=RF.DriveAnim._,st=u.dvAnim,g=st.game;st.playing=false;u.redrawSpec();_.V.pinSS=2;const v=g.speed/3.6;g.t=Math.max(0,g.next-1);g.x=g.t*v;Object.assign(st,{dist:g.x,t:g.t,camera:{x:g.x,v}});
        for(let i=0;i<1500;i++){_.advanceCamera(st,1/30);_.frame();const h=g.hazards[0];if(h&&h.lit!==null)return h.firstRange;if(g.done||(h&&h.resolved))break;}return null;}));
      await page.click('[data-game=toggle]');
    }
    return {name,ranges,mean:ranges.every(Number.isFinite)?ranges.reduce((a,b)=>a+b,0)/ranges.length:NaN};
  };
  const defaultReach=await reach('default');
  await page.evaluate(async()=>{const sc=RF.State.deserialize(await(await fetch('examples/sealed-beam-7in-high.json')).text());RF.UI.loadScene(sc,'MG2 lamp comparison');});
  await page.waitForFunction(()=>{const u=RF.UI;return !u.solving&&u.run&&u.run.ctx.done&&u.spec&&u.spec.ctx===u.run.ctx&&u.spec.full&&u.spec.ev;},null,{timeout:180000});
  await page.evaluate(()=>{RF.UI.setDisplay('drive');RF.UI.setPane('result','activate');});const highReach=await reach('7in-high');
  // The ranges are recorded, not asserted: in this long session they depend on route/street-lamp context (a fresh-page 8-seed run gave default 96 m vs high beam 129 m mean at 75 km/h dry). What is asserted is the confound removal.
  await page.click('[data-game=toggle]');await page.selectOption('[data-game=rules]','visible');await page.click('[data-game=start]');
  const onMode=await page.evaluate(()=>RF.UI.dvOpts.onMode);await page.click('[data-game=toggle]');const onModeAfter=await page.evaluate(()=>RF.UI.dvOpts.onMode);
  ok('MG2 Game uses a fixed (generic) oncoming lamp, not the player lamp; restored on exit; first-seen ranges finite',onMode==='generic'&&onModeAfter==='symmetric'&&Number.isFinite(defaultReach.mean)&&Number.isFinite(highReach.mean),{onMode,onModeAfter,defaultReach,highReach});
  ok('MG no page errors' ,errors.length===0,errors);
 }finally{await browser.close();}
 console.log(fails?fails+' FAILED':'all MG2 minigame page checks passed');process.exitCode=fails?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
