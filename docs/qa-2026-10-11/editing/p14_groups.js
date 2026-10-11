const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  const G = () => page.evaluate(() => { const sc = RF.UI.store.scene; const o = {}; for (const [k, g] of Object.entries(sc.groups)) o[k] = (g.enabled ? 'on' : 'off') + ':' + g.surfaces.length; return { mode: sc.mode, groups: o, paint: sc.modeA.paint.filter((x) => x > 0).length, dirtyA: RF.UI.store.dirty.has('A'), solving: !!RF.UI.solving, rows: [...document.querySelectorAll('#group-list .item')].map((e) => e.textContent.trim()), foot: document.getElementById('min-row').innerText.replace(/\n/g, ' ').slice(0, 120), past: RF.UI.hist.past.slice(-1).map((e) => e.label) }; });
  await page.evaluate(() => { let e = document.getElementById('group-list'); while (e && e.id !== 'side') { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } });
  console.log('start', JSON.stringify(await G()));
  // open the section if collapsed: click the 'clear' of group A twice (confirm)
  const clickClear = async (label) => { const ok = await page.evaluate((label) => { const it = [...document.querySelectorAll('#group-list .item')].find((e) => e.textContent.includes(label)); if (!it) return 'no row'; const b = it.querySelector('button'); if (!b) return 'no button'; b.scrollIntoView(); return 'ok'; }, label); if (ok !== 'ok') return ok; const b = await page.evaluateHandle((label) => [...document.querySelectorAll('#group-list .item')].find((e) => e.textContent.includes(label)).querySelector('button'), label); await b.click(); await page.waitForTimeout(100); const b2 = await page.evaluateHandle((label) => [...document.querySelectorAll('#group-list .item')].find((e) => e.textContent.includes(label)).querySelector('button'), label); await b2.click(); await page.waitForTimeout(500); return 'clicked'; };
  const rowA = (await G()).rows[0].split(' — ')[0];
  console.log('clear A:', await clickClear(rowA), JSON.stringify(await G()));
  // now an unrelated edit that invalidates A: move the source slightly via action
  await page.evaluate(() => { const p = RF.UI.store.scene.source.pos.slice(); p[0] += 0.5; RF.Controller.actions.moveSource(RF.UI.store, p); RF.UI.afterChange(); });
  await page.waitForTimeout(1500); await L.idle(page);
  console.log('after source nudge', JSON.stringify(await G()));
  // undo the clear?
  await page.click('#btn-undo'); await page.waitForTimeout(300); await L.idle(page);
  console.log('undo1', JSON.stringify(await G()), await page.evaluate(() => document.getElementById('toast').textContent));
  // toggle group A off, switch mode B and back to A
  await page.evaluate(() => { const cb = document.querySelector('#group-list .item input'); cb.click(); });
  await page.waitForTimeout(300); console.log('A unchecked', JSON.stringify(await G()));
  await L.setMode(page, 'B'); await L.setMode(page, 'A'); await page.waitForTimeout(300);
  console.log('after B→A', JSON.stringify(await G()));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
