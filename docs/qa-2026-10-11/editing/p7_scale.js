const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'stamps'); await L.idle(page);
  const S = () => page.evaluate(() => { const sc = RF.UI.store.scene, st = sc.modeB.stamps.find((t) => t.id === sc.modeB.selected), rep = RF.UI.store.reports.B; const f = sc.groups.B.surfaces.find((s) => s.id === 'B' + st.id);
    return { sel: st.id, scale: st.scale, input: (document.querySelector('[data-control="B.scale"]') || {}).value, rep: rep && JSON.stringify(rep).slice(0, 400), facet: f ? { P: f.P && f.P.map((x) => +x.toFixed(1)), kind: f.kind, keys: Object.keys(f).join(',') } : null }; });
  console.log('start', JSON.stringify(await S()));
  for (const v of ['100000', '0.001', '-50', 'abc', '']) {
    const inp = await page.$('input.scrub[data-control="B.scale"]');
    if (!inp) { console.log('no input'); break; }
    await inp.fill(v); await inp.press('Enter'); await page.waitForTimeout(400);
    console.log('set', JSON.stringify(v), JSON.stringify(await S()));
  }
  const txt = await page.evaluate(() => [...document.querySelectorAll('#side .note, #side .warn, #side .help')].map((e) => e.textContent).filter((t) => /clamp|scale|tile/i.test(t)).slice(0, 6));
  console.log('notes', JSON.stringify(txt));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
