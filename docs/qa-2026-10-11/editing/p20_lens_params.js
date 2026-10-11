const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  await page.evaluate(() => { let e = document.getElementById('lens-list'); while (e && e.id !== 'side') { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } });
  const nanCheck = () => page.evaluate(() => { const sv = RF.UI.store.scene.groups.L.surfaces; const bad = sv.filter((s) => JSON.stringify(s).includes('null') || /NaN|Infinity/.test(JSON.stringify(s, (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v)))); const rep = RF.UI.store.reports.L || {}; return { n: sv.length, badN: bad.length, firstBad: bad[0] ? JSON.stringify(bad[0], (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v)).slice(0, 220) : null, rep: JSON.stringify(rep).slice(0, 200), lens: JSON.stringify(RF.UI.store.scene.lenses.map((l) => l.params)).slice(0, 200) }; });
  const results = [];
  for (const kind of ['planoconvex', 'biconvex', 'asphere', 'tir', 'fresnel']) {
    await page.evaluate(() => { for (const l of RF.UI.store.scene.lenses.slice()) RF.UI.removeLens(l.id); });
    await page.selectOption('#lens-kind', kind); await page.click('text=Add lens'); await page.waitForTimeout(300);
    const keys = await page.evaluate(() => [...document.querySelectorAll('#lens-list input[data-lens]')].map((i) => i.getAttribute('data-lens')));
    for (const key of keys) for (const v of ['0', '-10', '1e6']) {
      const before = errors.length;
      const sel = `#lens-list input[data-lens="${key}"]`;
      const orig = await page.$eval(sel, (i) => i.value);
      await page.fill(sel, v); await page.press(sel, 'Tab'); await page.waitForTimeout(250);
      const c = await nanCheck();
      if (c.badN || errors.length > before) results.push({ kind, key, v, ...c, err: errors.slice(before, before + 1).map((e) => e.split('\n').slice(0, 2).join(' ')) });
      await page.fill(`#lens-list input[data-lens="${key}"]`, orig); await page.press(`#lens-list input[data-lens="${key}"]`, 'Tab'); await page.waitForTimeout(150);
    }
  }
  console.log(JSON.stringify(results, null, 1));
  console.log('total errors', errors.length, [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
