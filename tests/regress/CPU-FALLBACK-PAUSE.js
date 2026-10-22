// CPU-FALLBACK-PAUSE: a GPU failure while driving pauses the sim and says so; a failure while paused keeps the old notice;
// Drive afterwards runs on the CPU with no re-pause; deliberate CPU (gpuRenderer off) keeps driving.
// The GPU module import is aborted with page.route, so the failure is the real gpuFallback path (import rejects -> gpuFallback).
// node tests/regress/CPU-FALLBACK-PAUSE.js [port]   (needs: python3 tests/serve.py <port>)
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8791);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OLD_NOTICE = /^GPU drive unavailable \(.+\); using CPU renderer\.$/;

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async (initGpu) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => localStorage.clear());
    await page.route('**/js/drive-three.js', (r) => r.abort());          // the GPU module cannot load: a real import failure
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene, null, { timeout: 60000 });
    await page.evaluate((text) => RF.UI.loadScene(RF.State.deserialize(text), 'CPU-fallback fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.waitForFunction(() => { const u = RF.UI; return u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx; }, null, { timeout: 180000, polling: 200 });
    await page.evaluate((gpu) => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false }); u.dvOpts.samples = 'auto'; u.dvOpts.gpuRenderer = gpu; u.redrawSpec(); }, initGpu);
    await page.waitForSelector('[data-anim="play"]', { timeout: 30000 });
    return { page, errors };
  };
  const state = (page) => page.evaluate(() => {
    const u = RF.UI, a = RF.DriveAnim.stats(), play = document.querySelector('[data-anim="play"]'), note = document.querySelector('[data-anim="notice"]');
    return { playing: !!(u.dvAnim && u.dvAnim.playing), running: a.running, frames: a.frames, renderer: a.renderer, gpuFailure: a.gpuFailure, notice: note ? note.textContent : '', play: play ? play.textContent : '' };
  });
  const renderer = (page) => page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'), e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const clickPlay = (page) => page.evaluate(() => document.querySelector('[data-anim="play"]').click());
  const clickGpu = (page) => page.evaluate(() => document.querySelector('[data-anim="gpu-renderer"]').click());
  const waitFor = (page, pred, ms) => page.waitForFunction(pred, null, { timeout: ms, polling: 100 }).then(() => true, () => false);

  // ---- A: GPU wanted, sim driving when the GPU import fails -> pause + notice; then Drive, retry, Drive again
  {
    const { page, errors } = await open(false);
    console.log('renderer (headless, real GPU flags): ' + await renderer(page));
    await clickPlay(page); await sleep(1200);
    const driving = await state(page);
    ok('A0 CPU drive (gpuRenderer off) is running before the GPU is asked for', driving.playing && driving.running && driving.renderer === 'cpu', JSON.stringify(driving));
    await clickGpu(page);                                                  // turn the GPU on while driving: the import rejects
    const paused = await waitFor(page, () => !RF.UI.dvAnim.playing, 8000) && await state(page);
    ok('A1 failure while driving: sim paused', paused && !paused.playing && !paused.running, JSON.stringify(paused));
    ok('A2 failure while driving: notice says Paused and Drive resumes', paused && /using CPU renderer\. Paused: press Drive to continue on the slower CPU renderer\./.test(paused.notice), paused && paused.notice);
    ok('A3 play button reads Drive (in sync with the pause)', paused && paused.play.includes('Drive') && !paused.play.includes('Pause'), paused && paused.play);
    await clickPlay(page); await sleep(1500);
    const resumed = await state(page);
    ok('A4 Drive after the failure runs on the CPU, frames advance, no re-pause', resumed.playing && resumed.running && resumed.renderer === 'cpu' && resumed.frames > driving.frames, JSON.stringify({ playing: resumed.playing, running: resumed.running, renderer: resumed.renderer, frames: [driving.frames, resumed.frames] }));
    ok('A5 once driving again the stale "Paused:" half is dropped from the notice', OLD_NOTICE.test(resumed.notice), resumed.notice);
    await sleep(1500);
    const still = await state(page);
    ok('A6 keeps driving for 1.5 s more (no loop pausing it)', still.playing && still.running, JSON.stringify({ playing: still.playing, running: still.running }));
    await page.close();
    ok('A7 no page errors', errors.length === 0, errors.join(' | '));
  }

  // ---- B: sim already paused when the GPU import fails -> old notice, still paused; retry-while-failed path
  {
    const { page, errors } = await open(false);
    await clickGpu(page);                                                  // GPU on while paused: import rejects while paused
    await sleep(1500);
    const s = await state(page);
    ok('B1 failure while paused: old notice unchanged, still paused', !s.playing && !s.running && OLD_NOTICE.test(s.notice), JSON.stringify({ playing: s.playing, notice: s.notice }));
    await clickGpu(page);                                                  // the failed-GPU click is the retry path: it re-imports, which fails again
    await sleep(1500);
    const r = await state(page);
    ok('B2 retry while paused fails again, still paused, old notice', !r.playing && !r.running && OLD_NOTICE.test(r.notice), JSON.stringify({ playing: r.playing, notice: r.notice }));
    await clickPlay(page); await sleep(1200);
    const d = await state(page);
    ok('B3 Drive after a paused failure runs on the CPU with no re-pause', d.playing && d.running && d.renderer === 'cpu' && d.frames > r.frames, JSON.stringify({ playing: d.playing, running: d.running, frames: [r.frames, d.frames] }));
    await page.close();
    ok('B4 no page errors', errors.length === 0, errors.join(' | '));
  }

  // ---- C: deliberate CPU (gpuRenderer off) while driving -> never pauses, no GPU notice
  {
    const { page, errors } = await open(false);
    await clickPlay(page); await sleep(2500);
    const c = await state(page);
    ok('C1 deliberate CPU keeps driving (no GPU failure, no pause)', c.playing && c.running && c.renderer === 'cpu' && c.gpuFailure === '' && !/unavailable|Paused/.test(c.notice), JSON.stringify({ playing: c.playing, running: c.running, gpuFailure: c.gpuFailure, notice: c.notice }));
    await page.close();
    ok('C2 no page errors', errors.length === 0, errors.join(' | '));
  }

  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
