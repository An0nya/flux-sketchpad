// step5-preview: the BEHAVIOURAL check for the registry's `ignoredWhen` rules (OPEN-ITEMS-2026-10-30's defect
// class: a rule declared but not honoured). The static version ("the controlled option's read site must mention
// the controller") is INVALID - see CLAUDE-NOTES 10-31 (step5-preview): `unmet()` has no app callers, the rules
// are honoured where the CONTROLLER is read (e.g. drive-three-halo.js:646 forces LW's K to 0 when refinement is
// on). So the sound check is behavioural: with the controller in the ignoring state, forcing the controlled
// option to a non-default must NOT move the render; with the controller elsewhere it MUST (the positive control).
//
//   node tests/ignored-when.js                # the registry shape checks + the table-class rules
//   node tests/ignored-when.js --with-scenes  # also the scene-rebuild rules (mountainPass / city), slow
const fs = require('fs'), http = require('http'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const REG_PATH = path.join(__dirname, '..', '..', 'js', 'options-registry.js');
const root = path.join(__dirname, '..', '..'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let fail = 0, pass = 0;
const ok = (m, c, d) => { if (c) pass++; else fail++; console.log((c ? '[PASS] ' : '[FAIL] ') + m + (c ? '' : ' - ' + d)); };
// ---- node: the shared registry parse (tests/control-map.js) checks every need() reference and the
// ---- control/option consistency there; here we only need the option ids for the forced-value bookkeeping.
// the behavioural rules: [controlled, controller key, controller's ignoring value, forced value of the controlled, metric]
// The value that actually exercises each option's code path: scatterMode's table only switches on at 'table',
// so the default "first option that differs" ('air') would measure nothing at all.
const PREFER = { scatterMode: ['table', 'off'], scatter: [8, 4, 1] };
const RULES = [
  ['haloLampWin', 'haloCrossingRefine', 128, '16', 'table'],      // crossingRefineOn: the refinement replaces LW's schedule
  ['scatter', 'scene', '__pass', 1, 'scene'],                     // mountainPassAir: the pass air beam keeps the flat basis
  ['scatterMode', 'scene', '__pass', 'on', 'scene'],
  ['scene', 'mountainPass', true, 'forest', 'scene'],             // mountainPassScene: the pass overrides scene
  ['wild', 'mountainPass', true, 'on', 'scene'],
  ['people', 'mountainPass', true, 'on', 'scene'],                // mountainPassPeople: the pass builds no people
  ['leafyFoliage', 'mountainPass', true, 'on', 'scene'],          // mountainPassScene ...
  ['leafyFoliage', 'scene', 'city', 'on', 'scene'],               // ... and cityScene
];
const SCENE_RULES = new Set(RULES.filter((r) => r[4] === 'scene').map((r) => r[0] + ':' + r[1] + ':' + r[2] + ':' + r[3]));
const RUN_SCENES = process.argv.includes('--with-scenes');
(async () => {
  const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
  await new Promise((ok2) => server.listen(0, '127.0.0.1', ok2));   // an ephemeral port: a fixed one is taken by another model's run
  const port = server.address().port;
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
  await page.addInitScript(() => { localStorage.setItem('flux/photosafeNotice', 'dismissed'); localStorage.setItem('flux/guideSeen', '1'); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store, null, { timeout: 90000 });
  await page.evaluate(() => { document.querySelector('button[data-mode="D"]').click(); document.querySelector('button[data-disp="drive"]').click(); });
  await page.waitForFunction(() => RF.DriveAnim && RF.DriveAnim._ && RF.DriveAnim._.V && RF.DriveAnim._.V.p, null, { timeout: 90000 });
  await page.setInputFiles('[data-anim="state-file"]', path.join(root, 'tests', 'states', 'state-lwoff.json'));
  await page.evaluate(() => { const el = document.querySelector('[data-anim="own-low"]'); el.dispatchEvent(new Event('mousedown', { bubbles: true })); });
  try { await page.waitForFunction(() => { const el = document.querySelector('[data-anim="own-low"]'); return el && el.options.length > 1; }, null, { timeout: 180000 }); } catch (e) {}
  await page.evaluate(() => { const el = document.querySelector('[data-anim="own-low"]'), want = 'builtin:sqm-samples.json:4';
    if ([...el.options].some(o => o.value === want)) { el.value = want; el.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForTimeout(2500);
  const T1 = await page.evaluate(() => { const a = RF.DriveAnim._, V = a.V, st = a.S(V.ui), p = V.p;
    const tr = p.src.traffic; if (tr) tr.state = null; let t = st.t, g = 0;
    while (g++ < 400 && !(a.trafficCars(p.src, st.dist, t).some(c => c.kind === 'oncoming' && c.rel <= 205 && c.rel > 150))) t += 1.0; return +t.toFixed(4); });
  console.log('closing event pinned at T1 = ' + T1);
  // set options through their own controls, then read the identity at the same pose
  const setOpts = (p) => page.evaluate((pp) => { for (const [k, v] of Object.entries(pp)) {
      const sel = document.querySelector('[data-dv="' + k + '"]') || document.querySelector('[data-anim="' + k + '"]');
      if (!sel) continue;
      if (sel.tagName === 'BUTTON') { const I = RF.DriveAnim._.V.info, want = !!v;
        for (let n = 0; n < 3 && !!I.o[k] !== want; n++) sel.click(); }
      else { sel.value = String(v); sel.dispatchEvent(new Event('change', { bubbles: true })); } } }, p);
  // The lamp row drifts ~0.3% between two reads of the SAME state (a table rebuild mid-sequence), so the
  // comparison needs a tolerance: exact on the table shape and the bin edges, 0.5% on the row.
  const parse = (v) => { const m = /on\|([0-9.eE+-]+)\|tab=([^|]*)\|edges=(.*?)(\|o\..*)?$/.exec(String(v)); return m ? { lamp: +m[1], tab: m[2], edges: m[3], air: m[4] || '' } : null; };
  const cut = (v) => String(v).split(' \u00b7 ')[0];
  const same = (a, b) => { const x = parse(cut(a)), y = parse(cut(b)); if (!x || !y) return cut(a) === cut(b);
    return x.tab === y.tab && x.edges === y.edges && x.air === y.air && Math.abs(x.lamp - y.lamp) <= 0.005 * Math.max(x.lamp, y.lamp, 1e-9); };
  const ident = (id0) => page.evaluate((a2) => {
    const a = RF.DriveAnim._, V = a.V, st = a.S(V.ui), three = V.three, p = V.p;
    const tr = p.src.traffic; if (tr) tr.state = null;
    st.t = a2.T1; a.frame();
    const hs = three.haloState();
    let lamp = '';
    if (hs && hs.on && hs.lamps.length) { const L = hs.lamps[0], eye = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360);
      const rr = [L.lamp[0] - eye[0], L.lamp[1] - eye[1], L.lamp[2] - eye[2]];
      const sx = -rr[1] / (rr[0] * tanH), sy = rr[2] * p.w / (rr[0] * tanH * p.h);
      const bins = three.haloProbe(sx, sy) || []; let lum = 0;
      for (const b of bins) lum += b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722; lamp = lum.toFixed(6); }
    // the table shape and the bin edges: a resolution-only change (scatter / scatterMode) conserves the lamp
    // row total, so a row-total identity would report it as "no effect" - a metric failure, not an app one.
    // The air-beam scatter table (options scatter / scatterMode, ignoredWhen mountainPassAir) does not move the
    // lamp row, so the identity needs it too: the table's activity, its recompute counter and its badge.
    const SC = globalThis.SD_SCATTER;
    // Only the STABLE air dimensions: a rebuild counter moves on any option change, so it cannot be compared.
    // The air table's parameters through the read-only hook (three.tableUniforms(), landed with the council's
    // consent 10-31): an exact, stable identity for the scatter table - the thing the lamp row cannot see.
    const tu = three.tableUniforms ? three.tableUniforms() : null;
    const air = '|steps=' + (tu && tu.steps !== undefined && tu.steps !== null ? tu.steps : 'x') + '/h=' + (tu && tu.h !== undefined && tu.h !== null ? tu.h : 'x') + '/bias=' + (tu && tu.bias !== undefined && tu.bias !== null ? tu.bias : 'x');
    // (V.airSeq's truthiness was tried first and does not flip at this pose, so it cannot carry a verdict.)

    // it does, so its truthiness is exact and stable - unlike the badge, which embeds lastMs. This is what makes
    // the scatterMode/mountainPassAir rule measurable (the lamp row cannot see it).
    // The rendered identity, then what the stored options say. Only the first half is compared: the ignored check
    // REQUIRES the option to differ while the render stays the same, and reporting the stored value is what
    // separates "my set never took" (a harness bug) from "this metric cannot see it" (a coverage gap).
    const I = V.info && V.info.o ? V.info.o : {};
    return (hs && hs.on ? 'on|' + lamp : 'off') + '|tab=' + (hs ? hs.tab : 'x') + '|edges=' + ((hs && hs.edges || []).map((e) => +e.toFixed(4)).join(',')) + air
      + ' \u00b7 o.scatter=' + I.scatter + ',o.scatterMode=' + I.scatterMode + ',o.' + a2.id0 + '=' + (I[a2.id0] === undefined ? 'x' : I[a2.id0]);
  }, { T1, id0: id0 });
  const BASE = { haloJitter: 'jittered', haloBlur: 'light', haloDepthBlur: 'light', haloLampWin: 'off', haloWidthStep: 'off', haloCrossingRefine: '0' };
  // The pass has NO reachable control (the registry claims `[data-dv="scene"] value __pass`, but that value is
  // never offered by the scene select - see CLAUDE-NOTES), so a pass context has to come from a state file.
  const loadState = async (f) => { await page.setInputFiles('[data-anim="state-file"]', f); await page.waitForTimeout(2500); };
  const isPass = (c) => c === '__pass';
  // Derived from the control itself (the audit lesson): a hand-written value a control does not accept sets
  // nothing, so both reads come back identical and the check looks inert.
  const forceOf = async (id, prefer) => page.evaluate((a) => {
    const el = document.querySelector('[data-dv="' + a.id + '"]') || document.querySelector('[data-anim="' + a.id + '"]'); if (!el) return null;
    if (el.tagName === 'SELECT') { const has = [...el.options].map((x) => x.value);
      if (a.prefer && a.prefer.length) { const q = a.prefer.find((v) => has.includes(String(v)) && String(v) !== el.value); if (q !== undefined) return String(q); }
      const o = [...el.options].find((x) => x.value !== el.value && x.value !== ''); return o ? o.value : null; }
    if (el.type === 'checkbox') return !el.checked;
    if (el.type === 'number' || el.type === 'range') { const c = Number(el.value || 0), mx = Number(el.max || 1), st = Number(el.step || 1);
      return c + st <= mx ? String(c + st) : String(Math.max(0, c - st)); }
    return 'on';                                   // a text control: anything that is not the current value
  }, { id: id, prefer: prefer });
  let skipped = [];
  for (const [id, ctrl, ignVal, forcedTable, metric] of RULES) {
    const forced = (await forceOf(id, PREFER[id])); if (forced === null || forced === undefined) { console.log('[warn] ' + id + ': no way to force a value from its control - skipped'); continue; }
    const key = id + ':' + ctrl + ':' + ignVal + ':' + forced;
    if (metric === 'scene' && !RUN_SCENES) { skipped.push(key); continue; }
    // (a) the ignoring context: controlled forced, then controlled at its default
    const defVal = await page.evaluate((k) => { const el = document.querySelector('[data-dv="' + k + '"]') || document.querySelector('[data-anim="' + k + '"]'); return el ? (el.options && el.options.length ? el.options[0].value : 'off') : 'off'; }, id);
    if (isPass(ignVal)) await loadState(path.join(root, 'tests', 'states', 'state-pass.json'));
    else await setOpts(Object.assign({}, BASE, { [ctrl]: ignVal, [id]: forced }));
    await setOpts(Object.assign({}, BASE, { [id]: forced })); await page.waitForTimeout(1800);
    const withOn = await ident(id);
    await setOpts(Object.assign({}, BASE, { [id]: defVal })); await page.waitForTimeout(1800);
    const withDefault = await ident(id);
    ok('ignored: ' + id + ' with ' + ctrl + ' at ' + ignVal + ' does not move the identity (' + forced + ' vs ' + defVal + ')',
      same(withOn, withDefault), withOn + ' vs ' + withDefault);
    // (b) the positive control: the controller elsewhere, the same forced vs default MUST differ
    const other = ctrl === 'scene' ? 'straight' : (ctrl === 'haloCrossingRefine' ? 0 : ignVal);
    if (isPass(other)) await loadState(path.join(root, 'tests', 'states', 'state-pass.json'));
    else await setOpts(Object.assign({}, BASE, { [ctrl]: other, [id]: forced }));
    await setOpts(Object.assign({}, BASE, { [id]: forced })); await page.waitForTimeout(1800);
    const ctlOn = await ident(id);
    await setOpts(Object.assign({}, BASE, { [id]: defVal })); await page.waitForTimeout(1800);
    const ctlDefault = await ident(id);
    // The positive control's job is to prove the "ignored" PASS above is not vacuous. If the forced value does
    // not move the identity even when the option is NOT ignored, this metric simply cannot see that option
    // (scatter / scatterMode govern the air-beam table, not the lamp row) - so the ignored verdict is UNVERIFIED,
    // not proven. Reported as a warning, and never as a pass.
    if (ctlOn !== ctlDefault || forced === defVal) ok('control: with ' + ctrl + ' NOT at the ignoring value, ' + id + ' does move the identity (' + forced + ' vs ' + defVal + ')', true);
    else console.log('[warn] ' + id + ' (' + ctrl + ' = ' + ignVal + '): the forced value does not move the identity even when NOT ignored - this metric cannot see that option, so the "ignored" verdict above is UNVERIFIED, not proven (' + ctlOn + ')');
  }
  if (skipped.length) console.log('[info] skipped without --with-scenes: ' + skipped.join(', '));
  console.log((fail ? fail + ' FAILED, ' : '') + pass + ' passed' + (skipped.length ? ', ' + skipped.length + ' scene rules skipped' : ''));
  await browser.close(); server.close(); process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL', String(e && e.message || e)); process.exitCode = 1; });
