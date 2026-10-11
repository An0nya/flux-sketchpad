let pw; try { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); } catch (e) { pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright'); }
const PORT = 8801, URL = 'http://localhost:' + PORT + '/index.html', SH = __dirname + '/shots/';
async function open(opts = {}) {
  const browser = opts.browser || await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1500, height: 950 }, colorScheme: opts.colorScheme || 'dark', hasTouch: !!opts.touch, isMobile: !!opts.mobile });
  const page = await ctx.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e)));
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(URL);
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const title = await page.title(); if (!/Flux/.test(title)) throw new Error('wrong page ' + title);
  return { browser, ctx, page, errors };
}
// blankness of each canvas: fraction of non-background pixels, and whether its backing store matches its CSS box
async function canvases(page) {
  return page.evaluate(() => {
    const out = {};
    for (const id of ['scene-canvas', 'left-canvas', 'heat-canvas', 'surface-canvas']) {
      const c = document.getElementById(id), r = c.getBoundingClientRect();
      let nonbg = null;
      try { if (c.width && c.height) { const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; const bg = [d[0], d[1], d[2], d[3]]; let n = 0, tot = 0;
        for (let i = 0; i < d.length; i += 4 * 7) { tot++; if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) + Math.abs(d[i + 3] - bg[3]) > 12) n++; } nonbg = +(n / tot).toFixed(4); } } catch (e) { nonbg = 'err ' + e.message; }
      out[id] = { css: [Math.round(r.width), Math.round(r.height)], store: [c.width, c.height], nonbg, vis: r.width > 0 && r.height > 0 };
    }
    return out;
  });
}
// page-level overflow: horizontal scroll and elements sticking out of the viewport or their pane
async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth, res = { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, offRight: [], clipped: [] };
    for (const el of document.querySelectorAll('button, select, input, label, h2, figcaption, .tile, output, .seg')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
      if (el.closest('#sidebar') && document.body.classList.contains('side-hidden')) continue;
      if (r.right > vw + 1 || r.left < -1) res.offRight.push((el.id || el.className || el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 20) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
      const pane = el.closest('.pane');
      if (pane && !pane.classList.contains('collapsed')) { const p = pane.getBoundingClientRect(); if (r.right > p.right + 1 || r.bottom > p.bottom + 1) res.clipped.push(pane.dataset.pane + ': ' + (el.id || el.dataset.disp || el.dataset.mode || el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 16) + ' r' + Math.round(r.right - p.right) + ' b' + Math.round(r.bottom - p.bottom)); }
    }
    return res;
  });
}
module.exports = { pw, open, canvases, overflow, SH, URL };
