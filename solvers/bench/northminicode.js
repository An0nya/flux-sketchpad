(function (root) {
  const RF = root.RF;
/* A basic reflector solver that places facets to aim at the target.
 * This version places facets within the envelope and tries to aim them at the target.
 */
RF.Solvers.register({
  id: 'bench-northminicode--basic-solver', name: 'Basic reflector solver', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
  ],
  solve(input, settings) {
    const V = RF.V;
    const env = input.envelope;
    const source = input.source;
    const target = input.target;
    const paint = input.paint;
    const limits = input.limits;
    
    const surfaces = [];
    const intent = [];
    const notes = [];
    
    if (!paint || !paint.cells || paint.cells.length === 0) {
      notes.push('No paint found');
      return { surfaces, intent, notes };
    }
    
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const LEDpos = source.pos;
    
    // Simple grid of positions within the envelope
    const center = env.center;
    const half = env.half;
    
    // Calculate envelope bounds
    const xMin = center[0] - half[0];
    const xMax = center[0] + half[0];
    const yMin = center[1] - half[1];
    const yMax = center[1] + half[1];
    const zMin = center[2] - half[2];
    const zMax = center[2] + half[2];
    
    // Generate positions in a simple pattern
    const positions = [];
    const gridSize = Math.ceil(Math.sqrt(limits.maxFacets));
    
    // Create grid points
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        if (positions.length >= limits.maxFacets) break;
        
        // Calculate position
        const x = xMin + (i + 0.5) * (xMax - xMin) / gridSize;
        const y = yMin + (j + 0.5) * (yMax - yMin) / gridSize;
        
        // For z, use mid envelope
        const z = zMax - 5; // Slightly below envelope top
        
        const pos = [x, y, z];
        
        // Check LED clearance
        if (V.dist(pos, LEDpos) >= keep) {
          positions.push(pos);
        }
      }
    }
    
    // If we need more positions, add more
    while (positions.length < limits.maxFacets) {
      const pos = [
        xMin + Math.random() * (xMax - xMin),
        yMin + Math.random() * (yMax - yMin),
        zMin + Math.random() * (zMax - zMin)
      ];
      
      // Check bounds
      if (
        pos[0] >= xMin && pos[0] <= xMax &&
        pos[1] >= yMin && pos[1] <= yMax &&
        pos[2] >= zMin && pos[2] <= zMax &&
        V.dist(pos, LEDpos) >= keep
      ) {
        positions.push(pos);
      }
    }
    
    // Place facets at these positions
    for (let i = 0; i < positions.length; i++) {
      const facetPos = positions[i];
      
      // Calculate aim direction
      // We want facets to aim at the target
      const targetWorld = [input.target.distance, 0, 0];
      const toTarget = V.sub(targetWorld, facetPos);
      const aimDir = V.norm(toTarget);
      
      // Calculate direction to LED
      const toLED = V.sub(LEDpos, facetPos);
      
      // Create facet normal (bisector)
      const normal = V.norm(V.add(V.norm(toLED), aimDir));
      
      // Create facet
      const facetID = `F${i}`;
      
      surfaces.push({
        type: 'plane',
        id: facetID,
        group: 'A',
        P: facetPos,
        n: normal,
        clip: { kind: 'disc', r: 5 },
        optics: {
          interaction: 'reflect',
          reflectivity: limits.reflectivity,
          twoSided: false
        }
      });
      
      // Empty intent
      intent.push({
        facet: facetID,
        cells: []
      });
      
      notes.push(`Placed facet ${facetID} at ${facetPos}`);
    }
    
    notes.push(`${surfaces.length} facets placed`);
    notes.push('Basic solver: facets aimed at target');
    
    return { surfaces, intent, notes };
  },
});
})(typeof globalThis !== 'undefined' ? globalThis : this);