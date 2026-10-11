const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  await page.evaluate(() => { let e = document.getElementById('lens-list'); while (e && e.id !== 'side') { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } });
  await page.selectOption('#lens-kind', 'planoconvex'); await page.click('text=Add lens'); await page.waitForTimeout(300);
  // untick "Place at focus (auto)"
  await page.evaluate(() => { const row = [...document.querySelectorAll('#lens-list .row')].find((r) => /Place at focus/.test(r.textContent)); row.querySelector('input').click(); });
  await page.waitForTimeout(300);
  const dSel = await page.evaluateHandle(() => { const row = [...document.querySelectorAll('#lens-list .row')].find((r) => /Distance from source/.test(r.textContent)); return row.querySelector('input'); });
  await dSel.fill(''); await dSel.press('Tab'); await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({ d: RF.UI.store.scene.lenses[0].params.d, ser: JSON.stringify(RF.UI.store.scene.lenses[0].params), surfs: RF.UI.store.scene.groups.L.surfaces.length, seg0: JSON.stringify(RF.UI.store.scene.groups.L.surfaces[0] && RF.UI.store.scene.groups.L.surfaces[0].seg), info: JSON.stringify((RF.UI.store.reports.L || {})), foot: document.getElementById('min-row').innerText.replace(/\n/g, ' ').slice(0, 150), notices: RF.UI.store.notices.slice(0, 2).map((n) => n.msg.slice(0, 100)), dField: (() => { const row = [...document.querySelectorAll('#lens-list .row')].find((r) => /Distance from source/.test(r.textContent)); return row && row.querySelector('input').value; })() }));
  console.log(JSON.stringify(st, null, 1));
  // does it survive save/reload (localStorage autosave)?
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(() => { const k = Object.keys(localStorage).find((k) => /scene|autosave/i.test(k)); return k ? [k, (localStorage.getItem(k).match(/"d":[^,}]*/) || [])[0]] : Object.keys(localStorage); });
  console.log('saved', JSON.stringify(saved));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
