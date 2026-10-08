#!/usr/bin/env node
// vbands.js <scene.json> [rays] — where a design's light lands: lumens per vertical band (and inside / outside the spec window), from a ±80° far-field grid.
// Engine trace (the judge's own machinery), not the solver's model.  Usage: node tools/projector-liou/vbands.js out/x.scene.json 2e6
'use strict';
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', '..', 'tests', 'load.js')); const RF = load();
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')), N = +(process.argv[3] || 2e6);
sc.sim.bounces = Math.max(sc.sim.bounces | 0, 5);
const go = RF.Spec.gridOpts(sc), win = go.win, opts = Object.assign({}, go, { win: [-80, 80, -80, 80], step: 0.5, key: 'vb' });
const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [opts];
const c = RF.Engine.runSync(P, N, 0), G = RF.FarField.build(c, opts);
const bands = [[15, 80], [5, 15], [0, 5], [-2, 0], [-5, -2], [-10, -5], [-15, -10], [-20, -15], [-30, -20], [-80, -30]];
const lmOf = (pred) => { let s = 0; for (let j = 0; j < G.nv; j++) { const v = G.v0 + (j + 0.5) * G.step; for (let i = 0; i < G.nh; i++) { const h = G.h0 + (i + 0.5) * G.step; if (pred(h, v)) s += G.E[j * G.nh + i]; } } return s; };
const inWin = (h, v) => h >= win[0] && h <= win[1] && v >= win[2] && v <= win[3];
console.log(`spec window H ${win[0]}…${win[1]}  V ${win[2]}…${win[3]}; source ${sc.source.power} lm; total in ±80° grid ${lmOf(() => true).toFixed(0)} lm, in window ${lmOf(inWin).toFixed(0)} lm`);
for (const [lo, hi] of bands) console.log(`V ${String(lo).padStart(4)}…${String(hi).padStart(3)}°: ${lmOf((h, v) => v >= lo && v < hi).toFixed(0).padStart(5)} lm (in window ${lmOf((h, v) => v >= lo && v < hi && inWin(h, v)).toFixed(0)}, |H| > window ${lmOf((h, v) => v >= lo && v < hi && (h < win[0] || h > win[1])).toFixed(0)})`);
