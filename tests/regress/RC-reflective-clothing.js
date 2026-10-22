// RC-reflective-clothing: the opt-in reflectiveClothing option. Low beam, the road scene's dark-clothed pedestrian at 55 m (the only dark walker there).
// (1) off: the canvas PNG hashes to the value captured on main (313d95b) with this file's viewport and flags, so off is byte-identical to main.
// (2) all (measured 2026-10-22, real GPU, low beam, 55 m: 6 changed pixels, all brighter; the threshold is 1, set after that measurement, so this is a presence check, not a size check): the pixels that differ from off are brighter (tape and shoe reflectors light up), no pixel gets darker, and there is a visible number of them.
// (3) off again after all: identical to the first off frame (the option is re-read, nothing is stuck).
// Real GPU flags. samples is pinned to '1' (not 'auto'): on canvases up to 1100 px wide, 'auto' supersampling follows measured frame time (drive-anim.js ssRule, V.avg), so a loaded machine can change the picture between frames of the same scene. Pinned, the frames are deterministic. Run: node tests/regress/RC-reflective-clothing.js 8831   (server: python3 tests/serve.py 8831)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8831);
const OFF_MAIN = '6b992d949c40bce7ed7d9644cbd845c538b699bdc66392a22c619c6b046adb47';   // sha256 of the canvas PNG on main 313d95b, viewport 2200x1200
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; };

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 2200, height: 1200 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene, null, { timeout: 60000 });
  await page.evaluate((text) => RF.UI.loadScene(RF.State.deserialize(text), 'RC fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
  await page.waitForFunction(() => { const u = RF.UI; return u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx; }, null, { timeout: 180000, polling: 200 });
  await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false });
    Object.assign(u.dvOpts, { scene: 'road', people: true, animals: false, signs: false, posts: false, veg: false, rpm: false, wild: false, tiles: false, obstacle: false, trafficLogic: false, oncoming: false, preceding: false, wet: false, wetSheen: false, samples: '1', gpuRenderer: true, mt: false, onMode: 'symmetric', reflectiveClothing: 'off' }); u.redrawSpec(); });
  await page.waitForSelector('[data-anim="play"]', { timeout: 30000 });
  await sleep(4000);
  console.log('renderer (real GPU flags): ' + await page.evaluate(() => RF.DriveAnim.stats().renderer));
  const shot = async () => {
    await sleep(4000);
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-rc', '1'));
    return (await page.locator('canvas[data-rc="1"]').screenshot()).toString('base64');
  };
  const setOpt = async (m) => { await page.evaluate((v) => { RF.UI.dvOpts.reflectiveClothing = v; RF.UI.redrawSpec(); }, m); };
  const offA = await shot();
  const hashOff = crypto.createHash('sha256').update(Buffer.from(offA, 'base64')).digest('hex');
  ok('off equals main (canvas PNG sha256)', hashOff === OFF_MAIN, hashOff.slice(0, 16));
  await setOpt('all'); const all = await shot();
  // decode both in the page and compare pixels: changed pixels must only get brighter
  const cmp = await page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s; });
    const px = async (s) => { const i = await load(s), c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: g.getImageData(0, 0, i.width, i.height).data }; };
    const A = await px(a), B = await px(b); let changed = 0, brighter = 0, darker = 0, dA = 0, dB = 0;
    for (let k = 0; k < A.d.length; k += 4) {
      const la = A.d[k] + A.d[k + 1] + A.d[k + 2], lb = B.d[k] + B.d[k + 1] + B.d[k + 2];
      if (la !== lb) { changed++; if (lb > la) { brighter++; dB += lb - la; } else { darker++; dA += la - lb; } }
    }
    return { w: A.w, h: A.h, changed, brighter, darker, meanGain: brighter ? dB / brighter : 0 };
  }, [offA, all]);
  console.log('compare off vs all: ' + JSON.stringify(cmp));
  ok('all changes some pixels (the walker\'s tape and shoe reflectors)', cmp.changed >= 1, cmp.changed + ' px');
  ok('changed pixels only get brighter', cmp.darker === 0, cmp.darker + ' darker');
  await setOpt('off'); const offB = await shot();
  ok('off again equals the first off frame', offB === offA);
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'RC-reflective-clothing: all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
