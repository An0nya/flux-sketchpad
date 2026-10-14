// F1: GPU trace is on by default (explicit '0' wins); a small device gets a ray cap, shown in the footer, liftable.
// node tests/regress/F1-gpu-default.js [port]   (needs: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8721);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
  const open = async (init) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }); page.on('pageerror', (e) => console.log('pageerror', e));
    await page.addInitScript(init || (() => {}));
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.run, null, { timeout: 60000 });
    const where = await page.evaluate(() => ({ ui: !!(window.RF && RF.UI), port: location.port })); if (!where.ui || +where.port !== port) throw new Error('wrong page ' + JSON.stringify(where));
    return page;
  };
  const read = (page) => page.evaluate(async () => { await RF.GpuTrace.init(); return { avail: RF.GpuTrace.available(), ready: RF.GpuTrace.ready(), pref: RF.GpuTrace.pref(), N: RF.UI.run.ctx.N, asked: RF.UI.store.scene.sim.rays, capped: !!RF.UI.run.capped, foot: document.getElementById('stats').textContent + ' ' + (document.getElementById('stats-bar') ? '' : '') }; });
  let p = await open(); let r = await read(p);
  ok('no stored choice: GPU pref follows WebGPU availability, device is ready', r.pref === r.avail && (!r.avail || r.ready), JSON.stringify({ avail: r.avail, ready: r.ready, pref: r.pref }));
  ok('desktop: not capped, full scene ray count', r.N === r.asked && !r.capped, 'N ' + r.N);
  await p.close();
  p = await open(() => localStorage.setItem('flux/gpu', '0')); r = await read(p);
  ok('explicit off in localStorage stays off', r.pref === false);
  await p.close();
  p = await open(() => Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true })); r = await read(p);
  ok('2 GB device: ray count clamped to 100,000 and flagged', r.N === 100000 && r.asked > 100000 && r.capped, 'N ' + r.N + ' of ' + r.asked);
  await p.waitForFunction(() => RF.UI.run.ctx.done && !RF.UI.solving, null, { timeout: 90000 }); await p.waitForTimeout(500);
  const foot = await p.evaluate(() => { RF.UI.rerenderStats(); return { stat: document.getElementById('stats').innerText, tile: [...document.querySelectorAll('.tile.rays')].map((e) => e.innerText + ' | ' + e.querySelector('span').title).join(' ; ') }; });
  ok('footer says it was capped (stats line + tile marker)', /capped from 500,000/.test(foot.stat) && /rays\*/.test(foot.tile), foot.stat.slice(0, 160) + ' || ' + foot.tile.slice(0, 200));
  await p.close();
  p = await open(() => { Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true }); localStorage.setItem('flux/rayCap', 'off'); }); r = await read(p);
  ok('user lifted the cap: full count again', r.N === r.asked && !r.capped, 'N ' + r.N);
  await p.close(); await browser.close();
  process.exitCode = fails ? 1 : 0;
})();
