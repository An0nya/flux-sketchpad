const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  const o = await L.rect(page, 'surface-canvas');
  await L.activate(page, 'surface-canvas');
  // find a screen point on a high-index facet: project its centroid
  const tgt = await page.evaluate(() => { const sc = RF.UI.store.scene, fs = sc.groups.A.surfaces; const f = fs[fs.length - 1]; const c = f.P || (f.verts && f.verts[0]); const q = RF.UI.camS.project(c); return { id: f.id, n: fs.length, q }; });
  console.log('target facet', JSON.stringify(tgt));
  await page.mouse.click(o.x + tgt.q[0], o.y + tgt.q[1]); await page.waitForTimeout(500);
  const S = () => page.evaluate(() => ({ sel: RF.UI.sel, nA: RF.UI.store.scene.groups.A.surfaces.length, ids: RF.UI.store.scene.groups.A.surfaces.slice(-2).map((s) => s.id), insp: (() => { const p = document.getElementById('insp-panel'); return p.hidden ? 'hidden' : p.innerText.replace(/\n/g, ' | ').slice(0, 200); })(), chip: [...document.querySelectorAll('.sel-chip')].map((c) => c.hidden ? '-' : c.innerText.trim()) }));
  console.log('after tap', JSON.stringify(await S()));
  // shrink the facet budget → re-solve with fewer facets
  await page.evaluate(() => RF.UI.setControl('A.budget', 10));
  await page.evaluate(() => RF.UI.generateA());
  await page.waitForTimeout(500); await L.idle(page); await page.waitForTimeout(800);
  console.log('after budget 10 solve', JSON.stringify(await S()));
  await page.screenshot({ path: L.DIR + '/shots/p17_select.png' });
  console.log('errors', JSON.stringify([...new Set(errors)].slice(0,3), null, 1)); const after = await page.evaluate(() => ({ status: document.getElementById('run-state').textContent, next: RF.UI.run.ctx.next, N: RF.UI.run.ctx.N, done: RF.UI.run.ctx.done })); console.log('trace', JSON.stringify(after));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
