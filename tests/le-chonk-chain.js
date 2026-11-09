// endlessTile chaining + memo. The switchback and no-loop rules read the ADJUSTED k-1 / k-2 tiles (they used to read
// raw neighbours, so 'switchbacks' still produced thousands of three-same-sign curve runs). The result must not depend on
// the order tiles are asked for, and repeated calls must be served from the memo.
const { execFileSync } = require('child_process');
const { load } = require('./load.js');
// le-chonk 11-09 (B11): tight-S clause dropped in B11-1, so the 'no tight S' expectation below is inverted — S-bends now survive.
const RF = load(), A = RF.DriveAnim;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };
const N = 3000, SEEDS = [0, 7, 13, 42, 99], RESET = 256;
const sameSign3 = (c, i) => c[i] && c[i - 1] && c[i - 2] && Math.sign(c[i]) === Math.sign(c[i - 1]) && Math.sign(c[i - 1]) === Math.sign(c[i - 2]);
for (const preset of ['switchbacks', 'off', 'highway-loop']) {
  let runs = 0, tightS = 0, nonReset = 0;
  for (const seed of SEEDS) {
    const c = Array.from({ length: N }, (_, k) => A.endlessTile(seed, k, preset).curvature);
    for (let i = 2; i < N; i++) if (i % RESET && (i - 1) % RESET) { nonReset++; if (sameSign3(c, i)) runs++; if (preset !== 'switchbacks' && c[i] && c[i - 1] && Math.sign(c[i]) === -Math.sign(c[i - 1]) && Math.abs(c[i - 1]) >= 1 / 250) tightS++; }
  }
  ok(preset + ': no three same-sign curves in a row on the adjusted tiles (' + nonReset + ' tiles off the chain resets)', runs === 0, { runs });
  if (preset !== 'switchbacks') ok(preset + ': tight S-curves survive (B11-1 dropped the flattening clause)', tightS > 0, { tightS });
}
{   // switchbacks: consecutive curves alternate
  let bad = 0; for (const seed of SEEDS) { const c = Array.from({ length: N }, (_, k) => A.endlessTile(seed, k, 'switchbacks').curvature); for (let i = 1; i < N; i++) if (i % RESET && c[i] && c[i - 1] && Math.sign(c[i]) === Math.sign(c[i - 1])) bad++; }
  ok('switchbacks: a curve answers the previous (adjusted) curve with the opposite sign', bad === 0, { bad });
}
{   // order independence: a fresh process asking tiles in descending order agrees with the ascending sweep
  const script = "const A=require('./tests/load.js').load().DriveAnim;const o=[];for(let k=1200;k>=-2;k--)o.push(A.endlessTile(7,k,'switchbacks').kind+A.endlessTile(13,k,'off').kind);console.log(JSON.stringify(o.reverse()))";
  const desc = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: require('path').join(__dirname, '..') }).toString());
  const asc = []; for (let k = -2; k <= 1200; k++) asc.push(A.endlessTile(7, k, 'switchbacks').kind + A.endlessTile(13, k, 'off').kind);
  ok('order independent: descending cold queries match the ascending sweep', JSON.stringify(desc) === JSON.stringify(asc));
}
{   // memo: the same tile object comes back, and a warm window is cheap
  ok('memo: repeated call returns the cached tile', A.endlessTile(7, 500) === A.endlessTile(7, 500));
  const cust = { mix: { open: 0.5, forest: 0.5 } }; ok('memo: custom presets keyed by content', A.endlessTile(7, 20, 'custom', cust).biome === A.endlessTile(7, 20, 'custom', { mix: { open: 0.5, forest: 0.5 } }).biome);
  for (let k = 0; k < 20; k++) A.endlessTile(7, 4000 + k);
  const t0 = process.hrtime.bigint(); let n = 0; for (let r = 0; r < 5000; r++) for (let k = 0; k < 20; k++) { A.endlessTile(7, 4000 + k); n++; }
  const us = Number(process.hrtime.bigint() - t0) / 1e3 / n;
  ok('memo: a warm 20-tile window costs < 1 us per call (was ~4 us uncached)', us < 1, { us });
}
console.log(`\n${pass + fail} checks, ${fail} failed`); process.exit(fail ? 1 : 0);
