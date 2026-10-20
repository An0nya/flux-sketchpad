// SH2: browser mode for tests/scenario/run.js. Needs tests/serve.py on a port and Playwright (PLAYWRIGHT env, default the agent-qa install).
// Options reach the page the way the UI stores them: written to localStorage 'flux/driveView' before the page loads (spec-ui.js dvOpts reads it).
// Beams are picked through the own-beam <select> change handler, the same as a click.
// Frames: frame f sits at dist = pos + speed * f / 30 and t = f / 30. The page is stepped through every frame up to the last capture
// (the IDM traffic logic is stateful, so skipping frames would change it); only capture frames are screenshotted.
// Hashes are sha256 of the screenshot PNG. The whole pass is run a second time in the same session and must hash the same.
const crypto = require('crypto');
const run = require('./run.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETUP_FLAGS = { playing: false, fpsCounter: false, debugTimings: false, sceneDetails: false, dynamicResolution: false };

// ---- page-side functions. Playwright serializes each one alone, so each is self-contained and takes its arguments explicitly.
async function pageReady() {
  const u = RF.UI, sl = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sl(100);
  if (RF.SolverHost.loading() || u.solving) throw Error('SH startup solver did not finish');
  u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'SH fixture');
  u.setMode('D');
  for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sl(100);
  if (!(u.spec && u.spec.ev && u.spec.full)) throw Error('SH lamp trace did not finish');
  u.setDisplay('drive'); u.setPane('result', 'activate');
  Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false });
  u.redrawSpec();
  for (let i = 0; i < 200 && RF.DriveAnim.stats().renderer !== 'three' && !RF.DriveAnim.stats().gpuFailure; i++) await sl(50);
  RF.DriveAnim._.V.pinSS = 1;   // freeze the render scale, so no dynamic-resolution step changes the frame
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  return { renderer: RF.DriveAnim.stats().renderer, gpuFailure: RF.DriveAnim.stats().gpuFailure || '' };
}

// args: [dist, t]. Draws one frame and waits until the page has counted it and presented it.
async function pageDraw([dist, t]) {
  const A = RF.DriveAnim._, st = A.S(RF.UI), n0 = A.V.frames;
  st.dist = dist; st.t = t; A.frame();
  for (let i = 0; i < 400 && A.V.frames <= n0; i++) await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  return A.V.frames > n0;
}

// Tags the drive canvas so the test can screenshot exactly that element.
function pageTag() { RF.DriveAnim._.V.canvas.setAttribute('data-sh-drive', '1'); return true; }

// The element screenshot paints whatever sits over the canvas (the toolbar, the readouts), so hide those for the capture and restore after.
function pageHide(on) {
  const V = RF.DriveAnim._.V, host = V.canvas.parentElement, els = new Set([RF.UI.driveBar, RF.UI.driveExtras]);
  for (const e of host.children) if (e !== V.canvas) els.add(e);
  for (const e of els) {
    if (!e) continue;
    if (on) { e.dataset.shVis = e.style.visibility; e.style.visibility = 'hidden'; }
    else if (e.dataset.shVis !== undefined) { e.style.visibility = e.dataset.shVis; delete e.dataset.shVis; }
  }
  return els.size;
}

// name: a library id or label. Finds it in the own-low or own-high select and fires its change handler.
function pageBeam(name) {
  for (const [sel, key, kind] of [[document.querySelector('[data-anim=own-low]'), 'ownLow', 'low'], [document.querySelector('[data-anim=own-high]'), 'ownHigh', 'high']]) {
    if (!sel) continue;
    const opt = [...sel.options].find((o) => o.value === name || o.textContent.trim() === name || o.textContent.includes(name));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); return { key, kind, value: opt.value }; }
  }
  return null;
}
function pageBeamOptions() {
  const labels = (sel) => (sel ? [...sel.options].map((o) => o.textContent.trim()) : []);
  return { low: labels(document.querySelector('[data-anim=own-low]')), high: labels(document.querySelector('[data-anim=own-high]')) };
}

