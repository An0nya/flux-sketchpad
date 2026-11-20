RF.Solvers.register({
  id: 'bench-gemma431b--simple-paint',
  name: 'Simple Paint Solver',
  version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
  ],
  solve(input, settings) {
    const V = RF.V;
    const { source, envelope, target, paint, limits } = input;
    const keep = Math.max(envelope.keepOut || 0, settings.minDistance || 0);
    
    const surfaces = [];
    const intent = [];
    const notes = [];
    
    // 1. Identify painted cells
    const paintedCells = [];
    for (let i = 0; i < paint.cells.length; i++) {
      if (paint.cells[i] > 0) {
        paintedCells.push({ index: i, weight: paint.cells[i] });
      }
    }
    
    // Sort by weight descending to prioritize brightest areas
    paintedCells.sort((a, b) => b.weight - a.weight);
    
    // 2. Cluster painted cells into groups to better utilize maxFacets
    const maxFacets = limits.maxFacets;
    const res = paint.res;
    const targetFrame = RF.Engine.targetFrame(target);
    
    const clusters = [];
    const visited = new Set();
    
    // Cluster by proximity
    for (let i = 0; i < paintedCells.length; i++) {
      const cellA = paintedCells[i];
      if (visited.has(cellA.index)) continue;
      
      const cluster = [cellA];
      visited.add(cellA.index);
      
      const rowA = Math.floor(cellA.index / res);
      const colA = cellA.index % res;
      
      // Use a slightly larger radius for clustering to group more cells
      for (let j = i + 1; j < paintedCells.length; j++) {
        const cellB = paintedCells[j];
        if (visited.has(cellB.index)) continue;
        
        const rowB = Math.floor(cellB.index / res);
        const colB = cellB.index % res;
        
        if (Math.abs(rowA - rowB) <= 2 && Math.abs(colA - colB) <= 2) {
          cluster.push(cellB);
          visited.add(cellB.index);
        }
      }
      clusters.push(cluster);
    }
    
    // Sort clusters by total weight descending
    clusters.sort((a, b) => {
      const sumA = a.reduce((s, c) => s + c.weight, 0);
      const sumB = b.reduce((s, c) => s + c.weight, 0);
      return sumB - sumA;
    });
    
    for (let i = 0; i < Math.min(clusters.length, maxFacets); i++) {
      const cluster = clusters[i];
      
      let avgTargetPos = [0, 0, 0];
      let totalWeight = 0;
      const clusterCells = [];
      
      for (const cell of cluster) {
        const row = Math.floor(cell.index / res);
        const col = cell.index % res;
        const pos = RF.Engine.cellCenter(targetFrame, col, row, res);
        avgTargetPos = V.add(avgTargetPos, V.mul(pos, cell.weight));
        totalWeight += cell.weight;
        clusterCells.push(cell);
      }
      avgTargetPos = V.mul(avgTargetPos, 1 / totalWeight);
      
      const S0 = source.pos;
      const dir = V.norm(V.sub(avgTargetPos, S0));
      const interval = RF.Geo.envInterval(envelope, S0, dir);
      if (!interval) continue;
      
      // Place the facet center inside the envelope
      let t = interval[1] * 0.98; 
      if (t < keep) {
        t = keep + 0.1;
        if (!RF.Geo.envInside(envelope, V.add(S0, V.mul(dir, t)))) continue;
      }
      const P = V.add(S0, V.mul(dir, t));
      const Z = avgTargetPos;
      const id = 'f' + surfaces.length;
      
      const distS = V.dist(P, S0);
      const distZ = V.dist(P, Z);
      
      // Radius calculation:
      const cellWidth = target.size[0] / res;
      const scale = distZ / distS;
      
      // To avoid "too dim", the facet must be large enough to capture sufficient LED light.
      const ledImageR = (Math.max(source.w, source.h) / 2) * scale;
      const coverageR = (cellWidth * Math.sqrt(cluster.length)) / 2;
      
      // Use a much larger radius to capture more light, since we are currently "too dim".
      // Maxing out the facet size often helps fidelity when delivered light is near 0.
      const r = Math.max(ledImageR * 5, coverageR / scale, 20); 
      
      surfaces.push({
        type: 'facet',
        id,
        P,
        S0,
        Z,
        flat: false, 
        di: distZ,       
        clip: { kind: 'disc', r: r }, 
        optics: {
          interaction: 'reflect',
          reflectivity: limits.reflectivity
        }
      });
      
      intent.push({
        facet: id,
        cells: clusterCells.map(c => [c.index, 1.0])
      });
    }
    
    notes.push(`Placed ${surfaces.length} facets for ${paintedCells.length} painted cells.`);
    
    return { surfaces, intent, notes };
  },
});
