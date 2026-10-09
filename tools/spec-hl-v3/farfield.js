#!/usr/bin/env node
'use strict';
// Add true direction-space plots without changing the stock 25 m judgment.
// Keep the original two streams first: the importance sampler learns from stream 0.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {RF}=require('../sqm-hl/lib.js');
const dir=path.resolve(process.argv[2]),seed=+(process.argv[3]||1),N=8e6;
const result=JSON.parse(fs.readFileSync(path.join(dir,`result-${N}-${seed}.json`)));
const file=path.join(dir,`plot-${N}-${seed}.json`),plot=JSON.parse(fs.readFileSync(file));
if(plot.ffDistance==='infinity')process.exit(0);
const sc=RF.State.deserialize(fs.readFileSync(path.join(dir,'scene.json'),'utf8'));sc.sim.seed=seed;
const P=RF.Engine.prepare(sc,RF.State.allSurfaces(sc));
const opts={...RF.Spec.wideOpts(sc,0),step:.125};
P.ffStreams=[RF.Spec.gridOpts(sc),RF.Spec.wideOpts(sc),opts];P.guideLearn=true;
let c=RF.Engine.newCtx(P,1e6,0);RF.Engine.traceRange(c,0,1e6);c.next=1e6;c.done=true;
while(c.N<N){const n=c.N,g=RF.Engine.buildGuide(c);c=RF.Engine.extend(c,Math.min(N,2*n),g);RF.Engine.traceRange(c,n,c.N);c.next=c.N;c.done=true;}
const G=RF.FarField.build(c,P.ffStreams[0]);
assert(Math.abs(G.lmWindow-result.lmWindow)<1e-7,'Extra display stream changed the measured beam');
for(const k of Object.keys(result.energy))if(typeof result.energy[k]==='number')assert(Math.abs(c.E[k]-result.energy[k])<1e-7,'Extra stream changed energy '+k);
const F=RF.FarField.build(c,opts),sh=result.shift||[0,0],mirror=sc.modeD.traffic==='LHT'?-1:1;
plot.cdScreen=plot.cd;
plot.cd=plot.v.map(v=>plot.h.map(h=>Math.max(0,RF.FarField.intensityAt(F,mirror*h+sh[0],v+sh[1],.2,.2).cd)));
plot.ffDistance='infinity';plot.ffKernelHalfDegrees=.2;
plot.roadBeamDistance=sc.modeD.distance;plot.roadNote='Existing app model: 25 m apparent intensity used as an angular beam; two identical lamps, sensor 25 cm high.';
fs.writeFileSync(file,JSON.stringify(plot));console.log('TRUE FAR FIELD',path.basename(dir),'unchanged measured lumens and energy');
