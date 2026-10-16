// Node integration: the opt-in frame submits GPU work; turning it off still traces the CPU reference.
function run(RF, ok) {
  const fs=require('fs'),path=require('path'),crypto=require('crypto');
  const pins={'three.core.min.js':'61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de','three.module.min.js':'e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6'};
  for(const [file,hash]of Object.entries(pins))ok('P1 unmodified pinned vendor '+file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../vendor/three',file))).digest('hex')===hash);
  const D=RF.DriveAnim,V=D._.V,saved={...V},original=RF.Drive.render;
  const p=require('./drive-polish.js').recipe(RF,'city',{wet:true,wetSheen:true},128);
  let traces=0,uploads=0,renders=0,submitted;
  try {
    RF.Drive.render=o=>{traces++;return original(o);};
    const ui={dvAnim:{dist:25,t:12,playing:false},driveBar:{querySelector:()=>null}};
    Object.assign(V,{ui,p,src:p.src,act:new Map(),band:[0,p.h],rgba:new Float32Array(4*p.w*p.h),times:[],profiles:[],ring:[],cpu:{obj:0,up:0,gl:0,n:0},cameraMs:0,renderScale:1,pinSS:1,frames:0,lost:false,glFailed:false,flash:D.flashState(),tileLab:null,flashLab:null,perfLab:null,info:{o:{fov:60,ev:1,glare:'off',speed:50,wet:true,wetSheen:true},A:null},g:{layers:[]},gl:{gl:{isContextLost:()=>false},setObjects:()=>uploads++,draw:f=>{if(f.groundGPU)f.groundGPU('ground target','object target');}},three:{render:(...args)=>{renders++;submitted=args;}}});
    D._.frame();
    ok('P1 GPU frame bypasses CPU trace and pixel upload',traces===0&&uploads===0&&renders===1);
    ok('P1 GPU receives the aimed LUT, exact pose and existing object list',submitted[0].lut===p.lut&&submitted[2]===25&&submitted[1].objects.length>0&&submitted[3]==='ground target'&&submitted[4]==='object target'&&submitted[5]===1);
    const recipe=JSON.stringify(p.look);V.three=null;D._.frame();
    ok('P1 GPU off reaches CPU trace and original upload',traces>0&&uploads===1&&D.stats().renderer==='cpu'&&JSON.stringify(p.look)===recipe);
  } finally {
    RF.Drive.render=original;for(const key of Object.keys(V))if(!(key in saved))delete V[key];Object.assign(V,saved);
  }
}
module.exports={run};
if(require.main===module){let fails=0;run(require('./load.js').load(),(n,c)=>{console.log((c?'[PASS] ':'[FAIL] ')+n);if(!c)fails++;});console.log(fails?fails+' FAILED':'all P1 Node checks passed');process.exitCode=fails?1:0;}
