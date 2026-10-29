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
    await page.evaluate(() => { RF.DriveLayout.reveal(RF.UI, '[data-anim=scene-details]'); });   // UI step C: the toggle lives in the Details tab (was More)
    const inMore = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-anim=scene-details]')]; return { count: c.length, inMore: c.length === 1 && !!c[0].closest('[data-dl-pane=details]') && c[0].checkVisibility() }; });
    ok('OV the toggle is reachable exactly once, in the Details tab', inMore.count === 1 && inMore.inMore, inMore);
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
        const want = Array.isArray(r.shown) ? r.shown.join('\n') : r.shown;
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

    // 7. oncoming (traffic on in this drive) and glare (off in this drive): the list rows carry peaks at or above their lux, and glare is greyed out
    const onc = await page.evaluate(() => {
      const st = RF.DriveAnim.details(), r = st.rows.find((q) => q.id === 'oncoming'), v = st.rows.find((q) => q.id === 'veil');
      const peakOk = Array.isArray(r.value) ? r.value.every((x) => Number.isNaN(x.peak) || x.peak >= x.lux - 1e-9) : true;
      const gs = st.rows.find((q) => q.id === 'glareSetting');
      return { onc: r.na, rows: Array.isArray(r.value) ? r.value.length : r.value, shown: r.shown, peakOk, veilShown: v.shown, glareSetting: gs.shown };
    });
    ok('OV oncoming: traffic on lists its cars (or says none), each peak is at least its lux', onc.onc === null && onc.peakOk, onc);
    ok('OV glare off: the veiling luminance is still shown (raw veilAt) and the glare setting says the veil is not in the picture', typeof onc.veilShown === 'string' && !onc.veilShown.startsWith('n/a') && onc.glareSetting.startsWith('glare off'), onc);
    // 6b. hazards, beam reach and lamp: counts are whole numbers in order (inView <= near, lit <= near), the reach is a distance or 'over 300 m'
    const hz = await page.evaluate(() => {
      const rows = RF.DriveAnim.details().rows, g = (id) => rows.find((q) => q.id === id);
      const n = g('hazNear').value, v = g('hazView').value, l = g('hazLit').value;
      return { n, v, l, litDist: g('hazLitDist').shown, reach: g('reach').shown, reachValue: g('reach').value, lamp: g('lamp').value, hazNa: g('hazNear').na };
    });
    ok('OV hazards: whole counts with inView <= near and lit <= near', hz.hazNa === null && [hz.n, hz.v, hz.l].every((x) => Number.isInteger(x) && x >= 0) && hz.v <= hz.n && hz.l <= hz.n, hz);
    ok('OV beam reach: a distance (or over 300 m) and the built-in lamp', typeof hz.reach === 'string' && hz.reach !== '—' && hz.lamp === 'built-in', hz);
    // 6a. high beam: the oncoming lux is above zero for at least one car (low beam is cut off above the horizon: the eye gets ~0 lx)
    await page.locator('[data-anim=high-beam]').click();              // off -> on
    await page.waitForTimeout(600);
    const hi = await page.evaluate(() => { const r = RF.DriveAnim.details().rows.find((q) => q.id === 'oncoming'); return Array.isArray(r.value) ? r.value.map((x) => x.lux) : r.shown; });
    ok('OV high beam: at least one oncoming car gets more than 0 lx at its eye', Array.isArray(hi) && hi.some((v) => v > 0), hi);
    await page.locator('[data-anim=high-beam]').click();              // on -> auto
    await page.locator('[data-anim=high-beam]').click();              // auto -> off (back to the state the frame hash used)
    // 6. toggle off: panel removed, timer cleared, API empty
    await page.evaluate(() => { RF.DriveLayout.reveal(RF.UI, '[data-anim=scene-details]'); });
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
