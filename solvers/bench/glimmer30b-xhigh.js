RF.Solvers.register({
  id: 'bench-glimmer30b-xhigh--my-solver',
  name: 'My static reflector solver',
  version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetRadius', label: 'Facet radius (mm)', type: 'number', min: 0.5, max: 10, step: 0.5, default: 4 },
    { key: 'planeDepth', label: 'Plane depth from LED (mm)', type: 'number', min: 1, max: 100, step: 1, default: 15 },
  ],
  solve(input, settings, tools) {
    const V = RF.V;
    const limitsMax = input.limits.maxFacets || 100;
    const reflectivity = input.limits.reflectivity || 0.9;
    const sourcePos = input.source.pos.slice();
    const envelope = input.envelope;
    const target = input.target;
    const paintCells = input.paint.cells;
    const res = input.paint.res || target.res;
    const keep = Math.max(envelope.keepOut || 0, settings.minDistance || 0);
    const T = RF.Engine.targetFrame(target);
    const step = (2 * T.half) / res;

    // target center for axis
    const targetCenter = RF.Engine.targetUVtoWorld(T, 0, 0);
    const axis = V.norm(V.sub(targetCenter, sourcePos));
    // choose plane distance along axis
    let planeDist = settings.planeDepth;
    if (planeDist < keep + 1) planeDist = keep + 5;
    // ensure plane inside envelope by checking a central point
    let planePoint = V.add(sourcePos, V.mul(axis, planeDist));
    // if outside, reduce distance
    let tries = 0;
    while (!RF.Geo.envInside(envelope, planePoint, 1e-6) && tries < 20) {
      planeDist *= 0.9;
      if (planeDist < keep + 1) { planeDist = keep + 1; break; }
      planePoint = V.add(sourcePos, V.mul(axis, planeDist));
      tries++;
    }

    // Build local orthonormal basis for plane
    // Choose a reference up direction not parallel to axis
    let ref = Math.abs(axis[2]) < 0.9 ? [0,0,1] : [1,0,0];
    let e1 = V.norm(V.sub(ref, V.mul(axis, V.dot(ref, axis))));
    let e2 = V.norm(V.cross(axis, e1));

    // Envelope bounds in axis-aligned coordinates -> we will sample within envelope
    // Approximate bounding box for plane sampling: find min/max projections of envelope corners onto e1/e2
    const c = envelope.center;
    const h = envelope.half;
    // generate 8 corners
    const corners = [];
    for (let dx of [-1,1]) for (let dy of [-1,1]) for (let dz of [-1,1]) {
      corners.push([c[0]+dx*h[0], c[1]+dy*h[1], c[2]+dz*h[2]]);
    }
    let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
    for (const p of corners) {
      const rel = V.sub(p, planePoint);
      const p1 = V.dot(rel, e1);
      const p2 = V.dot(rel, e2);
      if (p1 < min1) min1 = p1;
      if (p1 > max1) max1 = p1;
      if (p2 < min2) min2 = p2;
      if (p2 > max2) max2 = p2;
    }
    // if plane doesn't intersect envelope, fallback to center
    if (!isFinite(min1)) {
      min1 = -10; max1 = 10; min2 = -10; max2 = 10;
    }

    // collect painted cells
    const cells = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const idx = j * res + i;
        const w = paintCells[idx] || 0;
        if (w > 0) {
          const u = -T.half + (i + 0.5) * step;
          const v = -T.half + (j + 0.5) * step;
          const world = RF.Engine.targetUVtoWorld(T, u, v);
          cells.push({ idx, w, world });
        }
      }
    }
    cells.sort((a,b)=> b.w - a.w || a.idx - b.idx);

    const maxFacets = Math.min(limitsMax, cells.length);
    const surfaces = [];
    const intent = [];
    const notes = [];
    const clipRadius = Math.max(0.5, Math.min(settings.facetRadius, 6));

    // sample grid
    const n = Math.ceil(Math.sqrt(maxFacets));
    const margin = clipRadius * 0.7;
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    // ensure range positive
    const step1 = range1 / Math.max(1, n);
    const step2 = range2 / Math.max(1, n);

    let placed = 0;
    for (let i = 0; i < n && placed < maxFacets; i++) {
      for (let j = 0; j < n && placed < maxFacets; j++) {
        // sample inside with margin
        const p1 = min1 + margin + (i + 0.5) * step1;
        const p2 = min2 + margin + (j + 0.5) * step2;
        if (p1 > max1 - margin || p2 > max2 - margin) continue;
        const offset = V.add(V.mul(e1, p1), V.mul(e2, p2));
        const P = V.add(planePoint, offset);
        if (!RF.Geo.envInside(envelope, P, 1e-6)) continue;
        if (V.len(V.sub(P, sourcePos)) < keep - 1e-6) continue;
        // find a painted cell to aim at
        // pick next unused cell by weight
        while (placed < maxFacets && cells.length) {
          const cell = cells[0];
          cells.shift();
          // create facet aiming at cell
          const id = 'f' + placed;
          const di = V.len(V.sub(cell.world, P));
          surfaces.push({
            type: 'facet',
            id,
            P: P.slice(),
            S0: sourcePos.slice(),
            Z: cell.world.slice(),
            di,
            clip: { kind: 'disc', r: clipRadius },
            optics: { interaction: 'reflect', reflectivity }
          });
          intent.push({ facet: id, cells: [[cell.idx, cell.w]] });
          placed++;
          break;
        }
      }
    }

    // if we didn't place enough, try remaining cells with same points
    // fallback: just use remaining points
    notes.push(`placed ${placed} facets, planeDist ${planeDist.toFixed(1)} mm, radius ${clipRadius} mm`);
    return { surfaces, intent, notes };
  }
});

