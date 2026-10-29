// BRIEF J item 1: the pass shadow maps are rendered only when their inputs change (lamp eyes, nLamp, carFromWorld, ribbon geometry).
// Checks, on a touge pass frame with the halo on (MG2-default-lamp, the TOUGE-HALO-TILT scene):
//   (1) a still frame (same dist, same pose) skips both shadow renders (shadowStats().runs does not move, skips does);
//   (2) the skipped frame is byte-identical to the frame that rendered them;
//   (3) moving away (dist 1028) changes the frame, and coming back (1332) re-renders the maps and reproduces the first frame byte-for-byte;
//   (4) the first frame at 1332 matches the pre-change hash (pinned: the same frame on main before BRIEF J item 1, measured with the same clip).
// Not covered here: a lamp-only change or a pitch-only change at the same dist (the key includes them; no page control moves them alone).
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/BJ1-shadow-cache.js <port>
// UI step C (2026-10-29): the frame is the drive canvas pinned at page 0,0 (was the page region y >= 140, which sat on the canvas only while the large view had
// its 30 px header; the layout shell dropped it and the region moved off the picture). Pins below re-baselined for that capture (old -> new: 576735c5 -> b9356772); the halo tables (bin, cum) still match.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const PIN_DIP = 'b93567722039b519';   // BRIEF J: pass_dip_1332 on main d20fe9d (clip y 140, 912x373), before the skip; unchanged after
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'BJ1-shadow-cache'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    await page.evaluate(() => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16, samples: '1', haloPolar: 'off' })) V.setOwn(k, v); });   // SP: haloPolar off pinned explicitly (the default is auto since SP); the pin holds with off
    const stats = () => page.evaluate(() => RF.DriveAnim._.V.three.shadowStats());
    // one frame at dist d; returns the screenshot and the shadow counters before and after the frame
    const frame = async (d) => {
      const a = await stats();
      await page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200)); }, d);
      const b = await stats();
      const shot = await (await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); }), page.screenshot({ clip: { x: 0, y: 0, width: 912, height: 373 } }));
      return { shot, sha: sha(shot), runs: b.runs - a.runs, skips: b.skips - a.skips };
    };
    const touge = await page.evaluate(() => !!RF.DriveAnim._.V.p.touge);
    ok('the scene is a touge pass frame', touge, { touge });
    const A1 = await frame(1332);
    const A2 = await frame(1332);
    ok('still frame: shadow maps not re-rendered, the frame is skipped', A2.runs === 0 && A2.skips >= 1, { runs: A2.runs, skips: A2.skips });
    ok('still frame is byte-identical to the frame that rendered the maps', A2.sha === A1.sha, { first: A1.sha, still: A2.sha });
    ok('first pass frame at dist 1332 matches the pre-change hash (' + PIN_DIP + ')', A1.sha === PIN_DIP, { hash: A1.sha });
    const B = await frame(1028);
    ok('moving to dist 1028 re-renders the maps and changes the frame', B.runs >= 1 && B.sha !== A1.sha, { runs: B.runs, sha: B.sha });
    const A3 = await frame(1332);
    ok('back at dist 1332: maps re-rendered and the frame reproduces the first one', A3.runs >= 1 && A3.sha === A1.sha, { runs: A3.runs, sha: A3.sha });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
