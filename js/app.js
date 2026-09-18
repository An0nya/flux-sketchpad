(function(O) {
  'use strict';
  const $=id=>document.getElementById(id),{V}=O;
  class App {
    constructor() {
      this.state=O.State.defaults();O.State.paintPreset(this.state);this.result=null;this.selectedStamp=null;this.serial=Date.now();this.job=0;this.runTimer=0;this.worker=null;
      try {const saved=localStorage.getItem('flux-scene-v1');if(saved)this.state=O.State.validate(JSON.parse(saved));}catch(e){this.startupMessage='Saved scene could not be restored: '+e.message;}
      this.renderer=new O.Renderer(this);this.input=new O.Input(this,this.renderer);this.buildVectorFields();this.bind();this.sync();
      if(location.protocol!=='file:') {try{this.worker=new Worker('js/worker.js');this.worker.onmessage=e=>this.receive(e.data);this.worker.onerror=e=>{this.toast('Worker failed; using progressive main-thread tracing. '+e.message);this.worker.terminate();this.worker=null;this.run();};}catch(e){this.toast('Worker unavailable: '+e.message);}}
      else this.startupMessage='Opened directly from disk. Tracing works progressively; use a local HTTP server to move design searches into a worker.';
      new ResizeObserver(()=>this.renderer.draw()).observe(document.querySelector('.workspace'));
      if(!this.state.surfaces.length)this.generate();else this.run();if(this.startupMessage)this.toast(this.startupMessage);
      window.flux=this;
    }
    buildVectorFields() {
      for(const [id,path,title]of [['source-position','source.position','Source'],['envelope-size','envelope.size','Size'],['envelope-position','envelope.center','Center'],['target-aim','target.aim','Aim']])for(let i=0;i<3;i++) {
        const label=document.createElement('label');label.textContent=title+' '+['X','Y','Z'][i];const input=document.createElement('input');input.type='number';input.step='.5';input.dataset.vector=path;input.dataset.component=i;input.addEventListener('input',()=>{if(!Number.isFinite(input.valueAsNumber))return;const v=[...this.get(path)];v[i]=input.valueAsNumber;if(path==='envelope.size'&&v[i]<=0)return;this.edit(path,v,true);});label.append(input);$(id).append(label);
      }
    }
    get(path){return path.split('.').reduce((o,k)=>o[k],this.state);}
    bind() {
      document.querySelectorAll('[data-path]').forEach(el=>el.addEventListener('input',()=>{
        let value=el.type==='checkbox'?el.checked:el.tagName==='SELECT'&&['target.resolution','design.paintLevel'].includes(el.dataset.path)||el.type==='range'||el.type==='number'?Number(el.value):el.value;
        if(typeof value==='number'&&(!Number.isFinite(value)||el.min!==''&&value<Number(el.min)||el.max!==''&&value>Number(el.max)))return;
        this.edit(el.dataset.path,value,true);
      }));
      document.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>{this.state.mode=el.dataset.mode;this.preview=null;this.sync();this.renderer.draw();this.persist();}));
      document.querySelectorAll('[data-pattern]').forEach(el=>el.addEventListener('click',()=>{O.State.paintPreset(this.state,el.dataset.pattern);this.renderer.drawMap('intent');this.generate();}));
      $('generate').addEventListener('click',()=>this.generate());$('run').addEventListener('click',()=>this.run());
      $('scene-preset').addEventListener('change',e=>this.preset(e.target.value));
      $('eraser').addEventListener('click',()=>{this.erasing=!this.erasing;$('eraser').textContent='Eraser '+(this.erasing?'on':'off');});
      $('clear-paint').addEventListener('click',async()=>{if(await this.confirm('Clear the intended painting?')){this.state.paint.fill(0);this.renderer.drawMap('intent');this.persist();}});
      $('duplicate-stamp').addEventListener('click',()=>{const t=this.state.stamps.find(t=>t.id===this.selectedStamp);if(t){const copy={...t,id:'stamp-'+(++this.serial),u:V.clamp(t.u+.08,0,1)};this.state.stamps.push(copy);this.selectedStamp=copy.id;this.generate();}});
      $('delete-stamp').addEventListener('click',async()=>{if(this.selectedStamp&&await this.confirm('Delete the selected tile and re-solve the surfaces?')){this.state.stamps=this.state.stamps.filter(t=>t.id!==this.selectedStamp);this.selectedStamp=null;this.generate();}});
      $('parabola').addEventListener('click',()=>{O.Design.parabolaProfile(this.state);this.run();});
      $('undo-profile').addEventListener('click',()=>{this.state.profile.pop();O.Design.profileMesh(this.state);this.run();});
      $('clear-profile').addEventListener('click',async()=>{if(await this.confirm('Clear the profile and its optical surfaces?')){this.state.profile=[];O.Design.profileMesh(this.state);this.run();}});
      $('add-lens').addEventListener('click',()=>{O.Design.lens(this.state);this.run();this.sync();});
      $('axis-yaw').addEventListener('input',()=>this.edit('source.axis',V.axis(Number($('axis-yaw').value)*Math.PI/180,Number($('axis-pitch').value)*Math.PI/180),true));
      $('axis-pitch').addEventListener('input',()=>this.edit('source.axis',V.axis(Number($('axis-yaw').value)*Math.PI/180,Number($('axis-pitch').value)*Math.PI/180),true));
      $('target-tilt').addEventListener('input',()=>{const a=Number($('target-tilt').value)*Math.PI/180;this.edit('target.normal',[0,Math.sin(a),-Math.cos(a)],true);});
      $('surface-style').addEventListener('click',()=>{const s=this.state.view;if(!s.normals&&!s.surfacePairs)s.normals=true;else if(s.normals){s.normals=false;s.surfacePairs=true;}else s.surfacePairs=false;$('surface-style').textContent=s.normals?'Ray pairs':s.surfacePairs?'Polygons':'Normals';this.renderer.drawScene('surfaces');});
      $('reset-view').addEventListener('click',()=>{Object.assign(this.state.view,{yaw:.62,pitch:.28,zoom:1,pan:[0,0]});this.renderer.smallView={yaw:.6,pitch:.45,zoom:1,pan:[0,0]};this.renderer.mapViews={intent:{zoom:1,pan:[0,0]},heatmap:{zoom:1,pan:[0,0]}};this.renderer.draw();});
      for(const [id,key]of [['surface-type','type'],['surface-reflectivity','reflectivity'],['surface-ior','ior'],['surface-two-sided','twoSided'],['surface-focal','focal']])$(id).addEventListener('input',()=>{const f=this.state.surfaces.find(f=>f.id===this.state.selection);if(!f)return;const e=$(id),v=e.type==='checkbox'?e.checked:e.type==='number'?e.valueAsNumber:e.value;if(typeof v==='number'&&(!Number.isFinite(v)||e.min!==''&&v<Number(e.min)||e.max!==''&&v>Number(e.max)))return;f[key]=v;if(key==='type'){f.reflectivity??=.9;f.ior??=1.5;}this.syncInspector();this.run(true);});
      $('save').addEventListener('click',()=>{this.persist();this.toast('Scene saved in this browser.');});
      $('load').addEventListener('click',()=>$('file').click());$('file').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;const s=O.State.validate(JSON.parse(await file.text()));this.state=s;this.selectedStamp=null;this.sync();this.run();this.toast('Complete scene restored.');}catch(err){this.toast('Could not open scene: '+err.message);}e.target.value='';});
      $('download').addEventListener('click',()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(this.state,null,2)],{type:'application/json'}));a.href=url;a.download='flux-scene.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      $('tests').addEventListener('click',()=>this.checks());
      // On a phone the sidebar is a drawer over the scene, so it starts closed;
      // on desktop it is a column and starts open. Same class, opposite default.
      if(window.innerWidth<=900)document.body.classList.add('aside-hidden');
      $('sidebar-toggle').addEventListener('click',()=>{document.body.classList.toggle('aside-hidden');this.resize();});
      $('generate-top').addEventListener('click',()=>this.generate());
      $('restore').addEventListener('click',async()=>{const raw=localStorage.getItem('flux-scene-v1');if(!raw)return this.toast('No scene saved in this browser yet.');if(!await this.confirm('Replace the current scene with the one saved in this browser?'))return;try{this.state=O.State.validate(JSON.parse(raw));this.selectedStamp=null;this.sync();this.run();this.toast('Restored the scene saved in this browser.');}catch(e){this.toast('Saved scene could not be restored: '+e.message);}});
      const tuneHint=()=>{const o=O.Tune.OBJECTIVES[$('tune-objective').value];$('tune-hint').textContent=o?o.hint:'';};
      $('tune-objective').addEventListener('change',tuneHint);tuneHint();
      $('tune-run').addEventListener('click',()=>this.tune());
      this.collapsibles();$('close-tests').addEventListener('click',()=>{$('test-panel').hidden=true;});
    }
    edit(path,value,preview=false) {
      O.State.edit(this.state,path,value);
      if(path==='source.kind'){this.state.source.shape=value==='planar'?'disc':value==='volume'?'sphere':'disc';if(value==='volume'){this.state.source.distribution='cone';this.state.source.angle=180;this.toast('Volume preset now emits isotropically: uniform cone, half-angle 180°.');}}
      if(path==='design.stampSize'){const t=this.state.stamps.find(t=>t.id===this.selectedStamp);if(t)t.size=value;}
      this.sync();
      if(path.startsWith('view.')||['design.brush','design.paintLevel'].includes(path)){this.renderer.draw();this.persist();return;}
      if(path.startsWith('design.')&&!['design.brush','design.paintLevel','design.stampSize'].includes(path)){if(this.state.mode==='profile'&&path.startsWith('design.profile')||path==='design.extrusion')O.Design.profileMesh(this.state);else if(['design.curved','design.budget','design.fill','design.edgeBias','design.designEmitter'].includes(path)){this.generate(preview);return;}}
      if(path==='design.stampSize'&&this.state.mode==='stamp'){this.generate(preview);return;}
      this.run(preview);
    }
    sync() {
      const s=this.state;this.markStale();
      const shape=$('source-shape'),choices=s.source.kind==='volume'?['sphere','cylinder']:['disc','rectangle'];if([...shape.options].map(x=>x.value).join()!==choices.join()){shape.replaceChildren(...choices.map(x=>new Option(x,x)));}
      document.querySelectorAll('[data-path]').forEach(el=>{const v=this.get(el.dataset.path);if(el.type==='checkbox')el.checked=v;else el.value=v;});
      document.querySelectorAll('[data-output]').forEach(el=>el.textContent=this.get(el.dataset.output));
      document.querySelectorAll('[data-vector]').forEach(el=>{el.value=this.get(el.dataset.vector)[Number(el.dataset.component)];});
      document.querySelectorAll('[data-mode]').forEach(el=>el.classList.toggle('active',el.dataset.mode===s.mode));for(const m of ['paint','stamp','profile'])$(m+'-controls').hidden=m!==s.mode;
      $('curved-label').hidden=s.mode==='profile';$('intent-label').innerHTML=s.mode==='profile'?'CROSS-SECTION <span>tap to add points</span>':s.mode==='stamp'?'TILES <span>tap to stamp</span>':'INTENDED <span>paint here</span>';
      $('generate').firstChild.textContent=s.mode==='profile'?'Sweep profile ':s.mode==='stamp'?'Solve tiles ':'Generate reflector ';
      $('source-summary').textContent=s.source.kind==='point'?'Point source':s.source.kind==='volume'?'Volume · '+s.source.shape:'LED · '+s.source.shape;
      $('source-shape-label').hidden=s.source.kind==='point';$('source-size-label').hidden=s.source.kind==='point';$('source-aspect-label').hidden=s.source.kind!=='planar'||s.source.shape!=='rectangle';$('source-height-label').hidden=s.source.kind!=='volume'||s.source.shape!=='cylinder';$('angle-label').hidden=s.source.distribution==='lambertian';
      $('axis-yaw').value=(Math.atan2(s.source.axis[0],s.source.axis[2])*180/Math.PI).toFixed(1);$('axis-pitch').value=(Math.asin(V.clamp(s.source.axis[1],-1,1))*180/Math.PI).toFixed(1);
      $('target-tilt').value=Math.atan2(s.target.normal[1],-s.target.normal[2])*180/Math.PI;$('target-aim').hidden=s.target.linked;$('symmetry-label').hidden=s.design.profileSweep!=='extrude';$('extrusion-label').hidden=s.design.profileSweep!=='extrude';$('rings-label').hidden=s.design.lens!=='fresnel';
      const maxDistance=V.distance(s.source.position,s.envelope.center)+V.len(s.envelope.size)/2,minTarget=Math.max(0,V.distance(s.target.center,s.envelope.center)-V.len(s.envelope.size)/2),min=Math.max(.2,s.source.kind==='point'?.2:s.source.size*minTarget/maxDistance);
      const selectedFacet=this.selectedStamp?s.surfaces.find(f=>f.stampId===this.selectedStamp):null,floor=selectedFacet?.minTileSize||Math.ceil(min*10)/10;
      $('stamp-size').min=floor;$('stamp-size').max=Math.max(20,floor*2);$('stamp-size').value=s.design.stampSize;$('stamp-limit').textContent=selectedFacet?`This surface’s estimated source-image floor: ${floor.toFixed(2)} units. Smaller widths are unavailable.`:`Optimistic source-image floor ${min.toFixed(2)} units. Actual off-axis blur is reported below.`;
      $('duplicate-stamp').disabled=!this.selectedStamp;$('delete-stamp').disabled=!this.selectedStamp;
      this.syncInspector();this.showStats();
    }
    syncInspector(){const f=this.state.surfaces.find(f=>f.id===this.state.selection);$('surface-fields').hidden=!f;$('surface-id').textContent=f?String(f.id):'Tap a facet in the surface view.';if(!f)return;$('surface-type').value=f.type;$('surface-reflectivity').value=f.reflectivity??.9;$('surface-ior').value=f.ior??1.5;$('surface-two-sided').checked=!!f.twoSided;$('surface-focal').value=f.focal||0;$('reflectivity-label').hidden=f.type!=='reflect';$('two-sided-label').hidden=f.type!=='reflect';$('ior-label').hidden=f.type!=='refract';$('focal-label').hidden=!!f.vertices;}
    async preset(name) {
      if(this.state.surfaces.length&&!await this.confirm('Replace this scene with the selected preset? Source, envelope and tracing settings will change visibly.'))return;
      ++this.job;clearTimeout(this.runTimer);clearTimeout(this.refineTimer);this.result=null;this.preview=null;
      this.state=O.State.defaults();O.State.paintPreset(this.state);const s=this.state;
      if(name==='dish'){s.mode='profile';s.source.kind='point';s.source.distribution='cone';s.source.angle=85;s.simulation.rays=10000;O.Design.parabolaProfile(s);}
      if(name==='side'){s.source.position=[-12,-9,-2];s.source.axis=V.unit([1,.3,-.8]);s.envelope.center=[2,4,-14];s.envelope.size=[32,42,34];s.simulation.rays=10000;s.design.budget=96;}
      if(name==='lens'){s.source.position=[0,0,0];s.source.axis=[0,0,1];s.source.kind='point';s.source.distribution='cone';s.source.angle=35;s.envelope.center=[0,0,12];s.envelope.size=[22,22,24];s.simulation.bounces=6;s.simulation.rays=10000;s.design.lensRadius=7;s.design.lensThickness=3;s.design.lensFocal=20;O.Design.lens(s);}
      this.selectedStamp=null;this.sync();this.persist();this.toast('Preset applied: source, envelope and trace settings are shown in the controls.');if(name==='dish'||name==='lens')this.run();else this.generate();
    }
    generate(preview=false) {
      if(this.state.mode==='profile'){O.Design.profileMesh(this.state);this.run(preview);return;}
      clearTimeout(this.runTimer);this.runTimer=setTimeout(()=>this.dispatch('design',preview),preview?100:0);
    }
    run(preview=false) {clearTimeout(this.runTimer);this.renderer.draw();this.runTimer=setTimeout(()=>this.dispatch('trace',preview),preview?80:0);}
    dispatch(action,preview=false) {
      const id=++this.job,state=O.State.clone(this.state),rays=preview?Math.min(600,state.simulation.rays):state.simulation.rays;$('heatmap').dataset.updates='0';$('run-state').textContent=action==='design'?'SOLVING':'TRACING';this.renderer.draw();
      if(this.worker)this.worker.postMessage({id,state,action,rays});
      else {
        if(action==='design'){const start=performance.now();O.Design.generate(state);this.receive({id,kind:'design',surfaces:state.surfaces,notes:state.notes,stamps:state.stamps,designCache:state.designCache,ms:performance.now()-start});}
        const sim=new O.Simulation(state,{rays});const tick=()=>{if(id!==this.job)return;const start=performance.now();do{sim.step(128);}while(sim.done<sim.total&&performance.now()-start<12);this.receive({id,kind:'trace',grid:sim.grid,stats:sim.stats(),ledger:sim.ledger,paths:sim.paths,complete:sim.done===sim.total});if(sim.done<sim.total)setTimeout(tick,0);};setTimeout(tick,0);
      }
      if(preview){clearTimeout(this.refineTimer);this.refineTimer=setTimeout(()=>{if(this.job===id)this.run();},450);}
    }
    receive(m) {
      if(m.id!==this.job)return;
      if(m.kind==='tune-progress'){const p=m.progress;$('tune-status').textContent=`${p.evals}/${p.total} · ${p.current.budget} facets, fill ${p.current.fill}, emitter ${p.current.de} → ${p.current.score.toFixed(3)}`;return;}
      if(m.kind==='tune'){const b=m.best;Object.assign(this.state.design,{budget:b.budget,fill:b.fill,designEmitter:b.de});$('tune-run').disabled=false;
        $('tune-status').textContent=`${m.evals} traced · best ${b.facets} facets, fill ${b.fill}, emitter ${b.de} — filled ${(b.stats.intentFilled*100).toFixed(1)}%, on-target ${(b.stats.intentOnTarget*100).toFixed(1)}%, captured ${(b.stats.intercepted*100).toFixed(1)}%`;
        this.sync();this.generate();return;}
      if(m.kind==='error'){this.toast(m.message);$('run-state').textContent='ERROR';console.error(m.message);return;}
      if(m.kind==='design'){this.state.surfaces=m.surfaces;this.state.notes=m.notes;this.state.stamps=m.stamps;this.state.designCache=m.designCache;const stamp=this.state.stamps.find(t=>t.id===this.selectedStamp);if(stamp)this.state.design.stampSize=stamp.size;this.designMs=m.ms;this.solvedKey=this.sceneKey();
        const f=this.selectedStamp?this.state.surfaces.find(f=>f.stampId===this.selectedStamp):null;if(f){const incoming=V.unit(V.sub(f.center,this.state.source.position)),out=V.reflect(incoming,V.unit(f.normal)),hit=O.Geometry.targetHit(this.state.target,f.center,out,1e-9);this.preview=[this.state.source.position,f.center,hit?.p||V.add(f.center,V.mul(out,40))];}else this.preview=null;
        this.sync();this.persist();
      } else {this.result=m;$('heatmap').dataset.gridHash=m.stats.hash;$('heatmap').dataset.rays=m.stats.rays;$('heatmap').dataset.complete=String(m.complete);$('heatmap').dataset.updates=String(Number($('heatmap').dataset.updates||0)+1);$('run-state').textContent=m.complete?'RUN COMPLETE':'TRACING '+m.stats.rays.toLocaleString();$('map-progress').textContent=m.stats.rays.toLocaleString()+' rays';this.showStats();if(m.complete)this.persist();}
      this.renderer.draw();
    }
    showStats() {
      const t=this.result?.stats||{rays:0,coverage:0,uniformity:0,intercepted:0,via:0,direct:0,ms:0},pct=x=>(x*100).toFixed(1)+'%';
      const rows=[['Rays / facets',`${t.rays.toLocaleString()}<small> / ${this.state.surfaces.length}</small>`,'Emitted primary rays traced / finite optical primitives. Refraction can branch each ray.'],['Intent filled',pct(t.intentFilled||0),'Painted cells receiving any energy, as a fraction of painted cells. Unlike Coverage this knows where the painting is.'],['On target',pct(t.intentOnTarget||0),'Energy landing inside the painted region as a fraction of all energy on the target plane. The spill measure.'],['Intent unif.',(t.intentUniformity||0).toFixed(3),'1 − sd/mean over painted cells only. Cannot be won by washing light across the whole plane.'],['Coverage',pct(t.coverage),'Lit cells over the WHOLE target plane. A diagnostic, not an objective: it does not know where the painting is.'],['Uniformity',t.uniformity.toFixed(3),'1 − sd/mean over all lit cells, whole plane. Diagnostic only — maximised by a thin even wash.'],['Intercepted',pct(t.intercepted),'Fraction of emitted primary-ray power encountering any surface, including back faces.'],['Via surfaces',pct(t.via),'Fraction of emitted power reaching the target after any optical interaction, including lenses.'],['Direct',pct(t.direct),'Fraction of emitted power reaching the target without touching a surface.'],['Trace time',`${t.ms.toFixed(1)}<small> ms</small>`,'Measured tracing CPU time, excluding scene compilation, design search, messaging and rendering.']];
      $('stats').innerHTML=rows.map(([label,value,help])=>`<div class="stat" title="${help}"><b>${value}</b><span>${label} ⓘ</span></div>`).join('');
      const notes=[...this.state.notes];if(this.result?.ledger){const l=this.result.ledger,e=l.emitted||1;notes.push({kind:t.unresolved>.02?'limit':'info',text:`Energy ledger: target ${(100*l.target/e).toFixed(2)}% · absorbed ${(100*l.absorbed/e).toFixed(2)}% · escaped ${(100*l.escaped/e).toFixed(2)}% · unresolved ${(100*l.unresolved/e).toFixed(2)}%. ${t.unresolved>.02?'Increase the bounce limit or lower the energy floor to follow truncated paths.':''}`});if(l.refracted>0)notes.push({kind:'info',text:`Target via reflection ${(100*l.reflected/e).toFixed(2)}%; via refraction ${(100*l.refracted/e).toFixed(2)}%. Mixed paths appear in both labels; the total above counts each energy packet once.`});}
      $('constraints').replaceChildren(...notes.map(n=>{const p=document.createElement('p');p.className=n.kind;p.textContent=n.text;return p;}));
    }
    confirm(message){
      const dialog=$('confirm-dialog');$('confirm-message').textContent=message;dialog.showModal();
      return new Promise(resolve=>{const finish=value=>{dialog.close();$('confirm-accept').onclick=null;$('confirm-cancel').onclick=null;dialog.oncancel=null;resolve(value);};$('confirm-accept').onclick=()=>finish(true);$('confirm-cancel').onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};});
    }
    toast(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>$('toast').style.display='none',7500);}
    // The scene canvas now flexes to whatever height is left, so the useful
    // control is hiding the panels below it rather than dragging a divider —
    // on a short screen dragging only ever traded one cramped view for another.
    collapsibles() {
      const toggle=(host,cls,key,on,off,defaultHidden)=>{
        const b=document.createElement('button');b.className='panel-toggle';b.type='button';
        const apply=()=>{const hidden=(localStorage.getItem(key)??(defaultHidden?'1':'0'))==='1';host.classList.toggle(cls,hidden);b.textContent=hidden?on:off;this.resize();};
        b.addEventListener('click',()=>{const cur=(localStorage.getItem(key)??(defaultHidden?'1':'0'))==='1';localStorage.setItem(key,cur?'0':'1');apply();});
        return {b,apply};
      };
      for(const [sel,key,label] of [['.surface-panel','flux-hide-surfaces','surfaces'],['.map-panel','flux-hide-maps','maps']]) {
        const panel=document.querySelector(sel);if(!panel)continue;
        const t=toggle(panel,'collapsed',key,'Show','Hide');panel.querySelector('.panel-head').appendChild(t.b);t.apply();
      }
      const mp=document.querySelector('.metrics-panel');
      if(mp){const t=toggle(mp,'notes-hidden','flux-hide-notes','Show notes','Hide notes',true);mp.querySelector('.constraint-head').appendChild(t.b);t.apply();}
      // The canvases are measured from the DOM on every draw, so a height change
      // needs a redraw or they keep their old backing-store size.
      if(window.ResizeObserver)new ResizeObserver(()=>this.resize()).observe(document.querySelector('.scene-panel'));
      window.addEventListener('resize',()=>this.resize());
    }
    resize(){cancelAnimationFrame(this.resizeFrame);this.resizeFrame=requestAnimationFrame(()=>this.renderer.draw());}
    // Which inputs the CURRENT facets were solved against. Moving the source or
    // resizing the envelope only re-traces, by design — solving is expensive and
    // watching a fixed reflector react to a moving scene is useful. But nothing
    // said the facets no longer matched, so this marks the Generate buttons.
    sceneKey() {
      const s=this.state,d=s.design,{brush,paintLevel,stampSize,...solver}=d;
      let h=0;for(let i=0;i<s.paint.length;i++)if(s.paint[i])h=(h*31+s.paint[i]*97+i)|0;
      return JSON.stringify([s.source,s.envelope,s.target.center,s.target.normal,s.target.width,s.target.height,s.target.resolution,solver,s.mode,s.stamps])+'|'+h;
    }
    markStale() {
      const stale=this.solvedKey!==undefined&&this.solvedKey!==this.sceneKey();
      for(const id of ['generate','generate-top']){const b=$(id);if(b)b.classList.toggle('stale',stale);}
    }
    tune() {
      const objective=$('tune-objective').value,opts={rays:20000,maxBudget:$('tune-wide').checked?2000:500};
      const id=++this.job,state=O.State.clone(this.state);
      $('tune-run').disabled=true;$('tune-status').textContent='Searching…';$('run-state').textContent='TUNING';
      if(this.worker)this.worker.postMessage({id,state,action:'tune',objective,opts});
      else setTimeout(()=>{const out=O.Tune.search(state,objective,opts);this.receive({id,kind:'tune',best:out.best,evals:out.evals,objective});},0);
    }
    persist(){try{localStorage.setItem('flux-scene-v1',JSON.stringify(this.state));}catch(e){this.toast('Browser storage unavailable. Export JSON to keep your scene.');}}
    async browserChecks(onRow) {
      const saved=O.State.clone(this.state),savedStamp=this.selectedStamp,out=[];
      const settle=async before=>{const start=performance.now();while(performance.now()-start<15000){await new Promise(r=>setTimeout(r,20));if(this.job>before&&this.result?.id===this.job&&this.result.complete&&this.result.stats.rays===this.state.simulation.rays)return this.result.stats.hash;}throw Error('UI-triggered full-resolution run did not complete.');};
      const event=(selector,value)=>{const el=document.querySelector(selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
      const pointer=(canvas,u,v,type)=>{const rect=canvas.getBoundingClientRect(),m=this.renderer.mapGeometry('intent',rect.width,rect.height);canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:999,pointerType:'mouse',clientX:rect.x+m.x+u*m.size,clientY:rect.y+m.y+v*m.size,buttons:type==='pointerup'?0:1}));};
      try {
        for(const mode of ['paint','stamp','profile']) {
          const name=`UI · ${mode} event path changes the simulated grid`;let row;
          try {
            clearTimeout(this.refineTimer);this.state=O.State.defaults();O.State.paintPreset(this.state);this.state.design.budget=24;this.state.simulation.rays=6000;this.selectedStamp=null;this.sync();document.querySelector(`[data-mode="${mode}"]`).click();let before=this.job;
            if(mode==='stamp'){pointer($('intent'),.5,.5,'pointerdown');pointer($('intent'),.5,.5,'pointerup');}
            else if(mode==='profile')$('parabola').click();else $('generate').click();
            const a=await settle(before);before=this.job;
            if(mode==='stamp')event('[data-path="design.stampSize"]',12);
            else if(mode==='profile')event('[data-path="design.profileSweep"]','extrude');
            else event('[data-path="design.curved"]',false);
            const b=await settle(before);if(a===b)throw Error(`Control left hash unchanged: ${a}`);
            row={name,pass:true,detail:`Actual DOM input / pointer handlers: ${a} → ${b}. ${this.state.surfaces.length} surfaces.`};
          }catch(e){row={name,pass:false,detail:e.message};}
          out.push(row);onRow(row);
        }
      }finally{clearTimeout(this.refineTimer);this.state=saved;this.selectedStamp=savedStamp;this.sync();this.run();}
      return out;
    }
    async checks(){
      $('tests').disabled=true;$('test-panel').hidden=false;$('test-results').textContent='Running real numerical checks…';$('test-panel').scrollIntoView({behavior:'smooth',block:'start'});
      const append=row=>{if(!this.checkStarted){$('test-results').replaceChildren();this.checkStarted=true;}const div=document.createElement('div');div.className='test-row'+(row.pass?'':' fail');const b=document.createElement('b');b.textContent=row.pass?'PASS':'FAIL';div.append(b,document.createTextNode(row.name));const p=document.createElement('p');p.textContent=row.detail;div.append(p);$('test-results').append(div);};
      try {const results=await O.Checks.runAsync(append);results.push(...await this.browserChecks(append));this.testResults=results;$('test-results').dataset.complete='true';$('test-results').dataset.passed=results.filter(r=>r.pass).length;$('test-results').dataset.total=results.length;}
      finally {this.checkStarted=false;$('tests').disabled=false;}
    }
  }
  new App();
})(Optics);
