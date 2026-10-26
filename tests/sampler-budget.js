// B10/B14 sampler budget (Node): node tests/sampler-budget.js. Runs docs/inventory/scripts/uniforms.mjs (assembles every program text exactly as drive-three.js does, the
// pass programs WITH the cycle blend) and checks: every program declares <= 13 samplers (16 is the hardware limit; 3 are kept free for brief B's height texture and one more feature);
// the table banks are the two array samplers (scatBanks, scatBanksB) and the old per-bank names are gone; marks is declared in the ground and ribbon mains only; the pass object program
// with table + lighting carries the blend set. Text count only: the real link count is measured on the GPU by TOUGE-AIR-RIBBON (4).
const { execFileSync } = require('child_process'), path = require('path');
const script = path.join(__dirname, '../docs/inventory/scripts/uniforms.mjs');
const rows = execFileSync('node', [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
const withNames = rows.filter((r) => r.names);
ok('SB: the script produced the program rows (46) and none errored', rows.length >= 46 && !rows.some((r) => r.err), rows.length + ' rows');
const over = rows.filter((r) => r.declared > 13);
ok('SB: every program declares <= 13 samplers', over.length === 0, over.length ? JSON.stringify(over.map((r) => [r.label, r.declared])) : 'max ' + Math.max(...rows.map((r) => r.declared)));
ok('SB: no program declares the old scatBank0..2 / scatBankB0..2 / haloPolarTex2 names', !withNames.some((r) => /scatBank[0-9B]|haloPolarTex2/.test(r.names)));
ok('SB: marks is declared only in ground and ribbon programs', withNames.filter((r) => /\bmarks\b/.test(r.names)).every((r) => /^(FLAT ground|TOUGE ribbon)/.test(r.label)) && withNames.some((r) => /^FLAT ground/.test(r.label) && /\bmarks\b/.test(r.names)));
const worst = rows.find((r) => r.label === 'TOUGE object lit+table');
ok('SB: the pass object program with table + lighting has the blend set (scatBanksB) and fits (13)', !!worst && /scatBanksB/.test(worst.names) && worst.declared <= 13, worst && worst.declared);
ok('SB: every table program has both array samplers', withNames.filter((r) => /\+table$/.test(r.label)).every((r) => /\bscatBanks\b/.test(r.names) && /scatBanksB/.test(r.names)));
console.log(fails ? fails + ' FAILED' : 'all sampler-budget checks passed'); process.exitCode = fails ? 1 : 0;