// Auto-tuned variant
RF.Solvers.register({
  id: 'bench-glimmer30b-xhigh--my-solver-auto',
  name: 'My static reflector solver auto-tuned',
  version: '0.1',
  modes: ['paint'],
  settings: [],
  solve(input, settings, tools) {
    const V = RF.V;
    const limitsMax = input.limits.maxFacets || 100;
    const reflectivity = input.limits.reflectivity || 0.9;
    const sourcePos = input.source.pos.slice();
    const envelope = input.envelope;
    const target = input.target;
    const paintCells = input.paint.cells;
    const res = input.paint.res || target.res;
    const keep = envelope.keepOut || 0;
    const T = RF.Engine.targetFrame(target);
    const step = (2 * T.half) / res;

    // Auto heuristics
    const h = envelope.half;
    const hMin = Math.min(h[0], h[1], h[2]);
    const facetRadius = Math.max(1.0, Math.min(6.0, hMin / 8));
    let planeDepth = Math.max(keep + 5, Math.min(25, hMin * 0.35));
    // target distance heuristic
    const targetCenter = RF.Engine.targetUVtoWorld(T, 0, 0);
    const tgtDist = V.len(V.sub(targetCenter, sourcePos));
    if (tgtDist > 1500) planeDepth = Math.min(planeDepth * 1.2, 30);

    const axis = V.norm(V.sub(targetCenter, sourcePos));
    let planePoint = V.add(sourcePos, V.mul(axis, planeDepth));
    let tries = 0;
    while (!RF.Geo.envInside(envelope, planePoint, 1e-6) && tries < 20) {
      planeDepth *= 0.9;
      if (planeDepth < keep + 1) { planeDepth = keep + 1; break; }
      planePoint = V.add(sourcePos, V.mul(axis, planeDepth));
      tries++;
    }

    let ref = Math.abs(axis[2]) < 0.9 ? [0,0,1] : [1,0,0];
    let e1 = V.norm(V.sub(ref, V.mul(axis, V.dot(ref, axis))));
    let e2 = V.norm(V.cross(axis, e1));

    const c = envelope.center;
    const corners = [];
    for (let dx of [-1,1]) for (let dy of [-1,1]) for (let dz of [-1,1]) {
      corners.push([c[0]+dx*h[0], c[1]+dy*h[1], c[2]+dz*h[2]]);
    }
    let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
    for (const p of corners) {
      const rel = V.sub(p, planePoint);
      const p1 = V.dot(rel, e1);
      const p2 = V.dot(rel, e2);
      if (p1 < min1) min1 = p1;
      if (p1 > max1) max1 = p1;
      if (p2 < min2) min2 = p2;
      if (p2 > max2) max2 = p2;
    }
    if (!isFinite(min1)) { min1 = -10; max1 = 10; min2 = -10; max2 = 10; }

    const cells = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const idx = j * res + i;
        const w = paintCells[idx] || 0;
        if (w > 0) {
          const u = -T.half + (i + 0.5) * step;
          const v = -T.half + (j + 0.5) * step;
          const world = RF.Engine.targetUVtoWorld(T, u, v);
          cells.push({ idx, w, world });
        }
      }
    }
    cells.sort((a,b)=> b.w - a.w || a.idx - b.idx);

    const maxFacets = Math.min(limitsMax, cells.length);
    const surfaces = [];
    const intent = [];
    const notes = [];
    const clipRadius = Math.max(0.5, Math.min(facetRadius, 6));
    const n = Math.ceil(Math.sqrt(maxFacets));
    const margin = clipRadius * 0.7;
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const step1 = range1 / Math.max(1, n);
    const step2 = range2 / Math.max(1, n);

    let placed = 0;
    for (let i = 0; i < n && placed < maxFacets; i++) {
      for (let j = 0; j < n && placed < maxFacets; j++) {
        const p1 = min1 + margin + (i + 0.5) * step1;
        const p2 = min2 + margin + (j + 0.5) * step2;
        if (p1 > max1 - margin || p2 > max2 - margin) continue;
        const offset = V.add(V.mul(e1, p1), V.mul(e2, p2));
        const P = V.add(planePoint, offset);
        if (!RF.Geo.envInside(envelope, P, 1e-6)) continue;
        if (V.len(V.sub(P, sourcePos)) < keep - 1e-6) continue;
        const cell = cells.shift();
        if (!cell) break;
        const id = 'f' + placed;
        const di = V.len(V.sub(cell.world, P));
        surfaces.push({
          type: 'facet',
          id,
          P: P.slice(),
          S0: sourcePos.slice(),
          Z: cell.world.slice(),
          di,
          clip: { kind: 'disc', r: clipRadius },
          optics: { interaction: 'reflect', reflectivity }
        });
        intent.push({ facet: id, cells: [[cell.idx, cell.w]] });
        placed++;
      }
    }
    notes.push(`auto placed ${placed} facets, planeDist ${planeDepth.toFixed(1)} mm, radius ${clipRadius.toFixed(2)} mm`);
    return { surfaces, intent, notes };
  }
});
