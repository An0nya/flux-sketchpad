// POWERLINES regress. Run: python3 tests/serve.py 8811 & node tests/regress/PL1-powerlines.js 8811  (or node tests/gate.js --only PL1-powerlines)
// Checks, on the seeded open road (RF.Drive.wildChunk, the chunk the animated view builds):
//  1 option off (absent or 'off') gives a byte-identical object list
//  2 option on adds only cls 'powerline' objects; the non-powerline objects are unchanged
//  3 each span is 8 segments whose ends meet (within 1e-9), and each span starts and ends on pole xy at the attachment height
//  4 the lowest wire point is above 5 m
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8811);
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.RF && RF.Drive && RF.Drive.wildChunk);
    const r = await page.evaluate(() => {
      const D = RF.Drive, ctx = { Lw: 3.5, us: null, seed: 7, density: 1.5, broken: false };
      const base = { people: false, animals: false, signs: false, posts: true, veg: false, obstacle: false, rpm: false };
      const off = D.wildChunk(ctx, base).objects, offStr = D.wildChunk(ctx, { ...base, powerlines: 'off' }).objects;
      const on = D.wildChunk(ctx, { ...base, powerlines: 'on' }).objects;
      const pls = on.filter((o) => o.cls === 'powerline'), rest = on.filter((o) => o.cls !== 'powerline');
      const ends = (o) => { const h = (o.z1 - o.z0) / 2, a = o.axis || [0, 0, 1]; return [[o.x - a[0] * h, o.y - a[1] * h, o.z0 + (o.z1 - o.z0) / 2 - a[2] * h], [o.x + a[0] * h, o.y + a[1] * h, o.z0 + (o.z1 - o.z0) / 2 + a[2] * h]]; };
      const wires = pls.filter((o) => o.mat === 'wire'), poles = pls.filter((o) => o.mat === 'pole');
      let maxGap = 0, minZ = Infinity, endErr = 0;
      for (let g = 0; g < wires.length; g += 8) {
        const seg = wires.slice(g, g + 8);
        for (let j = 0; j + 1 < seg.length; j++) { const e = ends(seg[j])[1], s = ends(seg[j + 1])[0]; maxGap = Math.max(maxGap, Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2])); }
        for (const sg of seg) for (const p of ends(sg)) minZ = Math.min(minZ, p[2]);
        const a0 = ends(seg[0])[0], a1 = ends(seg[7])[1];
        endErr = Math.max(endErr, Math.abs(a0[2] - 8.6), Math.abs(a1[2] - 8.6));
      }
      return { offIdentical: JSON.stringify(off) === JSON.stringify(offStr), restIdentical: JSON.stringify(rest) === JSON.stringify(off), nWires: wires.length, nPoles: poles.length, maxGap, minZ, endErr, polePos: poles.map((p) => [p.x, p.y, p.z1]) };
    });
    ok('1 option off (absent or "off") gives identical objects', r.offIdentical);
    ok('2 option on: non-powerline objects unchanged', r.restIdentical);
    ok('2b option on adds 5 poles and 80 wire segments', r.nPoles === 5 && r.nWires === 80, { poles: r.nPoles, wires: r.nWires });
    ok('3 segment ends meet within 1e-9 m', r.maxGap < 1e-9, r.maxGap);
    ok('3b span ends sit at attachment height 8.6 m', r.endErr < 1e-9, r.endErr);
    ok('4 lowest wire point above 5 m', r.minZ > 5, r.minZ);
    console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  } catch (e) { console.log('[FAIL] exception ' + e); fails++; }
  finally { await browser.close(); }
  process.exit(fails ? 1 : 0);
})();
