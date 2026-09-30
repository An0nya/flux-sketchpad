// summarise a .cpuprofile by self time: node tools/dev/profsum.js file.cpuprofile [top]
const fs = require('fs'), p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), top = +(process.argv[3] || 15);
const self = new Map(); const byId = new Map(p.nodes.map((n) => [n.id, n]));
const dt = p.timeDeltas; p.samples.forEach((id, i) => { const n = byId.get(id), k = n.callFrame.functionName + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
const tot = [...self.values()].reduce((a, b) => a + b, 0);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).forEach(([k, v]) => console.log((v / 1e6).toFixed(2).padStart(8) + ' s  ' + (100 * v / tot).toFixed(1).padStart(5) + '%  ' + k));
