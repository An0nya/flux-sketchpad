// RC-reflective-clothing (PED-CLOTHING-MODES): the four pedestrian clothing modes none | mix | small | vest, on the road scene (3 walkers: dark at 55 m,
// hi-vis vest at 95 m, light at 32 m, seed 7). Real GPU flags. samples is pinned to '1' (not 'auto'): on canvases up to 1100 px wide, 'auto'
// supersampling follows measured frame time (drive-anim.js ssRule, V.avg), so a loaded machine can change a frame between shots.
// (1) data, from RF.Drive.buildScene (no pixels): none has no vests and no strips; mix has the scene's one vest and strips on at most the other two walkers;
//     small has strips on all three non-vest walkers and no vest; vest has three vests and no strips; unset and off equal mix; all equals small;
//     the same seed builds the same clothing twice; the palette gives at least two different colours across the walkers.
// (2) pixels, the drive view: the none, mix, small and vest frames are not all the same; a second none frame after the others equals the first (nothing stuck);
//     the wild scenery's none and vest frames differ (its walkers are chunk actors, placed each frame, so they are checked by pixels, not by objects).
// (3) no page errors.
// Run: node tests/regress/RC-reflective-clothing.js 8831   (server: python3 tests/serve.py 8831)
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8831);
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

  // (1) data
  const data = await page.evaluate(() => {
    const build = (m) => RF.Drive.buildScene('road', { Lw: 3.5, A: null, us: true, seed: 7, reflectiveClothing: m }, { people: true, animals: false, signs: false, posts: false, veg: false }).objects;
    const isVest = (o) => typeof o.mat === 'function' && String(o.mat).includes('hivis');
    const isStrip = (o) => o.mat === 'hivis-tape';
    const count = (objs) => ({ vests: objs.filter(isVest).length, strips: objs.filter(isStrip).length, plainHivis: objs.filter((o) => o.mat === 'hivis').length });
    const mats = (objs) => objs.map((o) => (typeof o.mat === 'function' ? String(o.mat) : o.mat)).join('|');
    const palette = (objs) => [...new Set(objs.map((o) => o.mat).filter((m) => typeof m === 'string' && m.startsWith('cp-')))];
    const out = { none: build('none'), mix: build('mix'), small: build('small'), vest: build('vest'), off: build('off'), all: build('all'), unset: build(undefined), mixAgain: build('mix') };
    const res = {};
    for (const k of Object.keys(out)) res[k] = count(out[k]);
    res.palette = palette(out.none);
    res.sameSeedRepeats = mats(out.mix) === mats(out.mixAgain);
    res.offIsMix = mats(out.off) === mats(out.mix); res.unsetIsMix = mats(out.unset) === mats(out.mix);
    res.allIsSmall = mats(out.all) === mats(out.small);
    return res;
  });
  console.log('data: ' + JSON.stringify(data));
  ok('none: no vests, no strips, no plain hi-vis', data.none.vests === 0 && data.none.strips === 0 && data.none.plainHivis === 0);
  ok('mix: the scene\'s one vest, strips on at most two walkers', data.mix.vests === 1 && data.mix.strips <= 2 * 4 && data.mix.strips % 4 === 0, 'strip boxes ' + data.mix.strips);
  ok('small: no vests, strips on all three non-vest walkers', data.small.vests === 0 && data.small.strips === 3 * 4, 'strip boxes ' + data.small.strips);
  ok('vest: three vests, no strips', data.vest.vests === 3 && data.vest.strips === 0, JSON.stringify(data.vest));
  ok('off (saved value) builds as mix', data.offIsMix);
  ok('unset builds as mix (the default)', data.unsetIsMix);
  ok('all (saved value) builds as small', data.allIsSmall);
  ok('the same seed builds the same clothing twice', data.sameSeedRepeats);
  ok('the palette gives at least two colours across the walkers', data.palette.length >= 2, data.palette.join(','));

  // (2) pixels: drive view, low beam, the same pose for each mode
  await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false });
    Object.assign(u.dvOpts, { scene: 'road', people: true, animals: false, signs: false, posts: false, veg: false, rpm: false, wild: false, tiles: false, obstacle: false, trafficLogic: false, oncoming: false, preceding: false, wet: false, wetSheen: false, samples: '1', gpuRenderer: true, mt: false, onMode: 'symmetric', reflectiveClothing: 'mix' }); u.redrawSpec(); });
  await page.waitForSelector('[data-anim="play"]', { timeout: 30000 });
  await sleep(4000);
  console.log('renderer (real GPU flags): ' + await page.evaluate(() => RF.DriveAnim.stats().renderer));
  const shot = async () => {
    await sleep(4000);
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-rc', '1'));
    return (await page.locator('canvas[data-rc="1"]').screenshot()).toString('base64');
  };
  const setOpt = async (m) => { await page.evaluate((v) => { RF.UI.dvOpts.reflectiveClothing = v; RF.UI.redrawSpec(); }, m); };
  const frames = {};
  for (const m of ['none', 'mix', 'small', 'vest']) { await setOpt(m); frames[m] = await shot(); }
  await setOpt('none'); const noneAgain = await shot();
  const same = (a, b) => a === b;
  ok('the none frame is the same after the other three modes', same(frames.none, noneAgain));
  ok('the four modes do not all draw the same frame', !(same(frames.none, frames.mix) && same(frames.mix, frames.small) && same(frames.small, frames.vest)));
  ok('vest differs from none', !same(frames.none, frames.vest));
  // wild scenery (random chunks; their walkers are the chunk actors, placed per frame): none and vest must draw differently
  await setOpt('none'); await page.evaluate(() => { RF.UI.dvOpts.wild = true; RF.UI.redrawSpec(); }); const wildNone = await shot();
  await setOpt('vest'); const wildVest = await shot();
  ok('wild scenery: none and vest draw differently', !same(wildNone, wildVest));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'RC-reflective-clothing: all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
