// LV page check: the five LHP531 presets are in the emitter picker, and the 1800 K PC amber tints the lamp amber
// (versus the 6500 K one) through the same applySourcePreset path the picker's change event uses.
// Run: PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/LV-lhp531-picker.js 8971
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8971);
const IDS = ['k3-229647', 'k3-229647-6500', 'k3-229647-4000', 'k3-229647-3000', 'k3-229647-1800'];
let fails = 0, n = 0;
const ok = (name, pass, detail) => { n++; if (!pass) fails++; console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };

(async () => {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.SourcePresets && RF.CCT && RF.Controller, null, { timeout: 60000 });

  const picker = await page.evaluate((ids) => {
    const SP = RF.SourcePresets;
    const keys = Object.keys(SP.PRESETS).filter((k) => k.startsWith('k3-229647'));
    const labels = ids.map((id) => [id, SP.PRESETS[id] ? SP.PRESETS[id].label : null, SP.PRESETS[id] && SP.PRESETS[id].measured === true]);
    return { keys, labels, total: Object.keys(SP.PRESETS).length, oldCombinedGone: !SP.PRESETS['k3-229647'].label.includes('1800-6500') };
  }, IDS);
  ok('picker source: the five LHP531 ids are PRESETS keys (grouped as measured by koef3)', IDS.every((id) => picker.labels.find((l) => l[0] === id && l[1] && l[2])), picker.labels);
  ok('picker source: exactly these five LHP531 keys, and the old combined label is gone', picker.keys.length === 5 && picker.oldCombinedGone, picker.keys);
  ok('picker source: 98 presets in total', picker.total === 98, picker.total);

  // the picker's <select> (if the Light source panel is rendered) lists the same five values
  const inPanel = await page.evaluate((ids) => {
    const sel = document.querySelector('select[aria-label="Emitter preset"]');
    if (!sel) return null;
    const vals = Array.from(sel.options).map((o) => o.value);
    return ids.filter((id) => vals.includes(id));
  }, IDS);
  if (inPanel === null) console.log('  (note) Emitter preset <select> is not rendered in this view; checked the PRESETS keys above');
  else ok('picker <select>: all five LHP531 options present', inPanel.length === 5, inPanel);

  // lamp tint through applySourcePreset (the picker change handler's call), on the live store
  const tint = await page.evaluate((ids) => {
    const C = RF.Controller, st = RF.UI && RF.UI.store ? RF.UI.store : C.createStore(RF.State.testScene());
    const out = {};
    for (const id of ids.concat(['k3-71860'])) {
      C.actions.applySourcePreset(st, id);
      const cct = st.scene.source.cct;
      out[id] = { cct, rgb: cct > 0 ? RF.CCT.cctToRGB(cct).map((v) => +v.toFixed(3)) : null, preset: st.scene.source.preset };
    }
    return out;
  }, IDS);
  const a = tint['k3-229647-1800'], w = tint['k3-229647-6500'];
  ok('1800 K PC amber: cct 1733 via applySourcePreset (owner-approved exception)', a.cct === 1733, a);
  ok('6500 K: cct 6485 via applySourcePreset', w.cct === 6485, w);
  ok('amber tints the lamp amber: 1800 K has R > G > B and R/B far above the 6500 K one', a.rgb[0] > a.rgb[1] && a.rgb[1] > a.rgb[2] && a.rgb[0] / Math.max(a.rgb[2], 1e-9) > 10 && w.rgb[0] / Math.max(w.rgb[2], 1e-9) < 1.2, { amber: a.rgb, cool: w.rgb });
  ok('PC Amber 1500K class (k3-71860) still unset through the same path', tint['k3-71860'].cct === undefined, tint['k3-71860']);
  ok('no page errors', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\nLV lhp531 picker checks: ' + (n - fails) + ' passed, ' + fails + ' failed, of ' + n);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('[FAIL] harness error', e); process.exit(1); });
