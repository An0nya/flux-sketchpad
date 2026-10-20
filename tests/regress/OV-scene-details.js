// OV page checks: the scene details panel (drive view). Serve the worktree first: python3 tests/serve.py <port> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/OV-scene-details.js <port>
// Checks: toggling on shows one row per registry metric in the DOM; the rows follow the car (the road radius changes between two
// places on a curved stretch); RF.DriveAnim.details() matches the DOM text row for row; the panel refreshes about 4 times a second;
// the rendered frame is the same bytes with the panel on and off (the panel only reads state); toggling off removes the DOM and the
// timer; no page or console errors.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8995);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
    // rural drive with a bend that changes along the road (tiles on), paused, CPU renderer, multithreading off, samples per pixel pinned
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 1, seed: 19, glare: 'off', mt: false, wild: false, dynamicResolution: false, gpuRenderer: false, oncoming: true, preceding: false, tiles: true, mountainPass: false, speed: 50 })); });
    await page.goto('http://localhost:' + port + '/index.html');
    await page.evaluate(async () => {
      const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'OV fixture'); u.setMode('D');
      for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
      u.setDisplay('drive');
    });
    await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p, null, { timeout: 120000 });
    await page.evaluate(() => { RF.DriveAnim._.V.pinSS = 2; });

    // 1. the frame is the same bytes before and after the panel is switched on (the panel does not touch the picture)
    const hashNow = () => page.evaluate(() => { const px = RF.DriveAnim._.readCanvas(); let h = 2166136261; for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619) >>> 0; return h; });
    await page.evaluate(() => RF.DriveAnim._.frame());
    const hOff = await hashNow();

    // 2. toggle on from the bar: pressed state, panel with one row per registry metric
    await page.evaluate(() => { const u = RF.UI; u.driveBar.querySelector('.drive-more').open = true; RF.DriveAnim.layoutControls(u); });
    await page.locator('[data-anim=scene-details]').click();
    await page.waitForFunction(() => !!document.querySelector('.drive-details'), null, { timeout: 5000 }).catch(() => {});
    const on = await page.evaluate(() => ({
      pressed: document.querySelector('[data-anim=scene-details]').getAttribute('aria-pressed'),
      panels: document.querySelectorAll('.drive-details').length,
      rows: document.querySelectorAll('.drive-details [data-metric]').length,
      metrics: RF.SceneDetails.METRICS.length,
      timer: !!RF.DriveAnim._.V.detailsTimer,
    }));
    ok('OV toggle on: button pressed, one panel, one row per registry metric', on.pressed === 'true' && on.panels === 1 && on.rows === on.metrics && on.timer, on);
    const hOn = await hashNow();
    ok('OV frame is the same bytes with the panel on as off (the panel only reads state)', hOn === hOff, { hOff, hOn });

    // 3. the stats API matches the DOM, row for row (same tick: both are written together)
    const cmp = await page.evaluate(() => {
      const st = RF.DriveAnim.details(), bad = [];
      for (const r of st.rows) {
        const row = document.querySelector('.drive-details [data-metric="' + r.id + '"]');
        const shown = row ? row.querySelector('.dd-value').textContent : '(missing row)';
        const want = r.na ? 'n/a (' + r.na + ')' : RF.SceneDetails.format(r.value, r.unit) + (typeof r.value === 'number' && isFinite(r.value) && r.unit ? ' ' + r.unit : '');
        if (shown !== want) bad.push({ id: r.id, shown, want });
      }
      return { n: st.rows.length, bad };
    });
    ok('OV stats API matches the DOM text for every row', cmp.n === on.metrics && cmp.bad.length === 0, cmp);

    // 4. the rows follow the car: on a curved stretch, the road radius differs between a straight point and a bend
    const bend = await page.evaluate(() => {
      const D = RF.DriveAnim, a = D._, u = RF.UI, st = a.S(u), src = a.V.src;
      let straight = null, bent = null;
      for (let x = 0; x < 3000 && (straight === null || bent === null); x += 5) { const k = D.curvatureAt(src, x); if (k === 0 && straight === null) straight = x; if (Math.abs(k) > 1 / 400 && bent === null) bent = x; }
      if (straight === null || bent === null) return { found: false };
      const readRadius = () => { const r = RF.DriveAnim.details().rows.find((q) => q.id === 'radius'); return r.value; };
      st.dist = straight; a.frame(); const rAt = [];
      rAt.push(['straight', straight, readRadius()]);
      st.dist = bent; a.frame(); rAt.push(['bend', bent, readRadius()]);
      return { found: true, rAt, st: st.dist };
    });
    // the tick reads the state every 250 ms: wait for two ticks at each place, then read the API
    async function radiusAt(d) {
      await page.evaluate((dd) => { const a = RF.DriveAnim._; a.S(RF.UI).dist = dd; a.frame(); }, d);
      await page.waitForTimeout(600);
      return page.evaluate(() => { const r = RF.DriveAnim.details().rows.find((q) => q.id === 'radius'); return { value: r.value, text: document.querySelector('.drive-details [data-metric=radius] .dd-value').textContent }; });
    }
    if (bend.found) {
      const s = await radiusAt(bend.rAt[0][1]), b = await radiusAt(bend.rAt[1][1]);
      ok('OV rows follow the car: the road radius differs between a straight point and a bend', s.value !== b.value && s.text !== b.text, { straight: s, bend: b, at: bend.rAt });
    } else ok('OV rows follow the car: a straight point and a bend exist on this road', false, bend);

    // 5. about 4 refreshes a second: distinct snapshot times over 1.2 s
    const ticks = await page.evaluate(async () => {
      const seen = new Set(); const t0 = performance.now();
      while (performance.now() - t0 < 1200) { const d = RF.DriveAnim.details(); if (d) seen.add(d.t); await new Promise((r) => setTimeout(r, 20)); }
      return seen.size;
    });
    ok('OV refreshes about 4 times a second (3 to 7 distinct snapshots in 1.2 s; 250 ms period)', ticks >= 3 && ticks <= 7, { ticks });

    // 6. toggle off: panel removed, timer cleared, API empty
    await page.evaluate(() => { const u = RF.UI; u.driveBar.querySelector('.drive-more').open = true; RF.DriveAnim.layoutControls(u); });
    await page.locator('[data-anim=scene-details]').click();
    await page.waitForTimeout(400);
    const off = await page.evaluate(() => ({
      pressed: document.querySelector('[data-anim=scene-details]').getAttribute('aria-pressed'),
      panels: document.querySelectorAll('.drive-details').length,
      timer: RF.DriveAnim._.V.detailsTimer || 0,
      api: RF.DriveAnim.details(),
    }));
    ok('OV toggle off removes the DOM, clears the timer and empties the API', off.pressed === 'false' && off.panels === 0 && off.timer === 0 && off.api === null, off);
    const hOff2 = await hashNow();
    ok('OV frame after toggling off is the same bytes as before', hOff2 === hOff, { hOff, hOff2 });

    ok('OV no page or console errors', errors.length === 0, errors.slice(0, 5));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all OV checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
