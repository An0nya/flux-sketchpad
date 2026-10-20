// SE page checks: table pacing on the GPU drive renderer (banded fill, budget, first version, header strip, near-fade button).
// Run (worktree): python3 tests/serve.py 8991  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SE-table-pacing.js 8991
// Exits 1 on any failure. Timings here are SOFTWARE GL (headless SwiftShader), not the owner's phone.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8991);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
async function meanLuma(page, png) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (Number.isFinite(v)) { s += v; n++; } } return s / n;
  }, png.toString('base64'));
}
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const setOpts = async (o, wait = 1200) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(wait); };
    // n frames; move = drive 0.6 m per frame (the key does not depend on distance, so a drive keeps the same table)
    const steps = (n, move) => page.evaluate(({ k, mv }) => { const st = RF.DriveAnim._.S(RF.UI); const out = []; for (let i = 0; i < k; i++) { if (mv) st.dist += 0.6; RF.DriveAnim._.frame(); const s = globalThis.SD_SCATTER; out.push({ valid: s.valid, rows: s.rowsDone, pending: s.pending, frames: s.frames, shown: s.shown }); } return out; }, { k: n, mv: !!move });
    // frames until valid >= want (or cap); returns the frame count
    const until = (want, cap) => page.evaluate(({ w, c }) => { const st = RF.DriveAnim._.S(RF.UI); let n = 0; while (globalThis.SD_SCATTER.valid < w && n < c) { st.dist += 0.0; RF.DriveAnim._.frame(); n++; } return { n, valid: globalThis.SD_SCATTER.valid }; }, { w: want, c: cap });
    // frames stepped by hand are not presented on an idle view: a redraw plus a wait shows the current table
    const snap = async (label) => { await page.evaluate(() => RF.UI.redrawSpec()); await sleep(1200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sc-drive', '1')); const png = await page.locator('canvas[data-sc-drive="1"]').screenshot(); return { label, hash: crypto.createHash('sha256').update(png).digest('hex'), luma: await meanLuma(page, png) }; };
    const base = { visibility: 200, wet: false, wetness: 0, wetSheen: false, fpsCounter: false, scatterMode: 'table', scatter: 16, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', afs: false, lampPitch: false, corneringLamps: false };
    const SD = () => page.evaluate(() => ({ ...globalThis.SD_SCATTER }));

    // 1. the GPU renderer runs the table path
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, scatterNearFadeRange: 'medium' }));
    await steps(3, true);
    const s1 = await SD();
    ok('SE GPU renderer runs table frames with the new counters', s1.frames > 0 && s1.cache === true && typeof s1.budgetMs === 'number', JSON.stringify({ frames: s1.frames, valid: s1.valid, budgetMs: s1.budgetMs }));

    // 2. banded fill equals the whole-frame fill, texel for texel (same key, same seed 0)
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 1; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, visibility: 199 }), 300);
    const bandRun = await until(1, 4000);
    const bandedSD = await SD();
    const banded = await page.evaluate(() => [0, 1, 2].map((b) => Array.from(globalThis.SD_SCATTER.readVersion(0, b))));
    await setOpts(Object.assign({}, base, { scatterCache: 'off', scatterCycle: 0, visibility: 199 }), 300);
    await steps(2, false);
    const whole = await page.evaluate(() => [0, 1, 2].map((b) => Array.from(globalThis.SD_SCATTER.readVersion(0, b))));
    const same = banded.every((arr, b) => arr.length === whole[b].length && arr.every((v, i) => v === whole[b][i]));
    const diffCount = banded.reduce((n, arr, b) => n + arr.reduce((m, v, i) => m + (v !== whole[b][i] ? 1 : 0), 0), 0);
    ok('SE banded fill equals the whole-frame fill, texel for texel (3 banks)', bandRun.valid === 1 && bandedSD.recomputes >= 1 && same, 'frames to valid ' + bandRun.n + ', differing texels ' + diffCount);

    // 3. budget 0.1 ms: one row per frame, the page keeps stepping, rows advance one per frame
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 0.1; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, visibility: 197 }), 300);
    const slow = await steps(6, false);
    const deltas = slow.slice(1).map((r, i) => r.rows - slow[i].rows);
    ok('SE budget 0.1 ms: each frame advances the fill by one row and the frame counter advances each frame', deltas.every((d) => d === 1) && slow[5].frames - slow[0].frames === 5, 'row deltas ' + deltas.join(',') + ' frames ' + slow[0].frames + '->' + slow[5].frames);
    // 3b. the fill still completes (slow, but it gets there): cap in frames
    const slowDone = await until(1, 1200);
    ok('SE budget 0.1 ms: the version still becomes valid eventually', slowDone.valid === 1, 'frames ' + slowDone.n);

    // 3c. scissor: a partial spare must equal the whole-frame table row for row below the fill row, and be empty at and above it.
    // Reference: a whole (cache off) render of key A, copied out; then key B (cache off); then key A with the cache on at 0.1 ms.
    // The resize (full then half) drops the spare, so the first cached fill starts from empty targets.
    await setOpts(Object.assign({}, base, { scatterCache: 'off', scatterCycle: 0, scatterRes: 'full', visibility: 180 }), 300);
    await setOpts(Object.assign({}, base, { scatterCache: 'off', scatterCycle: 0, scatterRes: 'half', visibility: 180 }), 300);
    await steps(2, false);
    await page.evaluate(() => { globalThis.__seRef = [0, 1, 2].map((b) => globalThis.SD_SCATTER.readVersion(0, b)); });
    await setOpts(Object.assign({}, base, { scatterCache: 'off', scatterCycle: 0, visibility: 170 }), 300);
    await steps(1, false);
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 0.1; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, visibility: 180 }), 300);
    const sc = await page.evaluate(() => {
      const st = globalThis.SD_SCATTER; let below = 0, mismatch = 0, aboveNonzero = 0, rowsDone = 0, rowsTotal = 0;
      for (let b = 0; b < 3; b++) {
        const r = st.readSpare(b); if (!r) return { none: true };
        rowsDone = r.rowsDone; rowsTotal = r.height; const W = r.width * 4, ref = globalThis.__seRef[b];
        for (let y = 0; y < r.height; y++) {
          for (let x = 0; x < W; x++) {
            const v = r.data[y * W + x];
            if (y < r.rowsDone) { below++; if (v !== ref[y * W + x]) mismatch++; } else if (v !== 0) aboveNonzero++;
          }
        }
      }
      return { rowsDone, rowsTotal, texelsBelow: below, mismatchBelow: mismatch, nonzeroAbove: aboveNonzero };
    });
    ok('SE scissor: a partial fill equals the whole-frame table below the fill row and is empty at and above it', !sc.none && sc.rowsDone > 0 && sc.rowsDone < sc.rowsTotal && sc.mismatchBelow === 0 && sc.nonzeroAbove === 0, JSON.stringify(sc));
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 1e6; });
    await until(1, 50);

    // 4. cycle 8: the first valid version appears after ONE version's bands, while seven are still pending
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 2; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 8, visibility: 195 }), 300);
    const firstValid = await until(1, 1500);
    const at1 = await SD();
    ok('SE cycle 8: the first valid version appears with seven still pending, not after eight', firstValid.valid === 1 && at1.wanted === 8 && at1.pending === 7 && at1.shown === 0, 'frames ' + firstValid.n + ' valid ' + at1.valid + ' pending ' + at1.pending);

    // 5. header strip: opens during a slow fill (status text + bar), closes after the fill is done
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 0.1; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, scatterRes: 'full', visibility: 193 }), 300);
    const t0 = Date.now();
    await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 800) RF.DriveAnim._.frame(); });
    const strip = await page.evaluate(() => ({ open: document.getElementById('progress-strip').classList.contains('open'), text: document.getElementById('progress-text').textContent, valid: globalThis.SD_SCATTER.valid, pending: globalThis.SD_SCATTER.pending }));
    ok('SE strip: opens during a slow fill with the building-cache status', strip.open && strip.valid === 0 && /^building air-beam cache 0\/1$/.test(strip.text), JSON.stringify(strip) + ' after ' + (Date.now() - t0) + ' ms');
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 1e6; });
    await until(1, 50);
    await sleep(1400);
    const closed = await page.evaluate(() => ({ open: document.getElementById('progress-strip').classList.contains('open'), text: document.getElementById('progress-text').textContent }));
    ok('SE strip: closes after the fill is complete (0.8 s tuck)', !closed.open, JSON.stringify(closed));

    // 6. near-eye fade: the button (table mode, saved in the view options) toggles and changes the frame
    await setOpts(Object.assign({}, base, { scatterCache: 'off', scatterCycle: 0, scatterNearFadeRange: 'medium' }), 1500);
    const ui = (k) => page.evaluate((key) => { const b = document.querySelector('[data-dv="' + key + '"]'); return b ? { text: b.textContent.trim(), hidden: b.hidden, disabled: b.disabled } : null; }, k);
    const fadeOn = await ui('scatterNearFadeRange');
    ok('SE UI: the near-fade button reads on in table mode', fadeOn && fadeOn.text === 'beam near fade: medium (1-10 m)' && !fadeOn.disabled && !fadeOn.hidden, JSON.stringify(fadeOn));
    const sOn = await snap('fade on');
    await page.evaluate(() => document.querySelector('[data-dv="scatterNearFadeRange"]').click()); await sleep(1500);
    const fadeOff = await ui('scatterNearFadeRange');
    const sOff = await snap('fade off');
    ok('SE UI: clicking the button moves medium to long and the frame changes', fadeOff.text === 'beam near fade: long (2-20 m)' && sOff.hash !== sOn.hash, 'on ' + sOn.luma.toFixed(3) + ' off ' + sOff.luma.toFixed(3));
    await setOpts({ scatterMode: 'direct' }, 1200);
    const dirFade = await ui('scatterNearFadeRange');
    ok('SE UI: the near-fade button is disabled in direct mode', dirFade && dirFade.disabled, JSON.stringify(dirFade));

    // 7. no valid version yet: the scatter term reads the 1x1 zero texture (no stall, no stale table), and the completed version replaces it.
    // The luminance comparison is not used: two screenshots of the same view did not differ in this harness, so the check reads the state (see the report).
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 0.1; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, scatterBlur: 'mid', scatterRes: 'full', scatterNearFadeRange: 'medium' }), 300);
    await steps(3, false);
    const pendingSD = await SD();
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 1e6; });
    const doneRun = await until(1, 50);
    const doneSD = await SD();
    ok('SE no valid version: the scatter term reads zero while pending, and the completed version replaces it', pendingSD.valid === 0 && pendingSD.pending > 0 && pendingSD.showingZero === true && doneRun.valid === 1 && doneSD.showingZero === false, 'pending showingZero ' + pendingSD.showingZero + ' valid ' + pendingSD.valid + '; done showingZero ' + doneSD.showingZero + ' valid ' + doneRun.valid);

    // 7b. key change: the previous valid version stays shown until the new one completes (no blank beam on a key change)
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 1e6; });
    await until(1, 50);
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 0.1; });
    await setOpts(Object.assign({}, base, { scatterCache: 'on', scatterCycle: 0, scatterBlur: 'mid', scatterRes: 'full', scatterNearFadeRange: 'medium', visibility: 190 }), 300);
    await steps(2, false);
    const keyChange = await SD();
    ok('SE key change: the previous valid version stays shown while the new version fills (not zero)', keyChange.showingZero === false && keyChange.valid === 0 && keyChange.pending > 0, JSON.stringify({ showingZero: keyChange.showingZero, valid: keyChange.valid, pending: keyChange.pending }));

    // restore the default options for whatever follows in a shared session
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 8; Object.assign(RF.UI.dvOpts, { scatterMode: 'direct', scatter: 0, scatterCache: 'off', scatterCycle: 0, visibility: null, scatterNearFadeRange: 'medium' }); RF.UI.redrawSpec(); });
    ok('SE nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('SE page run completed', false, String(e && e.stack || e).slice(0, 500)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SE page checks passed'); process.exitCode = fails ? 1 : 0;
})();
