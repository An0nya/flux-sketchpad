/* Layout study only. No app storage access, live solver, or production UI mutations. */
(() => {
  'use strict';
  const F = window.FLUX_REFERENCE;
  const $ = (id) => document.getElementById(id);
  const keys = ['scene', 'optics', 'editor', 'result'];
  const names = {scene:'Scene',optics:'Optics',editor:'Editor',result:'Result'};
  const panes = Object.fromEntries(keys.map(k => [k, document.querySelector(`[data-pane="${k}"]`)]));
  const state = {active:'editor',collapsed:new Set(),expanded:null,split:48,arrangement:'auto',mobile:false,stacked:false,erase:false,draft:false};
  const paint = F.scene.modeA.paint.slice();
  const cams = {scene:new RF.Render.Camera(130,26),optics:new RF.Render.Camera(130,26)};
  const fitKeys = {scene:'',optics:''};
  const mapBoxes = {};
  let progressTimer = 0;
  const pct = x => (100*x).toFixed(1)+'%';
  const tabs = keys.map(k => {const b=document.createElement('button');b.textContent=names[k];b.dataset.tab=k;b.addEventListener('click',()=>{state.collapsed.delete(k);state.active=k;if(!state.mobile&&k==='optics'&&state.stacked)state.expanded='optics';else if(state.expanded && !isInFocus(k))state.expanded=k;layout();});$('pane-tabs').append(b);return b;});
  function isInFocus(k){return state.expanded==='editor'||state.expanded==='result'?['editor','result'].includes(k):state.expanded===k;}
  function activate(k){state.active=k;for(const p of keys)panes[p].classList.toggle('active',p===k);for(const b of tabs){b.classList.toggle('active',b.dataset.tab===k);b.setAttribute('aria-pressed',String(b.dataset.tab===k));}}
  function layout(){
    const W=$('workspace'),R=$('right-workspace'),M=$('map-pair');
    state.mobile=window.innerWidth<=760;
    const rightWidth=state.expanded||state.collapsed.has('scene')?W.clientWidth:W.clientWidth*(1-state.split/100)-12;
    state.stacked=state.arrangement==='stack'||(state.arrangement==='auto'&&rightWidth<590);
    const shown={};
    for(const k of keys)shown[k]=state.mobile?k===state.active:!state.collapsed.has(k)&&(!state.expanded||isInFocus(k));
    if(!state.mobile&&!state.expanded&&state.stacked)shown.optics=false;
    for(const k of keys)panes[k].hidden=!shown[k];
    const maps=shown.editor||shown.result, right=maps||shown.optics;
    R.hidden=!right;M.hidden=!maps;
    $('main-divider').hidden=!(shown.scene&&right)||state.mobile;
    W.classList.toggle('single',!(shown.scene&&right));
    W.style.setProperty('--scene-share',state.split+'%');
    R.classList.toggle('one-row',!(maps&&shown.optics));
    M.classList.toggle('stacked',state.stacked);
    M.classList.toggle('solo',!(shown.editor&&shown.result));
    $('restore-layout').hidden=!state.expanded;
    for(const b of tabs){const k=b.dataset.tab;b.classList.toggle('closed',!shown[k]&&!state.mobile);b.title=shown[k]?'Select '+names[k]:'Open '+names[k];}
    for(const b of document.querySelectorAll('[data-expand]')){const focused=state.expanded&&isInFocus(b.dataset.expand);b.textContent=focused?'↙':'⤢';b.setAttribute('aria-label',(focused?'Restore ':'Expand ')+names[b.dataset.expand]);}
    $('main-divider').setAttribute('aria-valuenow',String(state.split));$('split-range').value=state.split;
    activate(state.active);requestAnimationFrame(drawAll);
  }
  for(const k of keys)panes[k].addEventListener('pointerdown',()=>activate(k));
  for(const b of document.querySelectorAll('[data-collapse]'))b.addEventListener('click',()=>{const k=b.dataset.collapse;state.collapsed.add(k);if(state.expanded&&isInFocus(k))state.expanded=null;const next=keys.find(p=>!state.collapsed.has(p));if(state.active===k&&next)state.active=next;layout();});
  for(const b of document.querySelectorAll('[data-expand]'))b.addEventListener('click',()=>{const k=b.dataset.expand;state.expanded=state.expanded&&isInFocus(k)?null:k;if(state.expanded==='editor'||state.expanded==='result'){state.collapsed.delete('editor');state.collapsed.delete('result');}state.active=k;layout();});
  $('restore-layout').addEventListener('click',()=>{state.expanded=null;layout();});
  $('reset-layout').addEventListener('click',()=>{state.collapsed.clear();state.expanded=null;state.split=48;state.arrangement='auto';$('map-layout').value='auto';layout();});
  function settings(open){$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));layout();}
  $('settings-toggle').addEventListener('click',()=>settings($('settings').hidden));$('close-settings').addEventListener('click',()=>settings(false));
  $('source-controls').addEventListener('click',()=>{settings(true);$('source-section').open=true;$('source-section').scrollIntoView({block:'nearest'});});
  $('map-layout').addEventListener('change',e=>{state.arrangement=e.target.value;layout();});
  function setSplit(v){state.split=Math.max(30,Math.min(65,v));layout();}
  $('split-range').addEventListener('input',e=>setSplit(+e.target.value));
  const divider=$('main-divider');let splitPointer=null;
  divider.addEventListener('pointerdown',e=>{splitPointer=e.pointerId;divider.setPointerCapture(e.pointerId);divider.classList.add('dragging');});
  divider.addEventListener('pointermove',e=>{if(splitPointer!==e.pointerId)return;const r=$('workspace').getBoundingClientRect();setSplit(Math.round((e.clientX-r.left)/r.width*100));});
  function stopSplit(){splitPointer=null;divider.classList.remove('dragging');}
  divider.addEventListener('pointerup',stopSplit);divider.addEventListener('pointercancel',stopSplit);
  divider.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setSplit(state.split+(e.key==='ArrowLeft'?-2:2));}});
  function canvas(id){const cv=$(id),r=cv.getBoundingClientRect();if(r.width<1||r.height<1)return null;const d=Math.min(2,window.devicePixelRatio||1);if(cv.width!==Math.round(r.width*d)||cv.height!==Math.round(r.height*d)){cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);}const c=cv.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,r.width,r.height);return {cv,c,w:r.width,h:r.height};}
  function path(c,points,close=false){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));if(close)c.closePath();}
  const heatValues=F.grid.filter(x=>x>0).sort((a,b)=>a-b);
  const peak=heatValues[Math.floor((heatValues.length-1)*.995)]||1;
  function color(t){t=Math.max(0,Math.min(1,t));const stops=[[12,26,35],[63,111,122],[153,197,188],[228,215,174]],p=t*3,i=Math.min(2,Math.floor(p)),a=p-i;return `rgb(${stops[i].map((x,k)=>Math.round(x+(stops[i+1][k]-x)*a)).join(',')})`;}
  const heatTexture=document.createElement('canvas');heatTexture.width=heatTexture.height=50;const hc=heatTexture.getContext('2d');F.grid.forEach((v,i)=>{hc.fillStyle=color(v/peak);hc.fillRect(i%50,49-Math.floor(i/50),1,1);});
  function draw3d(k){const out=canvas(k+'-canvas');if(!out)return;const {c,w,h}=out,cam=cams[k],full=k==='scene';cam.w=w;cam.h=h;
    const all=F.polys.flatMap(p=>p.pts).concat([F.scene.source.pos]);const pts=full?all.concat(F.target):all.concat($('envelope-on').checked?F.wire.flat():[]);const fitKey=w+':'+h+':'+(!full&&$('envelope-on').checked);if(fitKeys[k]!==fitKey){cam.fit(pts,.13);fitKeys[k]=fitKey;}
    const project=p=>cam.project(p);
    if(!full&&$('envelope-on').checked){c.strokeStyle='#7c939d55';c.lineWidth=.8;c.setLineDash([3,5]);for(const line of F.wire){path(c,line.map(project));c.stroke();}c.setLineDash([]);for(const p of F.wire.filter((_,i)=>i%3===0).map(a=>a[0])){const q=project(p);c.fillStyle='#99aeb8';c.fillRect(q[0]-2,q[1]-2,4,4);}}
    if(full){const pr=F.target.map(project);path(c,pr,true);c.fillStyle='#0b171f';c.fill();c.strokeStyle='#58768288';c.lineWidth=.8;c.stroke();c.save();c.beginPath();pr.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();c.clip();const a=pr[3],b=pr[2],d=pr[0];c.transform((b[0]-a[0])/50,(b[1]-a[1])/50,(d[0]-a[0])/50,(d[1]-a[1])/50,a[0],a[1]);c.imageSmoothingEnabled=false;c.globalAlpha=.85;c.drawImage(heatTexture,0,0);c.restore();const top=pr.reduce((a,b)=>a[1]<b[1]?a:b);c.fillStyle='#91aab5';c.font='11px system-ui';c.fillText('target',Math.min(w-45,top[0]+8),Math.max(16,top[1]-10));}
    const polys=F.polys.map(p=>({p,pr:p.pts.map(project),z:project(p.c)[2]})).sort((a,b)=>a.z-b.z);
    for(const {p,pr} of polys){const light=Math.abs(RF.V.dot(p.n,cam.R[2]));path(c,pr,true);c.fillStyle=`rgba(107,171,168,${.23+.48*light})`;c.fill();c.strokeStyle='#b5ded452';c.lineWidth=.55;c.stroke();}
    if(full&&$('rays-on').checked){c.strokeStyle='#d4b88b42';c.lineWidth=.6;const rays=F.paths.filter(p=>p.end==='target').slice(0,22);for(const r of rays){const arr=[];for(let i=0;i<r.points.length;i+=3)arr.push(project(r.points.slice(i,i+3)));path(c,arr);c.stroke();}}
    const src=project(F.scene.source.pos);c.fillStyle='#dcc499';c.beginPath();c.arc(src[0],src[1],3.2,0,Math.PI*2);c.fill();if(!full){c.strokeStyle='#dcc49955';c.beginPath();c.arc(src[0],src[1],9,0,Math.PI*2);c.stroke();c.fillStyle='#b9aaa0';c.font='11px system-ui';c.fillText('source',src[0]+13,src[1]+4);}
    const origin=[24,h-38];for(let i=0;i<3;i++){const ax=[0,0,0];ax[i]=1;const dx=RF.V.dot(cam.R[0],ax)*13,dy=-RF.V.dot(cam.R[1],ax)*13;c.strokeStyle=['#9ba4a0','#7da6ac','#a29aaa'][i];c.lineWidth=.8;path(c,[origin,[origin[0]+dx,origin[1]+dy]]);c.stroke();c.fillStyle=c.strokeStyle;c.font='9px system-ui';c.fillText('xyz'[i],origin[0]+dx*1.35,origin[1]+dy*1.35);}
  }
  function mapBox(w,h){const s=Math.max(1,Math.min(w-30,h-18));return {x:(w-s)/2,y:(h-s)/2,s};}
  function drawMap(k){const out=canvas(k+'-canvas');if(!out)return;const {c,w,h}=out,b=mapBox(w,h);mapBoxes[k]=b;c.fillStyle='#0c1921';c.fillRect(b.x,b.y,b.s,b.s);c.strokeStyle='#2b414c';c.lineWidth=.8;c.strokeRect(b.x,b.y,b.s,b.s);
    if(k==='result'){c.imageSmoothingEnabled=$('smooth').checked;c.drawImage(heatTexture,b.x,b.y,b.s,b.s);}else{const cell=b.s/50;paint.forEach((v,i)=>{if(v<=0)return;c.fillStyle=color(.7*v+.2);c.fillRect(b.x+(i%50)*cell,b.y+(49-Math.floor(i/50))*cell,cell+.2,cell+.2);});c.strokeStyle='#74969d12';c.lineWidth=.5;for(let i=1;i<5;i++){path(c,[[b.x+i*b.s/5,b.y],[b.x+i*b.s/5,b.y+b.s]]);c.stroke();path(c,[[b.x,b.y+i*b.s/5],[b.x+b.s,b.y+i*b.s/5]]);c.stroke();}}
  }
  function drawAll(){draw3d('scene');draw3d('optics');drawMap('editor');drawMap('result');}
  for(const k of ['scene','optics']){const cv=$(k+'-canvas');let drag=null;cv.addEventListener('pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);});cv.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;cams[k].turntable(e.clientX-drag.x,e.clientY-drag.y);drag.x=e.clientX;drag.y=e.clientY;draw3d(k);});cv.addEventListener('pointerup',()=>drag=null);cv.addEventListener('pointercancel',()=>drag=null);}
  for(const b of document.querySelectorAll('[data-fit]'))b.addEventListener('click',()=>{cams[b.dataset.fit].setAngles(130,26);fitKeys[b.dataset.fit]='';draw3d(b.dataset.fit);});
  $('rays-on').addEventListener('change',drawAll);$('envelope-on').addEventListener('change',drawAll);$('smooth').addEventListener('change',drawAll);
  function brush(v){$('brush').value=$('side-brush').value=v;$('brush-out').textContent=v;}
  $('brush').addEventListener('input',e=>brush(e.target.value));$('side-brush').addEventListener('input',e=>brush(e.target.value));
  $('erase').addEventListener('click',()=>{state.erase=!state.erase;$('erase').setAttribute('aria-pressed',String(state.erase));});
  function changed(){state.draft=true;$('draft-label').textContent='draft · not simulated';if(!progressTimer){$('status-icon').textContent='◇';$('status-text').textContent='Draft changed';}}
  let stroke=null;const editor=$('editor-canvas');
  function dab(e){const r=editor.getBoundingClientRect(),b=mapBoxes.editor;if(!b)return;const u=(e.clientX-r.left-b.x)/b.s,v=(e.clientY-r.top-b.y)/b.s;if(u<0||u>=1||v<0||v>=1)return;const x=Math.floor(u*50),y=49-Math.floor(v*50),radius=+$('brush').value;for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){const xx=x+i,yy=y+j;if(i*i+j*j<=radius*radius&&xx>=0&&xx<50&&yy>=0&&yy<50)paint[yy*50+xx]=state.erase?0:1;}changed();drawMap('editor');}
  editor.addEventListener('pointerdown',e=>{stroke=e.pointerId;editor.setPointerCapture(e.pointerId);dab(e);});editor.addEventListener('pointermove',e=>{if(stroke===e.pointerId)dab(e);});editor.addEventListener('pointerup',()=>stroke=null);editor.addEventListener('pointercancel',()=>stroke=null);
  $('reset-paint').addEventListener('click',()=>{paint.splice(0,paint.length,...F.scene.modeA.paint);state.draft=false;$('draft-label').textContent='intended';if(!progressTimer){$('status-icon').textContent='✓';$('status-text').textContent='Reference ready';}drawMap('editor');});
  function finishProgress(){clearInterval(progressTimer);progressTimer=0;$('progress-drop').hidden=true;$('status-icon').className='';$('status-icon').textContent=state.draft?'◇':'✓';$('status-text').textContent=state.draft?'Draft changed':'Reference ready';$('progress-demo').disabled=false;}
  $('progress-demo').addEventListener('click',()=>{finishProgress();const start=performance.now();$('progress-demo').disabled=true;$('progress-drop').hidden=false;$('status-icon').textContent='';$('status-icon').className='working';$('status-text').textContent='Working · demo';$('progress-label').textContent='Generating reflector · demonstration';$('progress-fill').className='indeterminate';progressTimer=setInterval(()=>{const t=performance.now()-start;if(t>1200){$('progress-fill').className='';const p=Math.min(100,Math.floor((t-1200)/28));$('progress-fill').style.width=p+'%';$('progress-label').textContent='Tracing light · '+p+'% · demonstration';}if(t>4300)finishProgress();},70);});$('cancel-progress').addEventListener('click',finishProgress);
  const S=F.stats,E=S.energy,em=E.emitted;
  $('metric-delivered').textContent=pct(S.effViaSurface+S.effDirect);$('metric-coverage').textContent=pct(S.coverage);$('metric-uniformity').textContent=S.uniformity.toFixed(2);
  $('issue-summary').textContent=F.report.dropped?`Reference · ${F.report.dropped} facets unplaced`:'Reference · design checks';
  const bins=[['Reached target',E.direct+E.reflected,'#94b9b3'],['Absorbed',E.absorbed+E.backface,'#627d88'],['Escaped',E.escaped,'#354955'],['Target back',E.targetBack,'#837e93'],['Untraced reflection',E.interfaceLoss,'#9b95a4'],['Stopped tracing',E.truncated,'#b3aaa0']];
  for(const [name,value,color] of bins){if(!value)continue;const mark=document.createElement('i');mark.style.width=value/em*100+'%';mark.style.background=color;mark.title=name+' '+pct(value/em);if(name==='Stopped tracing'||name==='Untraced reflection')mark.className='stopped';$('energy-bar').append(mark);const row=document.createElement('div');row.className='energy-row';const swatch=document.createElement('i');swatch.style.background=color;swatch.className=mark.className;const label=document.createElement('span');label.textContent=name;const val=document.createElement('b');val.textContent=pct(value/em);row.append(swatch,label,val);$('energy-rows').append(row);}
  const entries=[['Delivered via optics',pct(S.effViaSurface)],['Delivered directly',pct(S.effDirect)],['Coverage · beam threshold',pct(S.coverage)],['Uniformity · U₀',S.uniformity.toFixed(2)],['Rays traced',S.rays.toLocaleString()],['Optical surfaces',S.surfaces],['Energy residual',S.conservationError.toExponential(1)]];
  for(const [label,value] of entries){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('detail-metrics').append(dt,dd);}
  for(const text of F.report.warnings.concat([`Noise ceiling ${S.noiseCeiling.toFixed(2)} at ${Math.round(S.raysPerCell)} rays per evaluated cell.`,`Coverage is the current engine's beam measure; uniformity is its existing painted-region measure.`,`No new physical feasibility analysis in this layout study.`])){const p=document.createElement('p');p.textContent=text;$('design-issues').append(p);}
  function showMetrics(){activate('result');$('metrics-dialog').showModal();$('details-toggle').setAttribute('aria-expanded','true');}
  $('details-toggle').addEventListener('click',showMetrics);$('issue-summary').addEventListener('click',showMetrics);$('close-metrics').addEventListener('click',()=>$('metrics-dialog').close());$('metrics-dialog').addEventListener('close',()=>$('details-toggle').setAttribute('aria-expanded','false'));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('metrics-dialog').open){if(!$('settings').hidden)settings(false);else if(state.expanded){state.expanded=null;layout();}}});
  let queued=false;new ResizeObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;layout();});}}).observe($('workspace'));
  window.addEventListener('resize',layout);
  // Read-only diagnostic snapshot for layout review; never reads app localStorage.
  window.fluxStudy={inspect:()=>({active:state.active,expanded:state.expanded,collapsed:[...state.collapsed],split:state.split,mobile:state.mobile,stacked:state.stacked,draft:state.draft,visible:keys.filter(k=>!panes[k].hidden),referenceRays:S.rays,paintedCells:paint.filter(v=>v>0).length})};
  layout();
})();
