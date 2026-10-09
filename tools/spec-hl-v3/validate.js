#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {RF,ROOT}=require('../sqm-hl/lib.js');const {scene}=require('./scenes.js');
for(const f of ['spec-hl-v2','spec-hl-v3'])vm.runInThisContext(fs.readFileSync(path.join(ROOT,'solvers',f+'.js'),'utf8'));
const tools={budget:{ms:Infinity,rays:Infinity},progress(){},preview(){}};
(async()=>{
 const sc=scene('ledUp','ece-r112-b',16),input=RF.Solvers.inputOf(sc);
 const a=await RF.Solvers.get('spec-hl-v2').solve(input,{...RF.Solvers.defaults(RF.Solvers.get('spec-hl-v2')),quality:'fast'},tools);
 const b=await RF.Solvers.get('spec-hl-v3').solve(input,{...RF.Solvers.defaults(RF.Solvers.get('spec-hl-v3')),quality:'fast',roadWeight:0},tools);
 assert.deepStrictEqual(b.surfaces,a.surfaces,'roadWeight=0 must reproduce v2 geometry exactly');
 console.log('PASS: zero road weight reproduces all '+a.surfaces.length+' v2 surfaces exactly');
 const H=RF.__specHL3,S=H.resolve({...H.BASE,...RF.Solvers.defaults(RF.Solvers.get('spec-hl-v3'))});
 const P=H.readProblem(input,S);P.B=H.beamAxis(P);const sh=H.buildShell(P,S,[]);P.shell=sh.shell;
 const B=H.buildBands(P,S),T=H.roadTarget(P,S,B,sh.units,[]);
 const flux=T.tg.reduce((s,x,i)=>s+x*P.G.omega[i],0),available=sh.units.filter(u=>!u.dead).reduce((s,u)=>s+u.flux,0)*P.refl;
 assert(T.absolute && flux>0 && flux<=available*.80001);
 assert(Math.abs(T.ws.reduce((s,x)=>s+x,0)-S.roadWeight)<1e-6);
 assert(P.G.h0<=-25 && P.G.h0+P.G.nh*P.G.gs>=25);
 console.log('PASS: absolute road target respects flux budget, weight and wide shoulder coverage');
 const changed=await RF.Solvers.get('spec-hl-v3').solve(input,{...RF.Solvers.defaults(RF.Solvers.get('spec-hl-v3')),quality:'fast',effort:'single'},tools);
 assert.notDeepStrictEqual(changed.surfaces,a.surfaces,'road objective must affect actual geometry');
 for(const out of [a,b,changed]){const v=RF.Solvers.verify(sc,out);assert(out.surfaces.length>0&&!v.errors.length&&!v.violations.envelope.length&&!v.violations.keepOut.length&&!v.violations.budget);}
 console.log('PASS: positive road weight changes the design; all three 16-facet designs verify');
 // Exercise the real selector and its trace request. No silent no-spec fallback is allowed.
 const req=[],realTools={...tools,trace(s,o){assert.strictEqual(o.spec,true);assert.strictEqual(o.road,true);req.push(o);return {spec:{n:{pass:19,fail:0,unsure:0},expFails:0,lmWindow:500},road:{farRight:70,farLeft:50,right:70,left:50}};}};
 const guarded=await RF.Solvers.get('spec-hl-v3').solve(input,{...RF.Solvers.defaults(RF.Solvers.get('spec-hl-v3')),quality:'fast',effort:'quick'},realTools);
 assert.strictEqual(req.length,2);assert(guarded.notes.some(n=>n.startsWith('v3 selected v2 fallback')));
 console.log('PASS: selector asks for spec + road judgment and preserves fallback on an exact tie');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
