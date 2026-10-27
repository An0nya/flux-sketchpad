// SC / SP measurement harness (not a gate test): GPU ms of the halo table pass (SL_HALO_TQ, EXT_disjoint_timer_query_webgl2) per mode and pose, plus cells drawn and shots.
// Usage: PLAYWRIGHT=... node tests/tools/sc/measure.js <port> <out.jsonl> [--bins 24,32] [--modes off,exact,fast:1e-3] [--poses a,b] [--shots dir] [--width 846]
// One JSON line is appended per measurement as it is taken (nothing is held back until the end).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806), out = process.argv[3] || 'sc-measure.jsonl';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BINS = arg('--bins', '24,32').split(',').map(Number), MODES = arg('--modes', 'off,exact,fast:1e-3').split(','), WIDTH = +arg('--width', 846), SHOTS = arg('--shots', ''), POSEF = arg('--poses', '');
const EXTRA = JSON.parse(arg('--opts', '{}'));   // options set for every run (e.g. {"haloPolar":"perlamp"})
const scene = fs.readFileSync(path.join(__dirname, '../../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POSES = JSON.parse(arg('--poseset', 'null')) || [
  ['near_15m', 1350, { id: 'oncoming:SC', kind: 'oncoming', rel: 15 }],
  ['dip_100m', 1332, { id: 'oncoming:SC', kind: 'oncoming', rel: 100 }],
  ['crest_96m', 140, { id: 'oncoming:SC', kind: 'oncoming', rel: 96 }],
  ['preceding_40m', 1350, { id: 'preceding:SC', kind: 'preceding', rel: 40 }],
];
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
(async () => {
  const browser = await pw.chromium.launch({ args: (process.env.SC_LAUNCH || '--use-gl=angle --enable-unsafe-swiftshader').split(' ') });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
  await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'sc-measure'), scene);
  await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
  await page.evaluate(() => TGPage.ready()); await sleep(1500);
  const setOpts = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  await setOpts({ trafficBeams: true, oncoming: true, preceding: true, seed: 1, visibility: 300, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', haloPolar: 'off', crestOcclusion: 'off', ...EXTRA });
  const info = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas, g = document.createElement('canvas').getContext('webgl2'), e = g && g.getExtension('WEBGL_debug_renderer_info'); return { canvas: [c.width, c.height], renderer: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a', timer: !!(g && g.getExtension('EXT_disjoint_timer_query_webgl2')) }; });
  console.log(JSON.stringify(info)); fs.appendFileSync(out, JSON.stringify({ info }) + '\n');
  for (const bins of BINS) for (const [name, d, c] of POSES) {
    if (POSEF && !POSEF.split(',').includes(name)) continue;
    await page.evaluate((c) => { const D = RF.DriveAnim; D.trafficCars = () => [{ ...c, off: c.kind === 'oncoming' ? D._.V.src.lane : 0 }]; }, c);
    for (const m of MODES) {
      const [mode, eps] = m.split(':'); await setOpts({ haloBins: bins, scatterCull: mode, ...(eps ? { scatterCullEps: +eps } : {}) });
      await page.evaluate(async (dd) => { globalThis.SL_HALO_TQ = true; RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1500)); RF.DriveAnim._.V.three.haloTqPoll(); }, d);
      const r = await page.evaluate(async () => { const T = RF.DriveAnim._.V.three, ms = []; for (let i = 0; i < 40; i++) { RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 90)); ms.push(...T.haloTqPoll()); } await new Promise((r) => setTimeout(r, 400)); ms.push(...T.haloTqPoll()); const st = T.haloState(); return { ms, lamps: st.lamps.map((l) => l.cull), passes: st.passes, tab: st.tab, drawn: st.drawn }; });
      const warm = r.ms.slice(Math.min(8, Math.floor(r.ms.length / 3))), cells = r.lamps.reduce((a, l) => a + (l ? l.cells : 0), 0), full = r.lamps.reduce((a, l) => a + (l ? l.full : 0), 0);
      const row = { bins, pose: name, mode: m, n: warm.length, msMedian: median(warm), msMin: warm.length ? Math.min(...warm) : null, msMax: warm.length ? Math.max(...warm) : null, passes: r.passes, tab: r.tab, cells: mode === 'off' ? null : cells, full: mode === 'off' ? null : full, lamps: r.lamps.map((l) => l && { k0: l.k0, k1: l.k1, rect: l.rect, cells: l.cells, radius: l.radius, table: l.table }) };
      console.log(JSON.stringify(row)); fs.appendFileSync(out, JSON.stringify(row) + '\n');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; }); await sleep(400);
        fs.writeFileSync(path.join(SHOTS, name + '_' + bins + 'bins_' + m.replace(':', '-') + '.png'), await page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } }));
      }
    }
  }
  await browser.close();
})();
