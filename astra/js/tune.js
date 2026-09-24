(function(O) {
  'use strict';
  // Coordinate descent over the three allocator knobs, scored by tracing.
  //
  // The objectives are deliberately intent-relative. stats().coverage and
  // stats().uniformity are computed over the whole target plane and do not know
  // where the painting is, so maximising either walks straight toward a thin
  // even wash across everything — a great score and a worse luminaire. Every
  // objective here is measured inside the painted region, and each carries a
  // small guard term so it cannot win by putting no light on the target at all.
  const BUDGETS=[50,100,200,350,500,1000,2000],FILLS=[.15,.3,.5,.75,1],EMITTERS=[.25,.5,1];
  const OBJECTIVES={
    fill:{label:'Fill the intent',hint:'Lights every painted cell. Tie-broken by captured flux.',score:t=>t.intentFilled+.05*t.intercepted},
    contain:{label:'Contain the beam',hint:'Keeps flux inside the paint. The glare-control objective.',score:t=>t.intentOnTarget+.05*t.intentFilled},
    even:{label:'Even interior',hint:'Evens the painted region only, not the whole plane.',score:t=>t.intentUniformity+.05*t.intentFilled}
  };
  function search(state,objective,options,report) {
    const opts=options||{},score=(OBJECTIVES[objective]||OBJECTIVES.fill).score;
    const rays=opts.rays||20000,maxBudget=opts.maxBudget||500;
    const budgets=BUDGETS.filter(b=>b<=maxBudget),cache=new Map();
    const total=1+budgets.length+FILLS.length+EMITTERS.length;let evals=0;
    function at(budget,fill,de) {
      const key=budget+'|'+fill+'|'+de;
      if(cache.has(key))return cache.get(key);
      const t=O.State.clone(state);
      t.design={...t.design,budget,fill,designEmitter:de};
      O.Design.generate(t);
      const stats=new O.Simulation({...t,simulation:{...t.simulation,rays}},{paths:0}).finish().stats();
      const row={budget,fill,de,score:score(stats),stats,facets:t.surfaces.length};
      cache.set(key,row);evals++;
      if(report)report({evals,total,current:row});
      return row;
    }
    // Start from where the user already is, so a search can only improve on it.
    let best=at(Math.min(state.design.budget,maxBudget),state.design.fill??1,state.design.designEmitter??1);
    for(const b of budgets){const r=at(b,best.fill,best.de);if(r.score>best.score)best=r;}
    for(const f of FILLS){const r=at(best.budget,f,best.de);if(r.score>best.score)best=r;}
    for(const d of EMITTERS){const r=at(best.budget,best.fill,d);if(r.score>best.score)best=r;}
    return {best,evals,objective,rays};
  }
  O.Tune={search,OBJECTIVES,BUDGETS,FILLS,EMITTERS};
})(Optics);
