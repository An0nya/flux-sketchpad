/* paint-rings: a STATIC reflector solver.
 *
 * For every painted cell, place ONE flat facet that images the LED onto that cell.  The facet
 * sits at the envelope boundary along the LED→cell direction.  The disc radius is set to
 * ~`imageCells` paint cells wide at the target, so the LED image is sharp enough to reproduce
 * the paint without smearing.
 *
 * The solver is static: no ray tracing, no iteration.  See solvers/NOTES.md.
 *
 * v0.5: one facet per cell, near-side placement (hiW - rad*0.5), flat facets.
 * Default scene: 60/100 placed, 0 outside, 0 clearance, fidelity 0.6%, on paint 0.0%.
 * Test scene: 100/100 placed, 0 outside, 0 clearance, fidelity 0.0%, on paint 0.0%.
 */
RF.Solvers.register({
  id: 'bench-agnes30flash--paint-rings', name: 'Paint rings (static image solver)', version: '0.5', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'imageCells', label: 'LED image width (paint cells)', type: 'number', min: 0.8, max: 8, step: 0.1, default: 2.2 },
  ],
  solve(input, settings) {
    const V = RF.V, src = input.source, env = input.envelope, tgt = input.target, paint = input.paint, R = paint.res;
    const notes = [];
    let paintSum = 0, painted = 0;
    for (let k = 0; k < R * R; k++) if (paint.cells[k] > 0) { paintSum += paint.cells[k]; painted++; }
    if (!painted) { notes.push('no painted cells: empty design'); return { surfaces: [], intent: [], notes }; }

    const T = RF.Engine.targetFrame(tgt);
    const L = tgt.distance, C = T.C, cell = 2 * T.half / R;
    const fr = RF.Source.frame(src);
    const S0 = src.pos;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0) + 0.25;
    const imgCells = settings.imageCells || 2.2;
    // paint cells in descending order of weight (brightest first)
    const order = [];
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const idx = j * R + i;
        if (paint.cells[idx] > 0) order.push([idx, paint.cells[idx]]);
      }
    }
    order.sort((a, b) => b[1] - a[1]);
    // LED minimum image size (mm at the target plane when facet is at distance r): L * s0 * ct / r
    let s0 = 0;
    if (src.kind === 'planar') s0 = src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h);
    else if (src.shape === 'cylinder') s0 = Math.min(2 * src.radius, src.length);
    else s0 = 2 * src.radius;

    const nPlace = Math.min(order.length, input.limits.maxFacets);
    const surfaces = [], intent = [];
    let placed = 0, skipped = 0;

    for (let n = 0; n < nPlace; n++) {
      const [k, wgt] = order[n];
      const i = k % R, j = (k / R) | 0;
      // cell centre in target coords (u right, v up)
      const cu = -T.half + (i + 0.5) * cell;
      const cv = -T.half + (j + 0.5) * cell;
      // aim point on the target plane (the cell centre)
      const aim = V.add(C, V.add(V.mul(T.tu, cu), V.mul(T.tv, cv)));
      // direction from LED to aim point (through the facet)
      const dir = V.norm(V.sub(aim, S0));
      // radial extent of the envelope along dir from the LED
      const ivv = RF.Geo.envInterval(env, S0, dir);
      const tinW = ivv[0] > -1e6 ? Math.max(keep, ivv[0]) : keep;
      const hiW = ivv[1] < 1e6 ? ivv[1] : tinW + 1e6;
      if (hiW <= tinW) { skipped++; continue; }   // no room in this direction
      // foreshortening: cos of the angle between dir and the LED axis
      const ct = Math.max(0.1, dir[0] * fr.a[0] + dir[1] * fr.a[1] + dir[2] * fr.a[2]);
      // facet disc radius: the LED image's cell size at this r (0.95× so the outline stays inside the envelope)
      let rad = 0.95 * imgCells * cell * hiW / (L * s0 * ct);
      // place the disc centre at the envelope boundary in this direction, inset by the disc
      // radius so the outline stays inside the envelope (a point on the boundary with a radius
      // extends outside; insetting by rad keeps the outline inside for a convex envelope)
      const rP = hiW - rad * 0.5;
      if (rP < tinW) { skipped++; continue; }   // the disc is too big to fit in this direction
      // the facet's normal bisects the LED→P and P→aim angles.  For a flat facet, this means the
      // reflected ray from the LED centre goes exactly to aim (the cell centre), so the image is
      // sharp.  The disc radius is the image's actual size at this r, set to ~imgCells paint cells.
      // validity: the disc's axis-aligned extremes must stay inside the envelope AND outside the LED clearance
      const Pp = [S0[0] + dir[0] * rP, S0[1] + dir[1] * rP, S0[2] + dir[2] * rP];
      const ok = [0, 1, 2].every((ax) => {
        const q1 = Pp.slice(), q2 = Pp.slice();
        q1[ax] += rad; q2[ax] -= rad;
        return RF.Geo.envInside(env, q1, 0) && RF.Geo.envInside(env, q2, 0) &&
          V.dist(q1, S0) >= keep && V.dist(q2, S0) >= keep;
      });
      // if the disc is too big to fit at rP, shrink it to the maximum that does fit
      let radUsed = rad;
      if (!ok) {
        radUsed = 0;
        for (let f = 0.9; f >= 0.05; f -= 0.05) {
          const rr = rad * f;
          const okf = [0, 1, 2].every((ax) => {
            const q1 = Pp.slice(), q2 = Pp.slice();
            q1[ax] += rr; q2[ax] -= rr;
            return RF.Geo.envInside(env, q1, 0) && RF.Geo.envInside(env, q2, 0) &&
              V.dist(q1, S0) >= keep && V.dist(q2, S0) >= keep;
          });
          if (okf) { radUsed = rr; break; }
        }
        if (radUsed < 0.05) { skipped++; continue; }   // even a tiny disc doesn't fit; skip this cell
      }
      const id = 'F' + n;
      surfaces.push({
        type: 'facet', id, P: Pp, S0: S0.slice(), Z: aim, flat: true, di: null,
        clip: { kind: 'disc', r: Math.max(0.05, radUsed) },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false },
      });
      intent.push({ facet: id, cells: [[k, wgt]] });
      placed++;
    }
    notes.push(placed + ' flat facets placed' + (skipped ? ', ' + skipped + ' cells skipped (no room)' : '') +
      ', image ' + imgCells + ' paint cells wide');
    return { surfaces, intent, notes };
  },
});
