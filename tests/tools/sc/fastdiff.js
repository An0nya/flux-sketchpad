// SC: off vs fast (and exact) at the four poses: the table difference (the cumulative table the lookup reads: max and mean absolute difference, and the largest relative to the off table's own largest texel),
// the frame difference (pixels changed, largest channel step, mean absolute step), and the shots. One JSON line per run is appended as it is taken.
// Usage: PLAYWRIGHT=... node tests/tools/sc/fastdiff.js <port> <out.jsonl> <shotsDir> [--eps 1e-2,1e-1,1] [--bins 24] [--opts '{"visibility":300}']
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806), out = process.argv[3], dir = process.argv[4];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const EPS = arg('--eps', '1e-2,1e-1,1').split(',').map(Number), BINS = +arg('--bins', 24), EXTRA = JSON.parse(arg('--opts', '{}')), POSEF = arg('--poses', '');
const scene = fs.readFileSync(path.join(__dirname, '../../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POSES = [['near_15m', 1350, { id: 'oncoming:SC', kind: 'oncoming', rel: 15 }], ['dip_100m', 1332, { id: 'oncoming:SC', kind: 'oncoming', rel: 100 }], ['crest_96m', 140, { id: 'oncoming:SC', kind: 'oncoming', rel: 96 }], ['preceding_40m', 1350, { id: 'preceding:SC', kind: 'preceding', rel: 40 }]];
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 846, height: 900 } });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
  await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'sc-fastdiff'), scene);
  await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
  await page.evaluate(() => TGPage.ready()); await sleep(1500);
  const setOpts = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  await setOpts({ trafficBeams: true, oncoming: true, preceding: true, seed: 1, visibility: 300, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', haloPolar: 'off', crestOcclusion: 'off', haloBins: BINS, ...EXTRA });
  const grab = async (tag) => {
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; }); await sleep(500);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } }); fs.writeFileSync(path.join(dir, tag + '.png'), png);
    const tab = await page.evaluate(() => { const b = RF.DriveAnim._.V.three.haloTableBytes('cum'); return b && { w: b.w, h: b.h, b64: b.b64 }; });
    return { png, tab };
  };
  const decode = (png) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return Array.from(g.getImageData(0, 0, c.width, c.height).data); }, png.toString('base64'));
  const half = (h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; return e === 0 ? sg * Math.pow(2, -14) * (m / 1024) : e === 31 ? NaN : sg * Math.pow(2, e - 15) * (1 + m / 1024); };
  const tabVals = (t) => { const u = new Uint16Array(Uint8Array.from(Buffer.from(t.b64, 'base64')).buffer), f = new Float32Array(u.length); for (let i = 0; i < u.length; i++) f[i] = half(u[i]); return f; };
  for (const [name, d, c] of POSES) {
    if (POSEF && !POSEF.split(',').includes(name)) continue;
    await page.evaluate((c) => { const D = RF.DriveAnim; D.trafficCars = () => [{ ...c, off: c.kind === 'oncoming' ? D._.V.src.lane : 0 }]; }, c);
    const run = async (mode, eps) => {
      await setOpts({ scatterCull: mode, ...(eps ? { scatterCullEps: eps } : {}) });
      await page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); }, d);
      const g = await grab(name + '_' + BINS + 'bins_' + mode + (eps ? '-' + eps : ''));
      const st = await page.evaluate(() => RF.DriveAnim._.V.three.haloState().lamps.map((l) => l.cull && { k0: l.cull.k0, k1: l.cull.k1, cells: l.cull.cells, full: l.cull.full, radius: l.cull.radius }));
      return { ...g, st };
    };
    const off = await run('off'), A = await decode(off.png), TA = tabVals(off.tab); let tmax = 0; for (const v of TA) if (v > tmax) tmax = v;
    for (const [mode, eps] of [['exact', 0], ...EPS.map((e) => ['fast', e])]) {
      const r = await run(mode, eps), B = await decode(r.png), TB = tabVals(r.tab);
      let n = 0, mx = 0, sum = 0; for (let i = 0; i < A.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(A[i + k] - B[i + k])); if (m) { n++; sum += m; if (m > mx) mx = m; } }
      let tm = 0, ts = 0, tn = 0; for (let i = 0; i < TA.length; i++) { if (i % 4 === 3) continue; const dd = Math.abs(TA[i] - TB[i]); ts += dd; tn++; if (dd > tm) tm = dd; }
      const row = { pose: name, bins: BINS, mode, eps, cells: r.st.reduce((a, l) => a + (l ? l.cells : 0), 0), full: r.st.reduce((a, l) => a + (l ? l.full : 0), 0), radius: r.st[0] && r.st[0].radius, framePixelsChanged: n, frameMaxStep: mx, frameMeanStepOverChanged: n ? +(sum / n).toFixed(3) : 0, frameMeanStepOverAll: +(sum / (A.length / 4)).toFixed(4), cumTableMaxAbs: tm, cumTableMeanAbs: ts / tn, offTableMax: tmax, cumTableMaxRel: tmax ? tm / tmax : 0 };
      console.log(JSON.stringify(row)); fs.appendFileSync(out, JSON.stringify(row) + '\n');
    }
  }
  await browser.close();
})();
