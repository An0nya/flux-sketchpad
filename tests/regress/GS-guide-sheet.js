// GS: first-visit guide must not cover the top bar, drive bar, pane tabs or its own "Got it" button.
// node tests/regress/GS-guide-sheet.js <port>              checks the working CSS at 360, 428 and 1280 wide
// node tests/regress/GS-guide-sheet.js <port> --main-css   POSITIVE CONTROL: same checks with main's app.css (a46cb0b)
//   The control is expected to report overlaps at phone width. Exit 0 = the control detected them.
const path = require('path'), { execFileSync } = require('child_process'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8851), mainCss = process.argv.includes('--main-css'), root = path.join(__dirname, '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cssServed = 0, mainCssText = null;
if (mainCss) mainCssText = execFileSync('git', ['-C', root, 'show', 'a46cb0b:css/app.css'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

const results = []; const log = (tag, name, detail) => { results.push({ tag, name, detail }); console.log('[' + tag + '] ' + name + (detail ? ' — ' + detail : '')); };

async function checkWidth(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 760 });
  await ctx.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  if (mainCssText !== null) await ctx.route('**/css/app.css', route => { cssServed++; route.fulfill({ status: 200, contentType: 'text/css', headers: { 'Cache-Control': 'no-store' }, body: mainCssText }); });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
  const tag = width + 'x' + height;

  for (const state of ['boot', 'drive']) {
    if (state === 'drive') { await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); }
    await sleep(300);
    // Pull rects and do the overlap math in Node (UX2's helpers are duplicated above), using UX2's shown() clipping in-page.
    const data = await page.evaluate(() => {
      const shown = e => { let r = e.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { if (!/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(p).overflowY)) continue; const c = p.getBoundingClientRect(); L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom); } return { left: L, top: T, right: R, bottom: B }; };
      const vis = e => !!e && !e.hidden && e.checkVisibility() && e.getBoundingClientRect().height > 0;
      const guide = document.getElementById('first-guide'), got = document.getElementById('guide-close');
      const bar = RF.UI.driveBar;
      const controls = bar && vis(bar) ? [...bar.querySelectorAll('.drive-primary button,.drive-primary input,.drive-primary select,.drive-primary summary')].filter(e => !e.closest('.drive-extras') && vis(e)) : [];
      const pack = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      return { vw: innerWidth, vh: innerHeight, guideVisible: vis(guide), guide: pack(guide), guideTop: getComputedStyle(guide).top, guideShown: shown(guide),
        got: vis(got) ? { rect: pack(got), shown: shown(got) } : null,
        top: vis(document.querySelector('.topbar')) ? { rect: pack(document.querySelector('.topbar')), shown: shown(document.querySelector('.topbar')) } : null,
        tabs: vis(document.getElementById('pane-tabs')) ? { rect: pack(document.getElementById('pane-tabs')), shown: shown(document.getElementById('pane-tabs')) } : null,
        bar: vis(bar) ? { rect: pack(bar), shown: shown(bar) } : null,
        controls: controls.map(e => { const s = shown(e); const cx = (s.left + s.right) / 2, cy = (s.top + s.bottom) / 2; const hit = document.elementFromPoint(cx, cy); return { label: (e.dataset.dv || e.dataset.anim || e.dataset.game || e.textContent || e.tagName).trim().slice(0, 24), area: Math.max(0, s.right - s.left) * Math.max(0, s.bottom - s.top), cx, cy, inView: cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight, hitOk: !!hit && e.contains(hit), hitTag: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 40) : 'null' }; }) };
    });
    const o = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const f = r => [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)).join(',');
    const name = tagPart => tag + ' ' + state + ' ' + tagPart;

    log(data.guideVisible ? 'PASS' : 'FAIL', name('guide visible'), data.guideVisible ? 'guide top=' + data.guideTop + ' rect=' + f(data.guide) : 'guide hidden');
    if (!data.guideVisible) continue;

    // Got it: fully on screen and not clipped by the sheet's own scroll area
    if (!data.got) log('FAIL', name('Got it visible'), 'button not visible');
    else {
      const g = data.got.rect, gs = data.got.shown;
      const onScreen = g.left >= 0 && g.top >= 0 && g.right <= data.vw && g.bottom <= data.vh;
      const full = Math.abs((gs.right - gs.left) * (gs.bottom - gs.top) - (g.right - g.left) * (g.bottom - g.top)) < 2;
      log(onScreen && full ? 'PASS' : 'FAIL', name('Got it fully on screen'), 'rect=' + f(g) + ' shown=' + f(gs) + (onScreen ? '' : ' (outside viewport)') + (full ? '' : ' (clipped by sheet)'));
    }

    // Overlaps: guide vs each target that is actually rendered at this state
    const targets = [['top bar', data.top], ['pane tabs', data.tabs], ['drive bar', data.bar]];
    for (const [label, t] of targets) {
      if (!t) { log('SKIP', name('guide vs ' + label), 'not rendered at this width/state'); continue; }
      const hit = o(data.guideShown, t.shown);
      log(hit ? 'FAIL' : 'PASS', name('guide does not overlap ' + label), hit ? 'overlaps ' + label + ' target=' + f(t.shown) + ' guide=' + f(data.guideShown) : 'target=' + f(t.shown));
    }

    // Drive bar clickability while the guide is open (phone widths only, where the bar can sit under the guide)
    if (state === 'drive') {
      if (!data.controls.length) log('FAIL', name('drive bar controls found'), 'no visible primary controls');
      for (const c of data.controls) {
        const inOk = c.area > 0 && c.inView;
        if (!inOk) { log('FAIL', name('drive control on screen: ' + c.label), 'area=' + Math.round(c.area) + ' centre=' + Math.round(c.cx) + ',' + Math.round(c.cy)); continue; }
        log(c.hitOk ? 'PASS' : 'FAIL', name('drive control clickable: ' + c.label), c.hitOk ? '' : 'elementFromPoint hit ' + c.hitTag);
      }
    }
  }
  if (errors.length) log('FAIL', tag + ' no page errors', JSON.stringify(errors).slice(0, 400));
  else log('PASS', tag + ' no page errors');
  await ctx.close();
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  try {
    for (const [w, h] of [[360, 740], [428, 926], [740, 1000], [900, 700], [1280, 800]]) await checkWidth(browser, w, h);
  } finally { await browser.close(); }
  if (mainCss) {
    const overlapFails = results.filter(r => r.tag === 'FAIL' && /overlaps /.test(r.detail || ''));
    console.log('POSITIVE CONTROL (main css served ' + cssServed + ' times): ' + overlapFails.length + ' overlap FAIL(s)');
    const ok = cssServed > 0 && overlapFails.length > 0;
    console.log(ok ? 'positive control detected the overlap, as expected' : 'POSITIVE CONTROL DID NOT DETECT OVERLAP');
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const fails = results.filter(r => r.tag === 'FAIL').length, passes = results.filter(r => r.tag === 'PASS').length, skips = results.filter(r => r.tag === 'SKIP').length;
  console.log('GS summary: ' + passes + ' pass, ' + fails + ' fail, ' + skips + ' skip');
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
