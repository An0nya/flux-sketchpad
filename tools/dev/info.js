const path = require('path'), RF = require(path.join(__dirname, '../../tests/load.js')).load();
const sc = require(path.join(__dirname, '../bench-scenes.js')).all(RF)[process.argv[2]]();
const p = sc.modeA.paint, R = sc.target.res;
console.log(JSON.stringify({ source: sc.source, target: sc.target, env: sc.envelope, budget: sc.modeA.budget }));
const nz = p.filter((x) => x > 0).sort((a, b) => a - b);
console.log('res', R, 'painted', nz.length, 'min', nz[0], 'med', nz[nz.length >> 1], 'max', nz[nz.length - 1]);
for (let j = R - 1; j >= 0; j -= 2) { let s = ''; for (let i = 0; i < R; i++) { const v = p[j * R + i]; s += v <= 0 ? ' ' : ' .:-=+*#%@'[Math.min(9, 1 + Math.floor(v / (nz[nz.length - 1]) * 9))]; } console.log(s); }
