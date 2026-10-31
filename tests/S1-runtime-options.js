// S1 (step5-preview) / RUNTIME AUDIT of the render-path options — the bug class AGENTS.md §2 keeps costing us.
// The class: an option exists, has a control, is read by the code, but toggling it at runtime changes nothing in the
// render path (lampRule was written at scene build and never re-read; my own haloWidthStep scare was this class
// done badly). This test drives the real page and, for every option that can change a shader variant or a render
// cache key, asserts three things per option:
//   INERT:  with the option ON, the render identity (renderer, gkey, halo table, a lamp-ray table total) differs
//           from the OFF baseline — so the option reaches the picture, not just V.info.o;
//   HEALTHY: the GPU path survives (renderer stays 'three'), no fallback notice is shown, no page error fires;
//   ROUND:  toggling back OFF returns the identity to the baseline, so nothing is left stale in a cache key.
// Scope per Anya: only options that change a shader variant or a cache key (not all 121). Pose: the straight-348
// probe state + the built-in d2s fixture, so an oncoming lamp is in the view. Browser: Playwright + Chromium.
// Run: node tests/S1-runtime-options.js            (the smoke subset here; the full sweep is seconds on real hardware)
//      node tests/S1-runtime-options.js --only 'haloLampWin|tilesOn'
//      node tests/S1-runtime-options.js --with-tiles      (adds the scene-rebuild options; slow under llvmpipe)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/usr/local/lib/node_modules/playwright-core');
const root = path.join(__dirname, '..'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let fails = 0, warns = 0;
const ok = (m, c, d) => { if (c) { console.log('[PASS] ' + m + (d !== undefined && d !== null && d !== '' ? ' — ' + d : '')); } else { fails++; console.log('[FAIL] ' + m + (d !== undefined && d !== null && d !== '' ? ' — ' + d : '')); } };
const warn = (m, d) => { warns++; console.log('[warn] ' + m + (d !== undefined && d !== null && d !== '' ? ' — ' + d : '')); };
// The audit set: options that change a shader VARIANT or a render CACHE KEY (see the claims in the backlog).
// kind 'variant' = the shader source changes (a recompile); 'key' = a cache key or the table shape changes.
const OPTS = [
  ['haloLampWin', 'variant', { off: 'off', on: '16' }, []],
  ['haloWidthStep', 'variant', { off: 'off', on: '1' }, []],
  ['haloCrossingRefine', 'variant', { off: '0', on: '512' }, []],
  ['haloMoment', 'variant', null, []],
  ['haloJitter', 'variant', { off: 'even', on: 'jittered' }, []],
  ['haloBlur', 'variant', { off: 'off', on: 'light' }, []],
  ['haloDepthBlur', 'variant', { off: 'off', on: 'light' }, []],
  ['haloAutoRange', 'key', null, []],
  ['haloNearSub', 'key', null, []],
  ['haloBins', 'key', null, []],
  ['haloRange', 'key', { off: 'auto', on: '250' }, []],
  ['haloDiv', 'key', null, []],
  ['tilesOn', 'key', { off: 'off', on: 'on' }, []],
  ['tileCache', 'key', { off: 'off', on: 'on' }, ['tilesOn']],
  ['endlessRoad', 'key', { off: 'off', on: 'on' }, ['tilesOn']],
  ['corneringLamps', 'variant', { off: 'off', on: 'on' }, []],
  ['lampConeGain', 'variant', { off: '0', on: '1' }, []],
  ['trafficBeams', 'variant', { off: 'off', on: 'on' }, []],
  ['surfaceSheen', 'variant', { off: 'off', on: 'on' }, []],
  ['wetVeil', 'variant', { off: 'off', on: 'on' }, ['wetOn', 'wetSheenOn']],
  ['dynamicResolution', 'key', { off: 'off', on: 'on' }, []],
  ['mtBlockers', 'variant', { off: 'off', on: 'on' }, []],
  ['lampRule', 'key', { off: 'urban', on: 'rural' }, ['tilesOn']],
];
(async () => {
  const only = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
  const withTiles = process.argv.includes('--with-tiles');   // the tile options force a scene rebuild: seconds on a GPU, minutes under llvmpipe
  const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
  await new Promise((ok2) => server.listen(8090, '127.0.0.1', ok2));
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(() => { localStorage.setItem('flux/photosafeNotice', 'dismissed'); localStorage.setItem('flux/guideSeen', '1'); });
  await page.goto('http://127.0.0.1:8090/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store, null, { timeout: 90000 });
  await page.evaluate(() => { document.querySelector('button[data-mode="D"]').click(); document.querySelector('button[data-disp="drive"]').click(); });
  await page.waitForFunction(() => RF.DriveAnim && RF.DriveAnim._ && RF.DriveAnim._.V && RF.DriveAnim._.V.p, null, { timeout: 90000 });
  await page.setInputFiles('[data-anim="state-file"]', '/workspace/step5-preview/states/state-lwoff.json');
  await page.evaluate(() => { const el = document.querySelector('[data-anim="own-low"]'); el.dispatchEvent(new Event('mousedown', { bubbles: true })); });
  try { await page.waitForFunction(() => { const el = document.querySelector('[data-anim="own-low"]'); return el && el.options.length > 1; }, null, { timeout: 180000 }); } catch (e) { warn('the built-in beam list was late this run', String(e).slice(0, 60)); }
  await page.evaluate(() => { const el = document.querySelector('[data-anim="own-low"]'), want = 'builtin:sqm-samples.json:4';
    if ([...el.options].some(o => o.value === want)) { el.value = want; el.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForTimeout(3000);
  // The render identity: enough to tell 'the option reached the picture' from 'the option is inert'.
  const T1 = await page.evaluate(() => {
    const a = RF.DriveAnim._, V = a.V, st = a.S(V.ui), p = V.p;
    const tr = p.src.traffic; if (tr) tr.state = null;
    let t = st.t, guard = 0;
    while (guard++ < 400 && !(a.trafficCars(p.src, st.dist, t).some(c => c.kind === 'oncoming' && c.rel <= 205 && c.rel > 150))) t += 1.0;
    return +t.toFixed(3);
  });
  console.log('closing event pinned at T1 = ' + T1);
  const ident = async () => page.evaluate((PIN) => {
    const a = RF.DriveAnim._, V = a.V, st = a.S(V.ui), three = V.three, p = V.p;
    st.t = PIN; a.frame();                                   // pose the oncoming car, else no lamp is in view
    const n = document.querySelector('[data-anim="notice"]');
    let tab = null, edges = null, lamp = null, lamps = 0;
    if (three && three.haloState) {
      const hs = three.haloState();
      if (hs) {
        tab = hs.tab ? hs.tab.join('x') : null;
        lamps = hs.on ? hs.lamps.length : 0;
        if (hs.on && hs.lamps.length) {
          const L = hs.lamps[0], eye = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360);
          const r = [L.lamp[0] - eye[0], L.lamp[1] - eye[1], L.lamp[2] - eye[2]];
          const sx = -r[1] / (r[0] * tanH), sy = r[2] * p.w / (r[0] * tanH * p.h);
          edges = (hs.edges || []).map((e) => +e.toFixed(4)).join(',');
          const bins = three.haloProbe(sx, sy) || [];
          let lum = 0;
          for (const b of bins) lum += b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722;
          lamp = +lum.toFixed(6);
        }
      }
    }
    return { r: RF.DriveAnim.stats().renderer, tab: tab, edges: edges, n: lamps, lamp: lamp, notice: (n && n.textContent || '').slice(0, 120), o: (V.info && V.info.o) || null };
  }, T1);

  const pickOn = async (name) => page.evaluate((n) => {
    const sel = document.querySelector('[data-dv="' + n + '"]');
    if (!sel) return null;
    const cur = sel.value;
    if (sel.tagName === 'SELECT') { const o = [...sel.options].find((x) => x.value !== cur && x.value !== ''); return o ? o.value : null; }
    if (sel.type === 'checkbox') return !sel.checked;
    if (sel.type === 'number' || sel.type === 'range') { const mx = Number(sel.max || 1), st = Number(sel.step || 1), c = Number(cur || 0);
      return c + st <= mx ? String(c + st) : String(Math.max(0, c - st)); }
    return cur + '-x';                                   // a text control: anything that is not the current value
  }, name);
  const setOpt = async (k, v) => page.evaluate((kv) => { const sel = document.querySelector('[data-dv="' + kv[0] + '"]');
    if (!sel) return 'no control'; if (sel.disabled) return 'disabled'; sel.value = String(kv[1]); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'set'; }, [k, v]);
  for (const [name, kind, vals, needs] of OPTS) {
    if (only && !only.test(name)) continue;
    if (!withTiles && ['tilesOn', 'tileCache', 'endlessRoad', 'lampRule'].includes(name)) { warn(name + ': a scene rebuild under llvmpipe is minutes, so it is --with-tiles only', 'skipped'); continue; }
    let skip = false;
    for (const dep of needs) { const r = await setOpt(dep, 'on'); if (r !== 'set') { warn(name + ': parent ' + dep + ' ' + r, 'skipped'); skip = true; break; } }
    if (skip) continue;
    const restore = await page.evaluate((n) => { const s = document.querySelector('[data-dv="' + n + '"]'); return s ? s.value : null; }, name);
    await setOpt(name, vals.off); await page.waitForTimeout(500);
    const base = await ident();
    const offSel = await page.evaluate((n) => { const s = document.querySelector('[data-dv="' + n + '"]'); return s ? (s.disabled ? 'disabled' : s.value) : 'no control'; }, name);
    if (offSel === 'no control' || offSel === 'disabled') { warn(name + ': control ' + offSel + ' in this configuration', 'skipped'); continue; }
    const onVal = await pickOn(name);
    if (onVal === null || onVal === undefined) { warn(name + ': no other value on its control to switch to', 'skipped'); continue; }
    await setOpt(name, onVal); await page.waitForTimeout(1500);
    const withOn = await ident();
    const errs = errors.length; errors.length = 0;
    const healthy = withOn.r === 'three' && !withOn.notice && errs === 0;
    ok(name + ' (' + kind + '): ON does not break the GPU path', healthy, 'renderer ' + withOn.r + (withOn.notice ? ' notice "' + withOn.notice + '"' : '') + (errs ? ' errors ' + errs : ''));
    const want = vals.on !== null ? vals.on : onVal;
    const took = withOn.o && withOn.o[name] !== undefined && String(withOn.o[name]) === String(want);
    const changed = withOn.tab !== base.tab || withOn.edges !== base.edges || withOn.lamp !== base.lamp || withOn.r !== base.r;
    if (!took) ok(name + ' (' + kind + '): ON reaches the options object', false, 'value is ' + (withOn.o ? withOn.o[name] : 'no options'), 'INERT: the control did not take');
    else ok(name + ' (' + kind + '): ON reaches the render path (not inert)', changed, 'table ' + (withOn.tab === base.tab ? 'same' : 'changed') + ', edges ' + (withOn.edges === base.edges ? 'same' : 'changed') + ', lamp row ' + (withOn.lamp === base.lamp ? 'same ' + withOn.lamp : base.lamp + ' -> ' + withOn.lamp));
    if (!changed && took) warn(name + ' (' + kind + '): ON is live but nothing moved at the sampled ray', 'scoped elsewhere in the table (or a value equal to the state default) — not inert, not verified here');
    await setOpt(name, vals.off); await page.waitForTimeout(1500);
    const back = await ident();
    const rt = back.r === 'three' && back.tab === base.tab && back.edges === base.edges && back.lamp === base.lamp;
    ok(name + ' (' + kind + '): OFF returns to the baseline (no stale key)', rt, back.lamp === base.lamp ? 'lamp row and table identity restored' : 'lamp ' + base.lamp + ' -> ' + back.lamp);
    if (restore) await setOpt(name, restore);   // leave the option as the state file had it, for the next one
  }
  await browser.close(); server.close();
  console.log((fails ? fails + ' FAILED, ' : '') + (warns ? warns + ' skipped' : '') + (fails ? '' : ' all checks passed'));
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
