#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const a = {}; for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];
const scenes = (a.scenes || 'filament7,filamentBox,ledUp,led519a,ledRear7,osramSmall').split(',');
const solvers = (a.solvers || 'spec-hl-v2,sqm-hl,sqm-hl-dish,opus-mosaic-auto,dish-fit-auto').split(',');
const presets = (a.presets || 'ece-r112-b,fmvss-lb2v').split(',');
const rays = +(a.rays || 2e6), seed = +(a.seed || 1), jobs=[];
for(const scene of scenes) for(const preset of presets) for(const solver of solvers){
  const dir=path.join(ROOT,'bench-out/spec-hl-v3',a.tag || '',scene+'-'+preset+'-'+solver);
  const result = path.join(dir,'result-'+rays+'-'+seed+'.json');
  if(fs.existsSync(result) && JSON.parse(fs.readFileSync(result)).harnessVersion===2)continue;
  const args=[path.join(__dirname,'run.js'),'--scene',scene,'--preset',preset,'--solver',solver,'--rays',String(rays),'--seed',String(seed),'--out',dir];
  if(a.settings)args.push('--settings',a.settings);
  if(a.budget)args.push('--budget',a.budget);
  if(a.retrace==='yes'){if(!fs.existsSync(path.join(dir,'scene.json')))throw Error('Missing solved scene '+dir);args.push('--retrace',path.join(dir,'scene.json'));}
  else if (fs.existsSync(path.join(dir,'scene.json'))) args.push('--retrace',path.join(dir,'scene.json'));
  jobs.push({dir,args,scene,preset,solver});
}
let next=0,fail=0;
async function worker(){while(next<jobs.length){const j=jobs[next++];fs.mkdirSync(j.dir,{recursive:true});const log=fs.openSync(path.join(j.dir,'run-'+rays+'-'+seed+'.log'),'w');console.log('START',j.scene,j.preset,j.solver);await new Promise(resolve=>{
  const c=spawn(process.execPath,j.args,{cwd:ROOT,stdio:['ignore',log,log]});const timer=setTimeout(()=>c.kill('SIGTERM'),12*60*1000);
  c.on('exit',(code,signal)=>{clearTimeout(timer);fs.closeSync(log);if(code!==0)fail++;console.log('END',j.scene,j.preset,j.solver,code,signal||'');resolve();});
});}}
Promise.all(Array.from({length:+(a.jobs||2)},worker)).then(()=>{console.log('DONE',jobs.length,'failures',fail);process.exitCode=fail?1:0;});
