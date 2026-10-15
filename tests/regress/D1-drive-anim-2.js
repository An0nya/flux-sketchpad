// D1: the animated Drive view, second pass — asphalt grain that moves, pavement markers, seeded scenery (seed control), walkers and deer that move, the US broken centre line.
// node tests/regress/D1-drive-anim-2.js [port]   (needs a server: python3 tests/serve.py <port>; D1_REAL_GPU=1 for the real GPU browser)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8727);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.D1_REAL_GPU ? { channel: 'chromium' } : {}), errors = [];
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  await page.evaluate(() => RF.UI.setDisplay('drive')); await sleep(1500);
  ok('page is the Flux app on port ' + port + ' (RF.UI, RF.DriveAnim)', await page.evaluate((p) => !!(RF.UI && RF.DriveAnim) && location.port === String(p), port));
  const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); return !!g && !!g.getExtension('EXT_color_buffer_float'); });
  if (!gpu) { ok('WebGL2 with float targets exists', false); await browser.close(); process.exit(1); }
  await page.evaluate(() => { RF.UI.dvOpts.glare = 0; RF.UI.dvAnim = { view: 'anim', playing: false, popout: false, dist: 0, total: 0, t: 0 }; RF.UI.redrawSpec(); }); await sleep(1500);
  // 1. the bar has the new controls, the defaults are on
  const bar = await page.evaluate(() => ({ btn: ['c-rpm', 'c-tex', 'c-wild', 'dice', 'cline'].map((k) => !!document.querySelector('[data-anim="' + k + '"]')), seed: document.querySelector('[data-anim="seed"]').value, dn: document.querySelector('[data-anim="density"]').value, pressed: ['c-rpm', 'c-tex', 'c-wild'].map((k) => document.querySelector('[data-anim="' + k + '"]').getAttribute('aria-pressed')) }));
  ok('new controls exist (studs, grain, random, seed, dice, density, centre line); random scenery, studs and grain are on by default', bar.btn.every(Boolean) && bar.pressed.every((x) => x === 'true') && bar.seed === '7' && +bar.dn === 1.5, JSON.stringify(bar));
  // 2. grain: the road surface changes with distance (the ground moves) — and not with the grain off; it keeps the mean (nothing brighter or darker overall)
  const hdrAt = (d) => page.evaluate((d) => { const X = RF.DriveAnim._; X.setDist(d); const h = X.readHdr(), p = X.V.p, W = p.w, H = p.h; let s = 0, n = 0; const px = []; for (let y = Math.round(H * 0.56); y < Math.round(H * 0.64); y++) for (let x = Math.round(W * 0.42); x < Math.round(W * 0.58); x++) { const q = 4 * (y * W + x); px.push(h[q + 1]); s += h[q + 1]; n++; } return { mean: s / n, px }; }, d);
  const setTex = async (v) => { await page.evaluate((v) => { RF.UI.dvOpts.tex = v; RF.UI.dvOpts.rpm = false; RF.UI.redrawSpec(); }, v); await sleep(1200); };
  await setTex(true); const t0 = await hdrAt(0), t1 = await hdrAt(0.35); await setTex(false); const n0 = await hdrAt(0), n1 = await hdrAt(0.35);
  const diff = (a, b) => { const r = []; for (let i = 0; i < a.px.length; i++) r.push(Math.abs(a.px[i] - b.px[i]) / Math.max(a.px[i], 1e-3)); r.sort((x, y) => x - y); return r[r.length >> 1]; };     // the median pixel (a lane stripe at the edge of the sample moves too)
  ok('grain keeps the mean luminance of the road (within 4 %): sanity, the sample is lit', t0.mean > 1e-3 && n0.mean > 1e-3, 'means ' + t0.mean.toFixed(4) + ' / ' + n0.mean.toFixed(4));
  ok('grain on: the median road pixel differs 0.35 m later (the ground moves); grain off: identical', diff(t0, t1) > 0.02 && diff(n0, n1) < 1e-6, 'on ' + diff(t0, t1).toFixed(3) + ', off ' + diff(n0, n1).toExponential(1));
  ok('grain keeps the mean luminance of the road (within 4 %)', Math.abs(t0.mean / n0.mean - 1) < 0.04, 'mean ratio ' + (t0.mean / n0.mean).toFixed(4));
  await setTex(true);
  // 3. seed: the same seed gives the same scenery, another seed another; typing in the field does it
  const sig = () => page.evaluate(() => JSON.stringify(RF.DriveAnim._.V.src.chunk(1).objects.map((o) => [o.k, +o.x.toFixed(2), +o.y.toFixed(2)]).slice(0, 40)));
  const s7 = await sig(); await page.fill('[data-anim="seed"]', '8'); await page.press('[data-anim="seed"]', 'Enter'); await sleep(800); const s8 = await sig(); await page.fill('[data-anim="seed"]', '7'); await page.press('[data-anim="seed"]', 'Enter'); await sleep(800); const s7b = await sig();
  ok('seed field: 7 → 8 changes the scenery, back to 7 restores it exactly; the seed is remembered', s7 !== s8 && s7 === s7b && await page.evaluate(() => JSON.parse(localStorage.getItem('flux/driveView')).seed === 7));
  // 4. markers are in the scenery, lit by the beam (they appear in the object layer) and cover nothing
  await page.evaluate(() => { RF.UI.dvOpts.rpm = true; RF.UI.redrawSpec(); }); await sleep(1000);
  const rp = await page.evaluate(() => { const DA = RF.DriveAnim, V = DA._.V, p = V.p, rgba = new Float32Array(4 * p.w * p.h), objs = DA.place(V.src, 0, p.A).filter((o) => o.cls === 'rpm' && o.x > 5 && o.x < 60); DA.objects(Object.assign({}, p, { src: { objects: [], markings: [], verge: V.src.verge, chunk: null } }), 0, rgba, 2); let lit = 0, cov = 0; const r = RF.Drive.render({ w: p.w, h: p.h, hfov: p.hfov, eye: DA.EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, lane: p.lane, look: p.look, ss: 2, layer: 'objects', tight: true, scene: { objects: objs, markings: [], verge: V.src.verge } }); for (let q = 0; q < p.w * p.h; q++) { if (r.rgb[3 * q] + r.rgb[3 * q + 1] > 0) lit++; if (r.cov[q] > 0) cov++; } return { n: objs.length, lit, cov }; });
  ok('pavement markers 5-60 m ahead: ' + rp.n + ' of them light ' + rp.lit + ' pixels and cover ' + rp.cov, rp.n >= 5 && rp.lit >= 5 && rp.cov === 0);
  // 5. walkers and deer move while it plays
  await page.evaluate(() => { RF.UI.dvAnim.dist = 170; RF.UI.dvAnim.t = 0; RF.UI.dvAnim.playing = true; RF.DriveAnim._.V.act.clear(); RF.UI.dvOpts.speed = 5; RF.UI.redrawSpec(); }); await sleep(400);
  const acts = async () => page.evaluate(() => { const DA = RF.DriveAnim, V = DA._.V, st = RF.UI.dvAnim; return JSON.stringify(DA.place(V.src, st.dist, null, (id, r0) => { const t0 = V.act.get(id); return t0 === undefined ? 0 : st.t - t0; }).filter((o) => o.cls === 'person' || o.cls === 'deer').map((o) => [o.k, +(o.x + st.dist).toFixed(2), +o.y.toFixed(2)])); });     // x + dist: where it stands on the road
  const a0 = await acts(); await sleep(3000); const a1 = await acts(); const dd = await page.evaluate(() => RF.UI.dvAnim.dist);
  const mv = await page.evaluate(([a0, a1]) => { const A = JSON.parse(a0), B = JSON.parse(a1); return { n: A.length, m: B.length }; }, [a0, a1]);
  ok('while driving at 5 km/h (car moved ' + (dd - 170).toFixed(1) + ' m in 3 s) the walkers and deer are not where a fixed scenery would have them: their places on the road changed (a fixed scenery would give the same list)', mv.n > 0 && a0 !== a1, mv.n + ' pieces');
  // 6. US: the broken centre line option (the US preset's real passing-zone marking) gives the ground a moving stripe
  const preset0 = await page.evaluate(() => RF.UI.store.scene.modeD.preset); await page.evaluate(() => { RF.UI.store.scene.modeD.preset = 'fmvss-lb2m'; RF.UI.dvOpts.cline = 'solid'; RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); }); await sleep(1500);
  const solid = await page.evaluate(() => ({ pat: RF.DriveAnim._.V.g.pat, dis: document.querySelector('[data-anim="cline"]').disabled }));
  await page.click('[data-anim="cline"]'); await sleep(1500);
  const brk = await page.evaluate(() => ({ pat: RF.DriveAnim._.V.g.pat, B: !!RF.DriveAnim._.V.g.B, mat: RF.DriveAnim._.V.src.markings.filter((m) => m.pat).map((m) => m.mat) }));
  ok('US preset: default centre line is double solid (no stripe layer); the option gives one broken yellow line with a moving stripe layer', solid.pat === null && !solid.dis && brk.pat && brk.pat.period === 12 && brk.B && brk.mat.join() === 'yellow-paint', JSON.stringify(brk));
  await page.evaluate((p) => { RF.UI.store.scene.modeD.preset = p; RF.UI.dvOpts.cline = 'solid'; RF.UI.redrawSpec(); }, preset0); await sleep(1000);
  const eu = await page.evaluate(() => document.querySelector('[data-anim="cline"]').disabled);
  ok('EU preset: the centre-line option is disabled (it already has a dashed line)', eu === true || preset0.indexOf('ece') !== 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})();
