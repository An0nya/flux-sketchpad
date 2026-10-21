// SE air-beam table pacing: pure helpers (no DOM, no GL). js/drive-three.js paces the table fill with them, js/drive-anim.js
// drives the header strip from them, and tests/scatter-table-pace.js checks them in Node. Changing a constant here changes the GPU
// shader too (drive-three-shaders.js reads the fade constants from this file).

// Table work spent per displayed frame while a version is filling (ms). Tunable.
export const TABLE_BUDGET_MS = 8;
// Rows in the first band of a fresh fill, used to measure ms per row before pacing takes over.
export const TABLE_PROBE_ROWS = 8;
// Near-eye fade (table pass only, look.scatterNearFade 'on'): weight 0 at S0, 1 at S1, smoothstep between (owner's estimate: the writhing is the first ~10 m).
export const SCAT_FADE_S0 = 1.0, SCAT_FADE_S1 = 10.0;

// Rows for the next band: as many as fit the budget at the measured cost per row, at least one row, never more than are left.
export function bandRows(budgetMs, msPerRow, rowsLeft) {
  if (!(rowsLeft > 0)) return 0;
  if (!(msPerRow > 0)) return Math.min(rowsLeft, TABLE_PROBE_ROWS);
  return Math.min(rowsLeft, Math.max(1, Math.floor(budgetMs / msPerRow)));
}

// Running estimate of ms per row from one frame's table work (exponential smoothing; a frame with no rows leaves it unchanged).
export function smoothMsPerRow(prev, ms, rows) {
  if (!(rows > 0) || !Number.isFinite(ms)) return prev;
  const sample = ms / rows;
  return prev > 0 ? 0.5 * prev + 0.5 * sample : sample;
}

// Header strip label while versions are pending; null when complete (the strip then closes).
export function tableStatus(valid, wanted) {
  return valid >= wanted ? null : 'building air-beam cache ' + valid + '/' + wanted;
}

// Strip bar fraction: completed versions plus the share of the version in progress, over the versions wanted.
export function fillFraction(valid, wanted, rowsDone, rowsTotal) {
  if (!(wanted > 0)) return 0;
  const part = rowsTotal > 0 ? rowsDone / rowsTotal : 0;
  return Math.min(1, (valid + part) / wanted);
}

// Debug badge text (shown with debugTimings or fpsCounter in table mode).
export function tableBadge(cache, valid, wanted, lastMs) {
  const ms = Number.isFinite(lastMs) ? Math.round(lastMs) + ' ms/table' : 'measuring';
  return cache ? 'air beam cache ' + valid + '/' + wanted + ' · ' + ms : 'air beam table · ' + ms;
}

// GLSL smoothstep, for the CPU twin (js/drive.js) to match the shader.
export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// SF2 near-eye fade range (look.scatterNearFadeRange): the S0..S1 pair in metres. 'off' has no pair (the plain SD table).
// Saved options from before SF2 still work: scatterNearFade 'on' is 'medium', 'off' is 'off'. A range set on the button wins.
export const FADE_RANGES = { off: null, short: [0.5, 3], medium: [SCAT_FADE_S0, SCAT_FADE_S1], long: [2, 20] };
export function fadeRangeName(look) {
  const r = look && look.scatterNearFadeRange;
  if (typeof r === 'string' && Object.prototype.hasOwnProperty.call(FADE_RANGES, r)) return r;
  return look && look.scatterNearFade === 'off' ? 'off' : 'medium';
}
export function fadeRangeOf(look) { return FADE_RANGES[fadeRangeName(look)]; }

// SF2 scatter gain (look.scatterGain): multiplies the table LOOKUP only (never the table), log-scale 0.25 to 4, default 1.
export const SCAT_GAIN = { min: 0.25, max: 4, def: 1 };
export function scatterGainOf(look) {
  const g = Number(look && look.scatterGain);
  return Number.isFinite(g) && g > 0 ? Math.min(SCAT_GAIN.max, Math.max(SCAT_GAIN.min, g)) : SCAT_GAIN.def;
}

// SM cycle by distance: the eight noise versions advance with the distance the car travelled, not with the frame count, so the
// shimmer slows at low speed and stops at a standstill. Metres of travel per version step. Tuned 0.25 -> 0.5: at 20 km/h (5.6 m/s)
// the speed term is 11 versions/s, under the cap, so 20 and 50 km/h differ; at 0.25 both would be capped.
export const CYCLE_METRES_PER_VERSION = 0.5;
// Cap on the speed term, versions per second. Not measured on the owner's phone; the cap is a guess to keep it no faster than the
// per-frame cycle it replaces (the brief estimated 8-20 fps on the phone).
export const CYCLE_MAX_HZ = 12;
// Standstill floor: versions per second of slow drift while the car is still (the fade between versions makes this look like fog).
export const CYCLE_DRIFT_HZ = 1.5;

// The continuous cycle phase in [0, versions). dMetres is the distance travelled this frame (negative or NaN counts as 0), dtSeconds the
// frame time (NaN or negative counts as 0). The speed term is capped at CYCLE_MAX_HZ, so one long jump (a seek) cannot race through.
// o (optional) overrides { metres, maxHz, driftHz } for tests.
export function cyclePhase(prev, dMetres, dtSeconds, versions, o) {
  const metres = (o && o.metres) || CYCLE_METRES_PER_VERSION, maxHz = (o && o.maxHz) || CYCLE_MAX_HZ, driftHz = (o && o.driftHz) || CYCLE_DRIFT_HZ;
  if (!(versions > 0)) return 0;
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
  const d = Number.isFinite(dMetres) && dMetres > 0 ? dMetres : 0;
  const speedStep = Math.min(d / metres, maxHz * dt);
  const base = Number.isFinite(prev) ? prev : 0;
  let next = (base + speedStep + driftHz * dt) % versions;
  if (next < 0) next += versions;
  return next >= versions ? 0 : next;
}
