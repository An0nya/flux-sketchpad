// Emitter presets through the UI select (#source-preset): every preset, then pairwise leftovers, drive current edge values.
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  const ids = await page.evaluate(() => [...document.querySelectorAll('#source-preset select[aria-label="Emitter preset"] option')].map((o) => o.value).filter(Boolean));
  console.log('presets', ids.length);
  const pick = async (id) => { await page.selectOption('#source-preset select[aria-label="Emitter preset"]', id); await page.waitForTimeout(150); };
  const src = () => page.evaluate(() => { const s = RF.UI.store.scene.source; const bad = Object.entries(s).filter(([k, v]) => typeof v === 'number' && !isFinite(v)).map(([k]) => k);
    return { s: JSON.parse(JSON.stringify(s)), bad, help: document.getElementById('source-preset').innerText.replace(/\s+/g, ' ').slice(0, 400), matches: RF.SourcePresets.matches(s) }; });
  const fresh = {};
  for (const id of ids) { await pick(id); const r = await src(); fresh[id] = r.s; if (r.bad.length || /NaN|Infinity|undefined/.test(r.help) || !r.matches) console.log('PRESET', id, 'bad=', r.bad, 'matches=', r.matches, /NaN|Infinity|undefined/.test(r.help) ? r.help : ''); }
  // leftovers: apply A then B, compare to B applied after the default ('generic')
  const strip = (s) => { const o = Object.assign({}, s); delete o.pos; return o; };
  let n = 0;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue; if (++n % 7) continue;   // sample ~1/7 of the pairs
    await pick('generic'); await pick(b); const ref = strip((await src()).s);
    await pick(a); await pick(b); const got = strip((await src()).s);
    const keys = [...new Set([...Object.keys(ref), ...Object.keys(got)])].filter((k) => JSON.stringify(ref[k]) !== JSON.stringify(got[k]));
    if (keys.length) console.log('LEAK', a, '→', b, keys.map((k) => k + ': ' + JSON.stringify(got[k]) + ' vs ' + JSON.stringify(ref[k])).join(' | '));
  }
  // drive current edge values on an LED with drive
  const ledId = ids.find((i) => /519a/.test(i)) || ids[1]; await pick(ledId);
  for (const v of ['0', '-1', 'abc', '0.0001', '1e9', '']) {
    await page.fill('#source-preset input[aria-label="Drive current (A)"]', v); await page.press('#source-preset input[aria-label="Drive current (A)"]', 'Enter'); await page.dispatchEvent('#source-preset input[aria-label="Drive current (A)"]', 'change'); await page.waitForTimeout(150);
    const r = await src(); console.log('drive', JSON.stringify(v).padEnd(9), 'driveA', r.s.driveA, 'power', r.s.power, 'w', r.s.w, 'field', await page.inputValue('#source-preset input[aria-label="Drive current (A)"]'), r.bad.length ? 'BAD ' + r.bad : '', '|', r.help.slice(0, 160));
  }
  console.log('errors', [...new Set(errors)].slice(0, 4));
  require('fs').writeFileSync('probe12_fresh.json', JSON.stringify(fresh, null, 1));
  await browser.close();
})();
