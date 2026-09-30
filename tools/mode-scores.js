// Thin re-export: the mode metrics now live in js/modes.js (RF.Modes) so the solver worker, the bench and these tools share ONE copy.
// The two extras below are analysis-only (phase 1) and stay here.
'use strict';
const M = require('../tests/load.js').load().Modes;
const sum = (a) => { let s = 0; for (const x of a) s += x; return s; };
// "useful light" (phase 1, max-light mode; that goal was dropped): light on a painted cell counts only up to 1.25 × a perfect spread's
function usefulLight(run) {
  const P = run.paint, D = run.D, row = run.row, psum = sum(P), cap = row.capturable * row.reflectivity;
  let u = 0; for (let k = 0; k < P.length; k++) if (P[k] > 0) u += Math.min(D[k], 1.25 * cap * P[k] / psum);
  return { useful: u, usefulOfIdeal: cap > 0 ? u / cap : NaN, onPaint: row.onPaint, meanOfIdeal: null };
}
// sliced W1 as a share of the flood's distance
function slicedW1Norm(run) { const R = run.R, f = M.slicedW1({ R, paint: run.paint, D: new Array(R * R).fill(1) }); return f > 0 ? M.slicedW1(run) / f : NaN; }
module.exports = Object.assign({}, M, { usefulLight, slicedW1Norm, GATES: Object.assign({}, M.GATES, { uniformity: M.GATES.wash, light: { fid: 0.7 } }) });
