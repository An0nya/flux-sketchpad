// Builder: syntax-check only. Tester: node tests/regress/D4-drive-tiles.js 8733 [--shots /tmp/D4-shots]
// D4_REAL_GPU=1 selects installed Chromium; software GL is allowed for correctness checks.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const args = process.argv.slice(2), port = +(args.find((a) => /^\d+$/.test(a)) || 8733), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.D4_REAL_GPU ? { channel: 'chromium' } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e))); await page.addInitScript(() => localStorage.clear());
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    const identity = await page.evaluate((p) => !!RF.UI && !!RF.DriveAnim && location.port === String(p), port);
    ok('Flux page identity and port ' + port, identity); if (!identity) throw Error('wrong page');
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.evaluate(() => RF.UI.setMode('D'));
    await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => { RF.UI.setDisplay('drive'); RF.UI.setPane('result', 'activate'); }); await sleep(700);
    const saved = await page.evaluate(() => RF.State.serialize(RF.UI.store.scene));
    await page.evaluate(() => { const u = RF.UI; Object.assign(u.dvOpts, { scene: 'road', tiles: false, mt: true, seed: 7, oncoming: false, preceding: false, glare: 0.3 }); Object.assign(u.dvAnim, { view: 'anim', playing: false, dist: 40, total: 0, t: 0 }); u.redrawSpec(); RF.DriveAnim._.V.pinSS = 1; }); await sleep(500);
    ok('traffic off hides flash count and reset; gap guard is default-on', await page.evaluate(() => ['flashes','reset-flashes'].every((k) => getComputedStyle(document.querySelector('[data-anim="'+k+'"]')).display === 'none') && RF.UI.dvOpts.safeGap && document.querySelector('[data-anim="gap"]').getAttribute('aria-pressed') === 'true'));
    // Save the actual old-path image, then exercise the UI and compare after returning to the same position.
    await page.evaluate(() => { RF.DriveAnim._.frame(); window.d4OffHdr = RF.DriveAnim._.readHdr(); });
    await page.click('[data-anim="tiles"]'); await sleep(500);
    ok('tiles button enables a seeded route and its controls without touching the still scene', await page.evaluate(() => RF.UI.dvOpts.tiles && RF.DriveAnim._.V.src.tiles && RF.DriveAnim._.V.p.w === 640 && !document.querySelector('[data-anim="street-lamps"]').disabled && getComputedStyle(document.querySelector('[data-anim="street-lamps"]')).pointerEvents === 'auto' && document.querySelector('[data-anim="tiles"]').getAttribute('aria-pressed') === 'true'));
    const parity = await page.evaluate(async () => {
      const D = RF.DriveAnim, _ = D._, u = RF.UI; let worst = 0, n = 0, workers = true, rgbError = 0;
      Object.assign(u.dvOpts, { oncoming: true, preceding: true }); u.redrawSpec();
      for (const scene of ['road','forest','city','intersection']) for (const [dist,t] of [[40,0],[1060,13],[1860,30]]) {
        u.dvOpts.scene = scene; Object.assign(u.dvAnim, { dist,t,playing:false }); u.redrawSpec(); _.frame(); const a = _.readHdr(), raw = _.V.rgba;
        for (let i=0;i<a.length;i++) if (i%4!==3) rgbError = Math.max(rgbError, Math.abs(a[i]-raw[i]) / Math.max(0.01, Math.abs(raw[i])));
        workers = await _.frameMT(dist,t) && workers; const b = _.readHdr();
        for (let i=0;i<a.length;i++) { worst=Math.max(worst,Math.abs(a[i]-b[i])); n++; }
      }
      return { worst,n,workers,rgbError,fail:D.stats().mtFail };
    });
    ok('worker HDR = main-thread HDR across moving tiles in all four scenes', parity.workers && !parity.fail && parity.n > 100000 && parity.worst === 0, JSON.stringify(parity));
    ok('opaque dynamic frame reaches GL without adding cached ground or duplicating markings', parity.rgbError < 0.0011, 'worst relative RGB storage error ' + parity.rgbError);
    await page.evaluate(() => { const u=RF.UI; Object.assign(u.dvOpts,{scene:'road',oncoming:false,preceding:false}); Object.assign(u.dvAnim,{dist:40,t:0,playing:false}); u.redrawSpec(); });
    const lights = [];
    for (const mode of ['off','sodium','led']) {
      await page.selectOption('[data-anim="street-lamps"]', mode); await sleep(150);
      lights.push(await page.evaluate(() => { const _=RF.DriveAnim._; _.frame(); return { mode:RF.UI.dvOpts.streetLamps, lights:RF.DriveAnim.tileWorld(_.V.p,40,0).lights.length, hdr:Array.from(_.readHdr()).reduce((s,x,i)=>s+(i%4===3?0:x),0) }; }));
    }
    ok('lamp selector removes light sources, adds warm ones, then changes colour', lights[0].lights===0 && lights[1].lights>0 && lights[2].lights>0 && lights[1].hdr!==lights[2].hdr && lights[0].hdr!==lights[1].hdr, JSON.stringify(lights));
    await page.click('[data-anim="tiles"]'); await sleep(300);
    const restored = await page.evaluate(() => { const _=RF.DriveAnim._; _.frame(); const a=_.readHdr(); let worst=0; for(let i=0;i<a.length;i++) worst=Math.max(worst,Math.abs(a[i]-window.d4OffHdr[i])); return {worst,tiles:!!_.V.src.tiles}; });
    ok('tiles OFF restores the exact pre-toggle HDR picture', !restored.tiles && restored.worst===0, JSON.stringify(restored));
    await page.click('[data-dv="preceding"]'); await sleep(150);
    ok('traffic on shows counter/reset', await page.evaluate(() => ['flashes','reset-flashes'].every((k)=>!document.querySelector('[data-anim="'+k+'"]').hidden)));
    const guard = await page.evaluate(async () => {
      const u=RF.UI,D=RF.DriveAnim,_=D._; const car=D.trafficCars(_.V.src,0,0).find((c)=>c.kind==='preceding'); u.dvAnim.dist=car.rel-10; u.dvAnim.t=0; _.frame();
      const guarded=D.trafficCars(_.V.src,u.dvAnim.dist,0).every((c)=>c.kind!=='preceding'||c.rel>=25);
      // The speed range uses the quiet setting path: exercise its real input event, then a worker frame.
      const e=document.querySelector('[data-anim="speed"]'); e.value='130'; e.dispatchEvent(new Event('input',{bubbles:true}));
      await _.frameMT(u.dvAnim.dist,0); return {guarded,speed:_.V.src.traffic.speed,failed:D.stats().mtFail};
    });
    ok('gap guard applies at a would-be close pass; live speed input reaches workers', guard.guarded && guard.speed===130 && !guard.failed, JSON.stringify(guard));
    await page.click('[data-anim="gap"]'); await sleep(150);
    ok('gap guard off restores the original close car', await page.evaluate(() => RF.UI.dvOpts.safeGap===false && RF.DriveAnim.trafficCars(RF.DriveAnim._.V.src,RF.UI.dvAnim.dist,0).some((c)=>c.kind==='preceding'&&c.rel<25)));
    await page.click('[data-anim="gap"]'); await page.click('[data-anim="tiles"]');
    await page.evaluate(() => { const u=RF.UI; Object.assign(u.dvOpts,{speed:50,oncoming:true,preceding:true}); Object.assign(u.dvAnim,{dist:199.5,t:10,playing:true}); u.redrawSpec(); }); await sleep(1000);
    const progress = await page.evaluate(() => ({d:RF.UI.dvAnim.dist,n:RF.UI.dvAnimFrames})); await sleep(1500);
    ok('fresh worker frames continue across tile boundaries with traffic', await page.evaluate((b)=>RF.UI.dvAnim.dist>b.d && RF.UI.dvAnimFrames>b.n && RF.DriveAnim.stats().workers>0 && !RF.DriveAnim.stats().mtFail,progress));
    await page.evaluate(() => { RF.UI.dvAnim.playing=false; RF.UI.redrawSpec(); });
    if (shots) {
      require('fs').mkdirSync(shots,{recursive:true}); await page.click('[data-anim="popout"]'); await sleep(300);
      for (const kind of ['straight','250R','150L','intersection','t-junction','urban']) {
        await page.evaluate((kind) => { const D=RF.DriveAnim,u=RF.UI,tile=Array.from({length:160},(_,k)=>D.roadTile(7,k)).find((t)=>t.kind===kind); Object.assign(u.dvAnim,{dist:tile.s0+60,t:(50-tile.phase)%50,playing:false}); u.redrawSpec(); },kind);
        await page.screenshot({path:shots+'/'+kind+'.png'});
      }
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:390,height:844}); await page.evaluate(()=>RF.UI.setPane('result','activate')); await sleep(500);
    ok('390 px toolbar fits without horizontal overflow', await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(shots) await page.screenshot({path:shots+'/mobile.png'});
    ok('tile preferences leave saved optical scene unchanged', saved===await page.evaluate(()=>RF.State.serialize(RF.UI.store.scene)));
    ok('no page errors',errors.length===0,errors.join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails+' FAILED' : 'all D4 tiles page checks passed'); process.exitCode=fails?1:0;
})().catch((e)=>{console.error(e);process.exitCode=1;});
