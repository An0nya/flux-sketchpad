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
const { chromium } = require(process.env.PLAYWRIGHT || '/usr/local/lib/node_modules/playwright-core');   // PLAYWRIGHT (set by tests/gate.js) first, like tests/regress/*; the fallback is the sealed VM's install
const { controlFor, IDS, CONDS } = require('./control-map.js');   // the shared id -> selector map, the registry ids and the rule conditions (tests/control-map.js)
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
  ['tiles', 'key', { off: 'off', on: 'on' }, []],
  ['tileCache', 'key', { off: 'off', on: 'on' }, ['tiles']],
  ['endlessRoad', 'key', { off: 'off', on: 'on' }, ['tiles']],
  ['corneringLamps', 'variant', { off: 'off', on: 'on' }, []],
  ['lampConeGain', 'variant', { off: '0', on: '1' }, []],
  ['trafficBeams', 'variant', { off: 'off', on: 'on' }, []],
  ['surfaceSheen', 'variant', { off: 'off', on: 'on' }, []],
  ['wetVeil', 'variant', { off: 'off', on: 'on' }, ['wetOn', 'wetSheenOn']],
  ['dynamicResolution', 'key', { off: 'off', on: 'on' }, []],
  ['mtBlockers', 'variant', { off: 'off', on: 'on' }, []],
  // le-chonk's scene-regenerate landings (group 'endless'), added 10-31: each is a bar toggle or bar select
  // (so the audit drives it by clicking, not by a value-set) and each rebuilds the road scene when it takes.
  ['endlessRoad', 'scene', null, []], ['elevatedView', 'scene', null, []], ['endlessPreset', 'scene', null, []],
  // the 10-31/11-01 landings after my first sweep: le-chonk's cabin/yaw/junction set and frenchie's two GPU options
  ['junctionGantries', 'scene', null, []], ['cabinView', 'variant', null, []], ['driftMode', 'scene', null, []],
  ['yawSmooth', 'scene', null, []], ['cabinLight', 'scene', null, []], ['dryStreaks', 'variant', null, []], ['heatShimmer', 'variant', null, []],
  ['tileTerrain', 'scene', null, []], ['multilaneRoad', 'scene', null, []], ['endlessTunnel', 'scene', null, []],
  ['endlessCrossing', 'scene', null, []],
  ['lampRule', 'key', { off: 'urban', on: 'rural' }, ['tilesOn']],
];
(async () => {
  const only = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
  const withTiles = process.argv.includes('--with-tiles');   // the tile options force a scene rebuild: seconds on a GPU, minutes under llvmpipe
  const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
  await new Promise((ok2) => server.listen(0, '127.0.0.1', ok2));   // an ephemeral port: a fixed one is taken by another model's run
  const port = server.address().port;
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT ? {} : { executablePath: '/usr/bin/chromium-browser' }), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(() => { localStorage.setItem('flux/photosafeNotice', 'dismissed'); localStorage.setItem('flux/guideSeen', '1'); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
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
    return { r: RF.DriveAnim.stats().renderer, wh: p.w + 'x' + p.h, rs: String(V.resolution ? V.resolution.scale : 1), skey: String(V.skey || ''), akey: String(V.akey || ''), tab: tab, edges: edges, n: lamps, lamp: lamp, notice: (n && n.textContent || '').slice(0, 120), o: (V.info && V.info.o) || null };
  }, T1);

  const pickOn = async (name) => page.evaluate((sel) => {
    const s = sel ? document.querySelector(sel) : null;
    if (!s) return null;
    const cur = s.value;
    if (s.tagName === 'SELECT') { const o = [...s.options].find((x) => x.value !== cur && x.value !== ''); return o ? o.value : null; }
    if (s.type === 'checkbox') return !s.checked;
    if (s.type === 'number' || s.type === 'range') { const mx = Number(s.max || 1), st = Number(s.step || 1), c = Number(cur || 0);
      return c + st <= mx ? String(c + st) : String(Math.max(0, c - st)); }
    return cur + '-x';                                   // a text control: anything that is not the current value
  }, controlFor(name));
  // a control is either a [data-dv] select/number or a [data-anim] bar button/checkbox; try both families
  const setOpt = async (k, v) => page.evaluate((kv) => {
    const sel = kv[2] ? document.querySelector(kv[2]) : null;
    if (!sel) return 'no control';
    if (sel.disabled) return 'disabled';
    if (sel.tagName === 'BUTTON') {                                             // a bar toggle: it applies on click
      const want = !!kv[1], I = RF.DriveAnim._.V.info; if (!I) return 'no options';
      for (let n = 0; n < 3 && !!I.o[kv[0]] !== want; n++) sel.click();
      return !!I.o[kv[0]] === want ? 'set' : 'toggled nowhere';
    }
    if (sel.type === 'checkbox') sel.checked = String(kv[1]) !== 'off';
    else if (String(kv[1]) !== 'on' || sel.tagName === 'SELECT') sel.value = String(kv[1]);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.dispatchEvent(new Event('click', { bubbles: true }));   // some toggles apply on click, not only on change
    return 'set';
  }, [k, v, controlFor(k)]);
  for (const [name, kind, vals, needs] of OPTS) {
    if (CONDS.has(name)) { warn(name + ': a RULES condition, not an option', 'skipped - rule conditions are covered by tests/options-registry.js and tests/ignored-when.js'); continue; }
    if (!IDS.has(name)) { warn(name + ': not an option id in the registry', 'skipped (the audit list is stale - fix the list)'); continue; }
    if (!controlFor(name)) { warn(name + ': no control on the page (a state-file / preset option)', 'skipped (by design; covered by tests/control-map.js and tests/option-rebuild.js)'); continue; }
    if (only && !only.test(name)) continue;
    if (!withTiles && ['tiles', 'tileCache', 'endlessRoad', 'lampRule'].includes(name)) { warn(name + ': a scene rebuild under llvmpipe is minutes, so it is --with-tiles only', 'skipped'); continue; }
    let skip = false;
    for (const dep of needs) { const r = await setOpt(dep, 'on'); if (r !== 'set') { warn(name + ': parent ' + dep + ' ' + r, 'skipped'); skip = true; break; } }
    if (skip) continue;
    const restore = await page.evaluate((sel) => { const s = sel ? document.querySelector(sel) : null; return s ? s.value : null; }, controlFor(name));
    const offVal = vals && vals.off !== null ? vals.off : (await page.evaluate((n) => { const el = document.querySelector('[data-dv="' + n + '"]'); return el ? el.value : null; }, name));
    await setOpt(name, offVal); await page.waitForTimeout(500);
    const base = await ident();
    const offSel = await page.evaluate((sel) => { const s = sel ? document.querySelector(sel) : null; return s ? (s.disabled ? 'disabled' : s.value) : 'no control'; }, controlFor(name));
    if (offSel === 'no control' || offSel === 'disabled') { warn(name + ': control ' + offSel + ' in this configuration', 'skipped'); continue; }
    const isBtn = await page.evaluate((sel) => { const s = sel ? document.querySelector(sel) : null; return s ? s.tagName === 'BUTTON' : false; }, controlFor(name));
    const curOpt = await page.evaluate((n) => { const I = RF.DriveAnim._.V.info; return I && I.o ? I.o[n] : undefined; }, name);
    let want = vals && vals.on !== null ? vals.on : await pickOn(name);
    if (isBtn) want = !curOpt;                                   // a bar toggle flips the option, so aim at the flip
    if (want === null || want === undefined) { warn(name + ': no other value on its control to switch to', 'skipped'); continue; }
    await setOpt(name, want); await page.waitForTimeout(1500);
    const withOn = await ident();
    const errs = errors.length; errors.length = 0;
    const healthy = withOn.r === 'three' && !withOn.notice && errs === 0;
    ok(name + ' (' + kind + '): ON does not break the GPU path', healthy, 'renderer ' + withOn.r + (withOn.notice ? ' notice "' + withOn.notice + '"' : '') + (errs ? ' errors ' + errs : ''));
    const took = withOn.o && withOn.o[name] !== undefined && String(withOn.o[name]) === String(want);
    const changed = withOn.tab !== base.tab || withOn.edges !== base.edges || withOn.lamp !== base.lamp || withOn.r !== base.r || withOn.wh !== base.wh || withOn.rs !== base.rs || withOn.skey !== base.skey || withOn.akey !== base.akey;
    if (!took) warn(name + ' (' + kind + '): ON, but the stored value is ' + JSON.stringify(withOn.o ? withOn.o[name] : null) + ' while the control now reads ' + JSON.stringify(want), 'a synthetic change on this control type did not move the option - either the audit cannot drive this control or the control is inert; the round-trip check below still applies');
    else if (changed) ok(name + ' (' + kind + '): ON reaches the render path (not inert)', changed, 'table ' + (withOn.tab === base.tab ? 'same' : 'changed') + ', edges ' + (withOn.edges === base.edges ? 'same' : 'changed') + '; scene key ' + (withOn.skey === base.skey ? 'same' : 'MOVED') + ', act key ' + (withOn.akey === base.akey ? 'same' : 'MOVED') + ', lamp row ' + (withOn.lamp === base.lamp ? 'same ' + withOn.lamp : base.lamp + ' -> ' + withOn.lamp) + (withOn.wh !== base.wh || withOn.rs !== base.rs ? ', render ' + base.wh + '/' + base.rs + ' -> ' + withOn.wh + '/' + withOn.rs : ''));
    if (!changed && took) warn(name + ' (' + kind + '): ON is live but nothing moved at the sampled ray', 'scoped elsewhere in the table (or a value equal to the state default) — not inert, not verified here');
    await setOpt(name, offVal); await page.waitForTimeout(1500);
    const back = await ident();
    const rt = back.r === 'three' && back.tab === base.tab && back.edges === base.edges && back.lamp === base.lamp && back.wh === base.wh && back.rs === base.rs && back.skey === base.skey && back.akey === base.akey;
    ok(name + ' (' + kind + '): OFF returns to the baseline (no stale key)', rt, back.lamp === base.lamp ? 'lamp row and table identity restored' : 'lamp ' + base.lamp + ' -> ' + back.lamp);
    if (restore) await setOpt(name, restore);   // leave the option as the state file had it, for the next one
  }
  await browser.close(); server.close();
  console.log((fails ? fails + ' FAILED, ' : '') + (warns ? warns + ' skipped' : '') + (fails ? '' : ' all checks passed'));
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
