// MG2: Node pixels + seeded playtest cases. Default optics snapshot: State.defaultScene(),
// Solvers.runAsync(scene,'auto'), then mode='D', 2026-10-15;93 facets. No solve on test runs.
const fs = require('fs'), path = require('path');
const flipRows = (px, w, h) => { const a = new Uint8Array(px.length); for (let y=0;y<h;y++) a.set(px.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4); return a; };
function run(RF, ok) {
  const M=RF.DriveGame,D=RF.Drive,A=RF.DriveAnim,J=JSON.stringify,lib=require('../tools/drive-lib.js');
  const w=12,h=8,mask=new Uint8Array(w*h),rgba=new Uint8Array(w*h*4),background=new Uint8Array(rgba.length);
  for(let y=2;y<4;y++)for(let x=3;x<6;x++){mask[y*w+x]=1;for(let c=0;c<3;c++)rgba[4*((h-1-y)*w+x)+c]=80;}
  const f={w,h,mw:w,mh:h,mask,rgba,background};
  ok('MG2 six visible body pixels qualify; missing counterfactual fails closed',!!M.firstLit(f)&&M.firstLit({...f,background:null})===null,J(M.firstLit(f)));
  const gradient=new Uint8Array(rgba.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)gradient[4*((h-1-y)*w+x)+c]=Math.round(20+120*Math.exp(-((x-4)**2+(y-2.5)**2)/8));
  const glareFrame={...f,rgba:gradient,background:gradient};
  ok('MG2 identical glare gradient: original detector fires, counterfactual detector rejects (seed-7 failure mechanism)',!!M.firstLit({...glareFrame,legacy:true})&&M.firstLit(glareFrame)===null);
  const eyes=new Uint8Array(mask);eyes.fill(0);eyes[2*w+3]=eyes[2*w+4]=1;
  ok('MG2 two eyeshine pixels and CSS-upscaled dots do not qualify',M.firstLit({...f,mask:eyes})===null&&M.firstLit({...f,cssW:w/2,cssH:h/2})===null);
  ok('MG2 UI occlusion subtracts visible area',M.firstLit({...f,exclude:[[3,2,4,4]]})===null);
  const mirrored=new Uint8Array(rgba.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<4;c++)mirrored[4*(y*w+w-1-x)+c]=rgba[4*(y*w+x)+c];
  ok('MG2 mirrored counterfactual maps body mask correctly',!!M.firstLit({...f,rgba:mirrored,flip:true}));
  const bright=new Uint8Array(rgba.length).fill(160),lowContrast=new Uint8Array(rgba.length).fill(164);
  ok('MG2 absolute luminance alone fails the Weber contrast rule',M.firstLit({...f,rgba:lowContrast,background:bright})===null);
  const load=(file)=>RF.State.deserialize(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const sc=load('tests/fixtures/MG2-default-lamp.json'),high=load('examples/sealed-beam-7in-high.json');
  const lamps=[['default',lib.lookupOf(RF,sc,lib.traceScene(RF,sc,300000),.5,.15)],['7in-high',lib.lookupOf(RF,high,lib.traceScene(RF,high,300000),.5,.15)]];
  lamps.push(['long-throw',{...lamps[0][1],lut:D.lutFrom((H,V)=>200000*Math.exp(-.5*((H/6)**2+(V/1.5)**2)))}]);
  function picture(L,range,side,extra={}) {
    const W=640,H=360,K=D.kit({Lw:L.lane,A:extra.arc||null,rand:()=>.5});K.deer(range,extra.off||0,{face:side});for(const ob of K.O)ob.gameHazard=1;
    const ids=new Uint8Array(W*H),body=new Uint8Array(W*H),p={w:W,h:H,hfov:60,eye:A.EYE,lamps:L.lamps,lut:L.lut,conv:L.conv,lane:L.lane,ss:2,arc:extra.arc||null,mats:extra.mats,scene:{objects:K.O,markings:[],verge:['grass',1,'grass']}};
    const sampleTiles=new Uint8Array(Math.ceil(W/16)*Math.ceil(H/16)),res=D.render({...p,sampleTiles,hazardMask:ids,hazardBodyMask:body}),bg=D.render({...p,sampleTiles,scene:{...p.scene,objects:[]}}),tone={mode:'fixed',ev:1,glare:extra.glare||0};
    return {rgba:flipRows(D.tonemap(res,tone).px,W,H),background:flipRows(D.tonemap(bg,tone).px,W,H),mask:body,ids,w:W,h:H,mw:W,mh:H};
  }
  const ranges=[];
  for(const seed of [7,19,11,1]) {
    const g=M.create({seed,speed:75});g.t=g.next;g.x=g.t*75/3.6;const hz=M.spawn(g,3.5),row={seed};
    for(const [name,L] of lamps){row[name]=null;for(let range=400;range>=10;range-=10){const f=picture(L,range,hz.side);const seen=M.firstLit(f);if(seen){row[name]=range;row[name+'Pixel']=seen;break;}}}
    ranges.push(row);
  }
  ok('MG2 tester seeds7/19/11/1: high beam sees farther than default; long throw farther again (same lane target,10m steps)',ranges.every(r=>r.default!==null&&r['7in-high']>=r.default+20&&r['long-throw']>=r['7in-high']+10),J(ranges));
  // Natural first-encounter paths protect the lesson against late crossing, not just detector math.
  // Five-metre camera steps, actual seeded route bends/spawn/motion; no scenery/traffic/ambient in this isolation.
  const encounters=[];
  for(const seed of [7,19,11,1]){
    const row={seed};
    for(const [name,L] of lamps){const g=M.create({seed,speed:75});g.t=g.next;g.x=g.t*75/3.6;const h=M.spawn(g,L.lane,L);row[name]=null;
      while(h&&h.s0-g.x>10){const ps=M.pose(g,h,g.t),f=picture(L,h.s0-g.x,h.side,{off:ps.off,arc:A.tileRoute(seed,g.x)});if(M.firstLit(f)){row[name]=h.s0-g.x;break;}g.x+=5;g.t+=5/(75/3.6);}
    }encounters.push(row);
  }
  ok('MG2 seeded moving encounters: long-throw sees farther on every seed, 7in-high on average (a single encounter on a bend can favour the wider default)',encounters.every(r=>r.default!==null&&r['long-throw']>=r.default+10)&&encounters.reduce((a,r)=>a+r['7in-high']-r.default,0)/encounters.length>=20,J(encounters));
  const dark=picture(lamps[2][1],100,-1,{glare:'dry',mats:{fur:{rho:[0,0,0],retro:null,gloss:null,emit:null,id:D.MAT_KEYS.indexOf('fur')}}});
  ok('MG2 real renderer: bright eyes with black body cannot start detection',dark.ids.some(Boolean)&&M.firstLit(dark)===null);
  // The original seed7 spawn/traffic/route, evaluated from actual paired renderer output.
  const L=lamps[0][1],g=M.create({seed:7,speed:75,rules:'legacy'});g.t=g.next;g.x=g.t*75/3.6;const hz=M.spawn(g,L.lane,L);g.rules='visible';
  const p={...L,w:640,h:360,hfov:60,eye:A.EYE,ss:2,look:{wet:false,ambient:0,RL:.2},src:A.source('road',L.lane,L.us,{people:false,animals:false,signs:true,posts:true,veg:true,rpm:true},{wild:true,seed:7,tiles:true,oncoming:true,speed:75,streetLamps:'sodium'})};
  const world=A.tileWorld(p,g.x,g.t),without={...world,objects:world.objects.slice()},body=new Uint8Array(p.w*p.h);A._.gameObjects(g,world,L.lane);
  p.sampleTiles=new Uint8Array(Math.ceil(p.w/16)*Math.ceil(p.h/16));
  const render=(world,mask)=>{const out=new Float32Array(4*p.w*p.h);A.tileFrame({...p,hazardBodyMask:mask},g.x,g.t,out,2,null,null,world);const rgb=new Float32Array(3*p.w*p.h);for(let q=0;q<p.w*p.h;q++)for(let c=0;c<3;c++)rgb[3*q+c]=out[4*q+c];return {w:p.w,h:p.h,rgb,hfov:60};};
  const tone={mode:'fixed',ev:1,glare:'dry',sources:D.glareSources(world.objects,A.EYE)},a=flipRows(D.tonemap(render(world,body),tone).px,p.w,p.h),b=flipRows(D.tonemap(render(without),tone).px,p.w,p.h);
  let changed=0;for(let q=0;q<a.length;q+=4)if(a[q]!==b[q]||a[q+1]!==b[q+1]||a[q+2]!==b[q+2])changed++;
  ok('MG2 seed7 original spawn with real oncoming glare is unseen by body detector',M.firstLit({rgba:a,background:b,mask:body,w:p.w,h:p.h,mw:p.w,mh:p.h})===null,J({range:hz.s0-g.x,off:hz.off0,changedPixels:changed}));
  const placements=[];
  for(const [name,L] of lamps)for(const seed of [7,19,11,1,20,21,3,132,242]){const g=M.create({seed,speed:75});g.t=g.next;g.x=g.t*75/3.6;const h=M.spawn(g,L.lane,L);placements.push({name,seed,h,arrival:h&&M.pose(g,h,h.born+(h.s0-g.x)/(75/3.6)).off});}
  ok('MG2 all tested lamps/seeds: spawn setback<=8m, finite<1lx; both shoulders reach player lane at cruise arrival',placements.every(({h,arrival})=>h&&Number.isFinite(h.outsideLux)&&h.outsideLux<1&&Math.min(Math.abs(h.off0+L.lane/2),Math.abs(h.off0-1.5*L.lane))<=8&&Math.abs(arrival)<1),J(placements.slice(0,5).map(({name,seed,h,arrival})=>({name,seed,range:h.s0-h.born*75/3.6,off:h.off0,lux:h.outsideLux,arrival}))));
  let persons=0,crosswalks=0,jaywalkers=0,total=0;
  for(let seed=0;seed<1000;seed++){const g=M.create({seed,speed:75});for(let i=0;i<5;i++){g.t=g.next;g.x=g.t*75/3.6;const h=M.spawn(g,3.5);total++;if(h.kind==='person'){persons++;if(h.crosswalk)crosswalks++;else if(h.jaywalking)jaywalkers++;}}}
  ok('MG2 persons approx10% across5000 seeded hazards; crosswalks and mid-block jaywalkers both occur',persons/total>.085&&persons/total<.115&&crosswalks>0&&jaywalkers>0&&crosswalks+jaywalkers===persons,J({persons,total,rate:persons/total,crosswalks,jaywalkers}));
  const table=[[7,75,false,1],[7,130,true,1],[19,130,true,1],[7,130,false,.7],[19,75,true,1],[3,75,true,1.3],[5,50,false,.8],[7,75,false,null],[132,75,false,1],[132,75,false,null],[242,75,false,null]];
  // Replays preserve the tester's old 'visible at spawn' input assumption; the paired-render tests above test new first-seen.
  const replays=table.map(([seed,speed,wet,R])=>{const g=M.create({seed,speed,wet,verdict:'pass'});g.limit=1;g.t=g.next;g.x=g.t*speed/3.6;const h=M.spawn(g,3.5),born=h.born;g.next=1e6;for(let n=0;n<12000&&!g.done;n++){if(R!==null&&g.t>=born+R)M.press(g,true,1000*(g.t-born));M.step(g,M.STEP,3.5);}return {seed,speed,wet,R,result:g.results[0],done:g.done};});
  ok('MG2 tester playtest inputs (press R after spawn): fixed-step outcomes; no-brake paths reach road and hit',replays.every(r=>r.done&&r.result&&(r.R!==null||r.result.hit))&&replays.filter(r=>r.R!==null).some(r=>!r.result.hit),J(replays.map(({seed,speed,wet,R,result})=>({seed,speed,wet,R,hit:result.hit,impact:result.speed}))));
  let reachable=true;for(let seed=0;seed<500;seed++)for(const speed of [50,75,130]){const g=M.create({seed,speed}),h=M.spawn(g,3.5),at=M.pose(g,h,h.born+(h.s0-g.x)/(speed/3.6));if(Math.abs(at.off)>.2)reachable=false;}
  ok('MG2 1500 seeded50/75/130kmh encounters: walkers and deer reach player lane at cruise arrival',reachable);
  const resolved=M.create({seed:1,speed:75});resolved.hazards=[{id:1,born:0,kind:'deer',s0:30,off0:0,ds:0,doff:0,spd:0,len:0,side:-1,resolved:true}];const kept={A:null,objects:[]};A._.gameObjects(resolved,kept,3.5);resolved.rules='legacy';const old={A:null,objects:[]};A._.gameObjects(resolved,old,3.5);
  ok('MG2 stop-short resolved hazard stays drawn; Original rules remain reachable',kept.objects.length>0&&old.objects.length===0);
}
module.exports={run,flipRows};
if(require.main===module){let fail=0;run(require('./load.js').load(),(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+(detail?' — '+detail:''));if(!cond)fail++;});console.log(fail?fail+' FAILED':'all MG2 minigame checks passed');process.exitCode=fail?1:0;}
