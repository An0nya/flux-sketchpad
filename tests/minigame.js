// Pure game rules + actual renderer samples. node tests/minigame.js
function run(RF, ok) {
  const M = RF.DriveGame, A = RF.DriveAnim, D = RF.Drive, J = JSON.stringify;
  const d = M.stoppingDistance(75, 1, false), w = M.stoppingDistance(130, 1, true);
  ok('MG corrected stopping table: 75 dry ≈48.5 m; 130 wet ≈202 m', Math.abs(d - 48.5) < .05 && Math.abs(w - 202) < .3, J({ dry75: d, wet130: w }));
  let worst = 0;
  for (const wet of [false, true]) for (const kmh of [30, 60, 75, 130]) {
    let v = kmh / 3.6, x = v, n = 0;
    while (v > 0 && n++ < 5000) { const m = M.motion(v, 1 / 120, true, wet); x += m.dx; v = m.v; }
    worst = Math.max(worst, Math.abs(x - M.stoppingDistance(kmh, 1, wet)));
  }
  ok('MG integrated held braking equals analytic stopping distance, including fractional last tick', worst < 1e-8, 'worst metres '+worst);
  const coast = M.motion(12, .8, false, false), brake = M.motion(12, .8, true, false), release = M.motion(brake.v, .8, false, false);
  ok('MG release coasts at reduced speed; dry brakes harder than wet', coast.v === 12 && Math.abs(coast.dx - 9.6) < 1e-12 && release.v === brake.v && brake.v < M.motion(12, .8, true, true).v);
  const a = M.car(0), b = { x: 1, y: .5, hx: .3, hy: .5 };
  ok('MG boxes: disjoint, clipped, full overlap; swept collision cannot tunnel', M.overlap(a,b) === 0 && M.overlap(a,{...b,x:-1}) > 0 && M.overlap(a,{...b,x:-1,y:0}) === 1 && M.sweep(a,b,M.car(10),b) !== null && M.sweep(a,{...b,y:4},M.car(10),{...b,y:4}) === null);
  const low = M.score({hit:true,speed:5,fraction:1,person:true,noHiViz:true,jaywalking:true,verdict:'pass'}), high = M.score({hit:true,speed:60,fraction:.5,person:true,crosswalk:true,verdict:'fail',highMisuse:true,flashes:2}), nohit=M.score({verdict:'unsure',flashes:3});
  ok('MG score: 35% combined mitigation, person always lost, cap100, crosswalk jail-risk, ticket rates', low.liability===3.25 && low.lost && low.conscience===100 && low.tier==='repair (~$2k)' && high.recklessness===100 && high.energy>100000 && high.tier==='jail-risk game over' && high.tickets===1000 && nohit.tickets===450 && nohit.damage==='none', J({low,high,nohit}));
  ok('MG damage energy scales by overlap and speed squared; unknown verdict never earns compliant tier', M.score({hit:true,speed:20,fraction:.5}).energy === M.score({hit:true,speed:10,fraction:1}).energy*2 && M.score({hit:true,speed:5,fraction:1,verdict:'unsure'}).tier !== low.tier);
  const size=9, mask=new Uint8Array(size*size), rgba=new Uint8Array(size*size*4), q=2*size+3; mask[q]=1;
  const f={legacy:true,rgba,mask,w:size,h:size,mw:size,mh:size};
  ok('MG first-lit: black actor stays unseen', M.firstLit(f)===null);
  const shown=(size-1-2)*size+3; rgba.fill(0);rgba[4*shown]=rgba[4*shown+1]=rgba[4*shown+2]=80;
  ok('MG first-lit: UI-covered pixels cannot start the timer', M.firstLit({...f,exclude:[[2,1,5,4]]})===null);
  const lit=M.firstLit(f);ok('MG first-lit: first bright masked pixel in the displayed GL frame starts detection',lit && lit.x===3 && lit.y===2,J(lit));
  mask[q]=3;ok('MG first-lit: subpixel contributions from two hazards keep both IDs',!!M.firstLit({...f,id:2}));mask[q]=1;
  ok('MG first-lit: unrelated light, different actor, mirroring are respected',M.firstLit({...f,id:2})===null && M.firstLit({...f,flip:true})===null);
  rgba.fill(0); const mirrored=shown+2;rgba[4*mirrored]=rgba[4*mirrored+1]=rgba[4*mirrored+2]=80;
  ok('MG first-lit: mirrored frame maps actor back to its trace mask',!!M.firstLit({...f,flip:true}));
  rgba.fill(160);ok('MG first-lit: a uniform bright veil has no local contrast',M.firstLit(f)===null);
  rgba.fill(0);rgba[4*shown]=rgba[4*shown+1]=rgba[4*shown+2]=5;ok('MG first-lit: sub-threshold actor does not start timer',M.firstLit(f)===null);
  // Same nearest-hit geometry and final RGB with/without the optional actor-ID mask, then an occluder.
  const K=D.kit({Lw:3.5,A:null,rand:()=>.5});K.person(20,0,'light');for(const ob of K.O)ob.gameHazard=1;
  const p={w:80,h:45,hfov:60,eye:A.EYE,lamps:[[0,.7,.7],[0,-.7,.7]],lut:D.lutFrom(()=>30000),lane:3.5,ss:2,scene:{objects:K.O,markings:[],verge:['grass',1,'grass']}};
  const plain=D.render(p), ids=new Uint8Array(80*45), tagged=D.render({...p,hazardMask:ids});
  ok('MG renderer mask marks actual actor samples without changing RGB', ids.some(v=>v===1) && plain.rgb.every((v,i)=>v===tagged.rgb[i]));
  const wall={k:'box',x:10,y:0,hx:.2,hy:5,z0:0,z1:5,mat:'wall'};ids.fill(0);D.render({...p,hazardMask:ids,scene:{...p.scene,objects:[wall,...K.O]}});
  ok('MG fully occluded actor has no mask pixels',!ids.some(Boolean));
  const g=M.create({seed:7,speed:75,wet:false,verdict:'pass'}), h=M.spawn(g,3.5);h.lit=1000;
  M.press(g,true,1350);M.press(g,true,1450);M.press(g,false,1500);M.press(g,true,1600);
  ok('MG reaction is measured once, from displayed-frame timestamp to first press',g.reactions.length===1 && Math.abs(h.reaction-.35)<1e-12);
  const make=()=>M.create({seed:71,speed:130,wet:true,verdict:'pass'}), one=make(), two=make();
  for(let i=0;i<12000;i++)M.step(one,1/120,3.5);
  for(let i=0;i<1000;i++)M.step(two,.1,3.5);
  const snap=g=>({x:g.x,v:g.v,t:g.t,h:g.hazards,r:g.results});
  ok('MG seeded schedule, actors and outcomes independent of frame step grouping',J(snap(one))===J(snap(two)),J({spawned:one.spawned,results:one.results.length,x:one.x}));
  const heldStop=M.create({seed:4,speed:75});heldStop.v=0;heldStop.resume=0;heldStop.brake=true;M.step(heldStop,.1,3.5);const stayed=heldStop.v===0;heldStop.brake=false;M.step(heldStop,.1,3.5);
  ok('MG intermission waits for release before returning to chosen cruise',stayed&&heldStop.v===75/3.6);
  const route=M.create({seed:19,speed:75,rules:'legacy'}), sample=[];for(let i=0;i<5;i++){route.t=route.next;route.x=route.t*75/3.6;sample.push(M.spawn(route,3.5,{lamps:p.lamps,lut:p.lut,conv:'A'}));}
  ok('MG spawns 80–180m ahead outside useful beam; persons only at crosswalks; gaps10–20s',sample.every((h,i)=>h.s0-h.born*75/3.6>=80 && h.s0-h.born*75/3.6<=180 && Number.isFinite(h.outsideLux)&&h.outsideLux<1 && (h.kind!=='person'||h.crosswalk) && (!i||h.born-sample[i-1].born>=10&&h.born-sample[i-1].born<=20)),J(sample.map(h=>({kind:h.kind,range:h.s0-h.born*75/3.6,off:h.off0,lux:h.outsideLux,born:h.born}))));
  const hit=M.create({seed:1,speed:75,verdict:'pass'});hit.next=1000;hit.hazards=[{id:1,born:0,kind:'deer',s0:2,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,lit:null,reaction:null}];
  M.step(hit,.1,3.5);ok('MG hit records our speed at overlap, rather than slider or stopping-speed estimate',hit.results.length===1&&Math.abs(hit.results[0].speed-75)<1e-10,J(hit.results));
  const stop=M.create({seed:1,speed:75,verdict:'pass'});stop.next=1000;stop.hazards=[{id:1,born:0,kind:'deer',s0:80,off0:0,ds:0,doff:0,spd:0,len:0,delay:0,lit:null,reaction:null}];stop.brake=true;
  for(let i=0;i<500;i++)M.step(stop,1/120,3.5);
  ok('MG stopping before a hazard passes and schedules explicit return to cruise',stop.results.length===1&&!stop.results[0].hit&&stop.x<80&&stop.resume!==null,J({x:stop.x,v:stop.v,results:stop.results}));
}
module.exports={run};
if(require.main===module){let fail=0;run(require('./load.js').load(),(name,cond,detail)=>{console.log((cond?'[PASS] ':'[FAIL] ')+name+(detail?' — '+detail:''));if(!cond)fail++;});console.log(fail?fail+' FAILED':'all minigame checks passed');process.exitCode=fail?1:0;}