// base64 PNG → base64 of the RGB bytes (w, h returned), so frameStats() in Node measures the same pixels for both modes.
async function pageRGB(png64) {
  const bytes = Uint8Array.from(atob(png64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; }
  let s = ''; const CH = 0x8000; for (let i = 0; i < rgb.length; i += CH) s += String.fromCharCode.apply(null, rgb.subarray(i, i + CH));
  return { w: c.width, h: c.height, b64: btoa(s) };
}

function pageCounters() {
  const st = RF.DriveAnim.stats();
  return { renderer: st.renderer, gpuFailure: st.gpuFailure || '', SD_SCATTER: globalThis.SD_SCATTER ? Object.assign({}, globalThis.SD_SCATTER) : null };
}

// One pass over the frames: returns { captureName: { frame, png } }.
async function pass(page, s) {
  const wanted = new Map(s.capture.map((c) => [c.frame, c.name])), last = Math.max(...wanted.keys());
  const out = {};
  for (let f = 0; f <= last; f++) {
    const { dist, t } = run.frameClock(s, f);
    const drawn = await page.evaluate(pageDraw, [dist, t]);
    if (!drawn) throw new Error(s.name + ': frame ' + f + ' was not counted by the page (no render)');
    if (!wanted.has(f)) continue;
    await page.evaluate(pageTag);
    await page.evaluate(pageHide, true);
    try { out[wanted.get(f)] = { frame: f, png: await page.locator('canvas[data-sh-drive="1"]').screenshot() }; }
    finally { await page.evaluate(pageHide, false); }
  }
  return out;
}

async function runOne(browser, s, port, dv) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  try {
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    // the stored drive view the page reads on load: defaults, the scenario's options, its top-level fields and the fixed setup flags
    const stored = Object.assign({}, dv, SETUP_FLAGS, s.options, { scene: s.scene, seed: s.seed, speed: s.speed });
    await page.addInitScript((json) => { try { localStorage.setItem('flux/driveView', json); } catch (e) { /* ignore */ } }, JSON.stringify(stored));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    const ready = await page.evaluate(pageReady);
    const beams = [];
    for (const name of s.beams) {
      let hit = null;
      for (let i = 0; i < 150 && !hit; i++) { hit = await page.evaluate(pageBeam, name); if (!hit) await sleep(100); }
      if (!hit) { const have = await page.evaluate(pageBeamOptions); throw new Error(s.name + ': beams: no library entry matches "' + name + '" (own-low: ' + JSON.stringify(have.low) + ', own-high: ' + JSON.stringify(have.high) + ')'); }
      beams.push({ name, key: hit.key, value: hit.value });
    }
    const first = await pass(page, s);
    const rerun = await pass(page, s);
    const counters = await page.evaluate(pageCounters);
    const captures = [];
    for (const c of s.capture) {
      const png = first[c.name].png, hash = crypto.createHash('sha256').update(png).digest('hex');
      const rgb = await page.evaluate(pageRGB, png.toString('base64'));
      const stats = run.frameStats(Buffer.from(rgb.b64, 'base64'), rgb.w, rgb.h, s.regions);
      const { dist, t } = run.frameClock(s, c.frame);
      const rerunSame = crypto.createHash('sha256').update(rerun[c.name].png).digest('hex') === hash;
      captures.push(Object.assign({ name: c.name, frame: c.frame, dist: +dist.toFixed(3), t: +t.toFixed(4), hash, rerunSame, png }, stats));
    }
    const extra = Object.assign({}, counters, { ready, beams, errors: errors.slice(0, 5), rerunSame: captures.every((c) => c.rerunSame) });
    return run.writeOut(s, 'browser', captures, extra);
  } finally { await context.close(); }
}

// One browser for the whole list, a fresh context per scenario (so no stored state leaks between scenarios).
async function runBrowserAll(list, port, dv) {
  const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const outs = [];
    for (const s of list) outs.push(await runOne(browser, s, port, dv));
    return outs;
  } finally { await browser.close(); }
}

module.exports = { runBrowserAll };
