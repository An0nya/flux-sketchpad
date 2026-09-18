'use strict';
importScripts('math.js','state.js','geometry.js','engine.js','design.js','tune.js');
let active=0;
onmessage=function(event) {
  const {id,state,action,rays}=event.data;active=id;
  try {
    if(action==='tune'){const out=Optics.Tune.search(state,event.data.objective,event.data.opts,p=>{if(active===id)postMessage({id,kind:'tune-progress',progress:p});});postMessage({id,kind:'tune',best:out.best,evals:out.evals,objective:out.objective});return;}
    if(action==='design'){const t=performance.now();Optics.Design.generate(state);postMessage({id,kind:'design',surfaces:state.surfaces,notes:state.notes,stamps:state.stamps,designCache:state.designCache,ms:performance.now()-t});}
    const simulation=new Optics.Simulation(state,{rays}),start=performance.now();let last=start;
    function tick(){if(active!==id)return;try{const begin=performance.now();do{simulation.step(256);}while(simulation.done<simulation.total&&performance.now()-begin<18);const now=performance.now();if(now-last>80||simulation.done===simulation.total){const grid=simulation.grid.slice();postMessage({id,kind:'trace',grid,paths:simulation.paths,stats:simulation.stats(),ledger:simulation.ledger,complete:simulation.done===simulation.total},[grid.buffer]);last=now;}if(simulation.done<simulation.total)setTimeout(tick,0);}catch(e){postMessage({id,kind:'error',message:e.stack||String(e)});}}
    tick();
  }catch(e){postMessage({id,kind:'error',message:e.stack||String(e)});}
};
