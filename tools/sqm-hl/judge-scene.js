#!/usr/bin/env node
/* judge-scene.js scene.json [--rays 4e6] [--png out.png]  — judge a scene's CURRENT design, print rows, write the far-field PNG. */
const fs = require('fs'), path = require('path');
const { RF, loadScene, judge, report } = require('./lib.js');
const args = {}; for (let i = 3; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const sc = loadScene(process.argv[2]); const t0 = Date.now();
console.log('surfaces', RF.State.allSurfaces(sc).length);
const { G, ev } = judge(sc, +(args.rays || 4e6));
console.log('trace', ((Date.now() - t0) / 1000).toFixed(1) + 's'); console.log(report(ev, G));
if (args.png) { const { renderFF } = require('./ffpng.js'); const r = renderFF(RF, G, sc.modeD, { ev, label: path.basename(process.argv[2]) }); fs.writeFileSync(args.png, r.png); console.log('png', args.png, 'peak', Math.round(r.peak)); }
