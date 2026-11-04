// BRIEF J item 2: the halo table march skips a lamp when its bin lies entirely behind the lamp's forward plane (drive-three-halo.js TMAIN).
// That skip must not change any output. This test pins the halo table texels (bin = the per-bin table, cum = the prefix-summed table the lookup reads)
// and the frame at four poses, and the polar-table frame, on the MG2-default-lamp scene with the halo on.
// The pins were measured before the change (main d20fe9d plus BRIEF J item 1, which does not touch the table) with the same hook: no pin moved.
// Hashes are of the raw half-float texels (haloTableBytes) and of the clip PNG (y 140, 912x373), as tests/regress/BJ1-shadow-cache.js.
// E2 part 2 (2026-10-27): pass lamp heads now carry their street direction, so the lamp cone (default 'auto' = on in mist) draws on a pass frame for the first time and adds light to the
// pass frames (2 pass frame pins moved, valley 1028 and equal 1084; the bin and cum tables, the dip frame and the flat frame did not). The test sets lampCone 'off' so it keeps pinning the halo table; the old pins are the proof: with the cone off they are reproduced as they were.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/BJ2-halo-table-pin.js <port>
// UI step C (2026-10-29): the frame is the drive canvas pinned at page 0,0 (was the page region y >= 140, which sat on the canvas only while the large view had
// its 30 px header; the layout shell dropped it and the region moved off the picture). Pins below re-baselined for that capture (old -> new: 576735c5 -> b9356772, 5e0d737e -> b3162339, c6a2fdc3 -> e5efe912, cad1ecc0 -> 95fb939b, 4deb111a -> 33b9dd76); the halo tables (bin, cum) still match.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const PINS = {
// RE-PIN 11-03 (murchison halo/cone sweep, rule 23): cum + png pins, bin pins ALL UNCHANGED (raw binned table identical - the change is localised to the cumulative stage: cum = prefix(bin), so identical bin with moved cum means the prefix pass/its inputs changed). Held at the 10-29 UI re-baseline (header: "the halo tables (bin, cum) still match"), first failing in the 11-03 approval run; values byte-identical across Claude's 11-03b list and my run (stable). Candidate for the cum move: the P3/haloMoment work landed in that window and touched cumMat/TCUM (qwen's REVIEW-haloMoment documents TCUM's alpha writes) - named as candidate, exact line-level proof NOT done (no base copy of drive-three-halo.js). pngs: equal/flat cross-agree with TOUGE-HALO-TILT's re-pin (same shared frames).
  pass_dip_1332: { bin: 'f6361435f0dcf102', cum: 'b4302018526c98c0', png: 'b93567722039b519' },
  pass_valley_1028: { bin: '7374948aa7eceeaa', cum: 'ecbf172544844ff8', png: '8e771a02be0f9756' },
  pass_equal_1084: { bin: '897c6b545fd2b54a', cum: '250831d3b2ad2abd', png: 'd670356f99cff27c' },
  flat_60: { bin: '48d585c9b5b15896', cum: 'f13463e4fae167ab', png: 'fb80f2cd8fdd49fc' },
};
const POLAR_PNG = '33b9dd7651760cd6';   // dip frame with the HDX6 polar table (SL_HALO_POLAR); its bin table is not used, so only the frame is pinned
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'BJ2-halo-table-pin'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    await page.evaluate(() => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16, samples: '1', lampCone: 'off', haloPolar: 'off' })   /* SP: haloPolar off pinned explicitly (the default is auto since SP); the pins below are unchanged and hold with off */) V.setOwn(k, v); });
    const capture = async (d, extra) => {
      if (extra) await page.evaluate(extra);
      await page.evaluate(async (dd) => { globalThis.HALO_TILT_OFF = false; RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200)); }, d);
      const shot = await (await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); }), page.screenshot({ clip: { x: 0, y: 0, width: 912, height: 373 } }));
      const t = await page.evaluate(() => { const T = RF.DriveAnim._.V.three; const b = T.haloTableBytes('bin'), c = T.haloTableBytes('cum'); return { bin: b && b.b64, cum: c && c.b64, touge: !!RF.DriveAnim._.V.p.touge, on: T.haloState().on }; });
      return { png: sha(shot), bin: t.bin ? sha(Buffer.from(t.bin, 'base64')) : null, cum: t.cum ? sha(Buffer.from(t.cum, 'base64')) : null, touge: t.touge, on: t.on };
    };
    const names = [['pass_dip_1332', 1332], ['pass_valley_1028', 1028], ['pass_equal_1084', 1084]];
    for (const [name, d] of names) {
      const r = await capture(d);
      const p = PINS[name];
      ok(name + ': halo table (bin and cum) and frame match the pins (halo on, touge)', r.touge && r.on === 1 && r.bin === p.bin && r.cum === p.cum && r.png === p.png, { got: r, pins: p });
    }
    const polar = await capture(1332, () => { globalThis.SL_HALO_POLAR = true; });
    ok('pass_dip_1332 with the polar table: frame matches the pin (' + POLAR_PNG + ')', polar.png === POLAR_PNG, { got: polar.png });
    await page.evaluate(() => { globalThis.SL_HALO_POLAR = false; });
    const flat = await capture(60, () => { RF.DriveAnim._.V.setOwn('mountainPass', false); });
    ok('flat road, traffic halo on: table and frame match the pins', !flat.touge && flat.bin === PINS.flat_60.bin && flat.cum === PINS.flat_60.cum && flat.png === PINS.flat_60.png, { got: flat });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
