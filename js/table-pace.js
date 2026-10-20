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
