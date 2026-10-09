#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const {RF,judge}=require('../sqm-hl/lib.js');
const dir=path.resolve(process.argv[2]),ref=JSON.parse(fs.readFileSync(path.join(dir,'result-8000000-1.json')));
const sc=RF.State.deserialize(fs.readFileSync(path.join(dir,'scene.json'),'utf8'));sc.sim.seed=71;
const {G,ev}=judge(sc,8e6,1e6);
const frozen={base:ref.aim.base,reaim:ref.reaim,note:ref.aim.note,cutV:ref.aim.cutV};
const fixed=RF.Spec.evaluate(G,sc.modeD,{frozen});
const compact=e=>({n:e.n,shift:e.shift,rows:e.rows});
fs.writeFileSync(path.join(dir,'aim-audit.json'),JSON.stringify({seed:71,free:compact(ev),atSeed1Aim:compact(fixed),reference:compact(ref)},null,2));
console.log(JSON.stringify({free:ev.n,atSeed1Aim:fixed.n,freeShift:ev.shift,fixedShift:fixed.shift}));
