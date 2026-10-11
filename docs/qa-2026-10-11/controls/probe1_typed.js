// For every text number field: type each bad value (change event = the typed path), read back stored value + field display.
const { boot } = require('./h.js');
const VALS = ['', 'abc', '0', '-5', '-1e9', '1e9', '1e300', '1e400', '3.7', '5abc', '0.0001', '-0'];
(async () => {
  const { browser, page, errors } = await boot();
  const out = await page.evaluate((VALS) => {
    const ui = RF.UI, C = RF.Controller, res = [];
    const base = RF.State.serialize(ui.store.scene);
    const scanBad = (o, p = '') => { const bad = []; const w = (x, p) => { if (typeof x === 'number' && !isFinite(x)) bad.push(p + '=' + x); else if (x && typeof x === 'object') for (const k of Object.keys(x)) { if (k === 'surfaces' || k === 'paint') continue; w(x[k], p + '.' + k); } }; w(o, p); return bad; };
    for (const f of document.querySelectorAll('#side input.scrub[data-control]')) {
      const id = f.dataset.control, c = C.BY_ID[id];
      for (const v of VALS) {
        ui.loadScene(RF.State.deserialize(base), null, true);   // fresh
        // controls that need a precondition
        const sc = ui.store.scene;
        if (id.startsWith('src.dome') && id !== 'src.domeR') sc.source.dome = { r: 3, n: 1.41, z: 0 };
        if (id.startsWith('aim.')) sc.target.linked = false;
        ui.refreshPanels();
        const fld = document.querySelector('#side input.scrub[data-control="' + id + '"]');
        const before = c.get(ui.store);
        fld.value = v; fld.dispatchEvent(new Event('change'));
        ui.refreshPanels();
        const after = c.get(ui.store), disp = document.querySelector('#side input.scrub[data-control="' + id + '"]').value;
        res.push({ id, v, before, after, disp, bad: scanBad(ui.store.scene).join(' ') });
      }
    }
    return res;
  }, VALS);
  const fs = require('fs'); fs.writeFileSync('probe1_typed.json', JSON.stringify(out, null, 0));
  for (const r of out) { const d = String(r.after) !== String(r.disp) && !(Math.abs(+r.after - +r.disp) < 1e-6 * Math.max(1, Math.abs(+r.after))); if (r.bad || d || ['1e300','1e9','-1e9','-5'].includes(r.v)) console.log(r.id.padEnd(10), JSON.stringify(r.v).padEnd(9), 'before', r.before, 'after', r.after, 'disp', JSON.stringify(r.disp), r.bad ? 'NONFINITE ' + r.bad : '', d ? 'DISPLAY≠STORE' : ''); }
  console.log('errors', errors.slice(0, 5));
  await browser.close();
})();
