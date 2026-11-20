/* Flux reflector solver - creates faceted mirrors to reproduce a painted target pattern.
 * 
 * Algorithm based on area-based facet placement:
 * 1. Sample potential facet positions inside the envelope
 * 2. For each position, calculate the correct normal for reflecting LED->target
 * 3. Sort by estimated flux and greedily place facets up to the budget
 * 4. Each facet is an ellipsoid that images the LED onto its aim point on the target
 *
 * Key insight from starter solver:
 * - Facets need a clip to define their boundary
 */
RF.Solvers.register({
  id: 'bench-laguna-xs21--reflector', name: 'Reflector solver', version: '4.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetSize', label: 'Facet diameter (mm)', type: 'range', min: 3, max: 20, step: 1, default: 8 },
    { key: 'aimBias', label: 'Aim bias toward painted area', type: 'checkbox', default: true },
    { key: 'di', label: 'Image distance (mm)', type: 'range', min: 50, max: 1000, step: 10, default: 500 },
  ],
  solve(input, settings, tools) {
    const V = RF.V, Geo = RF.Geo;
    
    const maxFacets = input.limits.maxFacets;
    const reflectivity = input.limits.reflectivity;
    const keepOut = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);
    const facetSize = settings.facetSize || 8;
    const aimBias = settings.aimBias !== false;
    const di = settings.di || 500;
    
    const srcPos = input.source.pos;
    const target = input.target;
    const targetRes = target.res;
    
    const surfaces = [];
    const intent = [];
    const notes = [];
    
    // Get target frame for coordinate conversion
    const Tf = RF.Engine.targetFrame(target);
    const targetCenter = Tf.C;
    
    const env = input.envelope;
    const c = env.center, h = env.half;
    const r = facetSize / 2;
    const area = Math.PI * r * r;
    
    // Generate candidate facet positions INSIDE the envelope
    const candidates = [];
    
    const steps = Math.max(4, Math.ceil(120 / facetSize));
    
    // Pre-compute the aim point (center of mass of painted cells, or target center)
    let targetAim = targetCenter;
    if (aimBias) {
      let paintCx = 0, paintCy = 0, paintSum = 0;
      for (let jj = 0; jj < targetRes; jj++) {
        for (let ii = 0; ii < targetRes; ii++) {
          const w = input.paint[jj * targetRes + ii];
          if (w > 0) {
            const u = (ii + 0.5) / targetRes - 0.5;
            const v = (jj + 0.5) / targetRes - 0.5;
            paintCx += w * u;
            paintCy += w * v;
            paintSum += w;
          }
        }
      }
      if (paintSum > 0) {
        paintCx /= paintSum;
        paintCy /= paintSum;
        const scale = target.size / 2;
        targetAim = [targetCenter[0], paintCx * scale * 2, paintCy * scale * 2];
      }
    }
    
    // Sample all 6 faces
    for (let ax = 0; ax < 3; ax++) {
      for (let side = -1; side <= 1; side += 2) {
        const i = (ax + 1) % 3, j = (ax + 2) % 3;
        
        for (let ai = 0; ai <= steps; ai++) {
          for (let aj = 0; aj <= steps; aj++) {
            const fracI = 0.6 * (2 * ai / steps - 1);
            const fracJ = 0.6 * (2 * aj / steps - 1);
            
            const P = c.slice();
            P[ax] = c[ax] + side * h[ax] * 0.7;
            P[i] = c[i] + fracI * h[i];
            P[j] = c[j] + fracJ * h[j];
            
            // Check LED clearance
            const distToLED = V.dist(P, srcPos);
            if (distToLED < keepOut + 1) continue;
            
            // Ensure inside envelope
            const inside = Geo.envInside(env, P, 1e-6);
            if (!inside) continue;
            
            // Direction from LED to P
            const fromLED = V.norm(V.sub(P, srcPos));
            
            // Direction from P to aim point
            const toAim = V.norm(V.sub(targetAim, P));
            
            const Z = V.add(P, V.mul(toAim, di));
            
            // Calculate the angle between fromLED and toAim
            const angle = Math.acos(Math.max(-1, Math.min(1, V.dot(fromLED, toAim))));
            
            candidates.push({
              pos: P,
              Z,
              S0: srcPos,
              angle
            });
          }
        }
      }
    }
    
    // Sort by angle (smaller = better aim)
    candidates.sort((a, b) => a.angle - b.angle);
    
    // Place facets up to budget
    let facetCount = 0;
    
    for (const cand of candidates) {
      if (facetCount >= maxFacets) break;
      
      const P = cand.pos;
      
      const id = 'F' + facetCount;
      
      const facet = {
        type: 'facet',
        id,
        P,
        S0: cand.S0,
        Z: cand.Z,
        di,
        clip: { kind: 'disc', r: r },
        optics: {
          interaction: 'reflect',
          reflectivity
        }
      };
      
      surfaces.push(facet);
      intent.push({ facet: id, cells: [] });
      
      facetCount++;
    }
    
    notes.push(facetCount + ' facets placed');
    
    if (facetCount === 0) {
      notes.push("WARNING: No facets placed");
    }
    
    return { surfaces, intent, notes };
  }
});