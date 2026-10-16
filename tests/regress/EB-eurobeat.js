// Eurobeat page test. Serve the worktree first: python3 tests/serve.py <port>; then node tests/regress/EB-eurobeat.js <port>
// PLAYWRIGHT overrides the Playwright module path. Positive control: the onset detector also runs on a 120 BPM render.
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8801);
let fails = 0;
const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); if (!cond) fails++; };

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // Count AudioContext constructions (OfflineAudioContext is a different constructor and is not counted).
    await page.addInitScript(() => {
      localStorage.clear(); window.__acCount = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { const W = function (...a) { window.__acCount++; return new AC(...a); }; W.prototype = AC.prototype; window.AudioContext = W; }
    });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.evaluate(s => RF.UI.loadScene(RF.State.deserialize(s), 'EB fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.waitForFunction(() => { const u = RF.UI; return u.spec && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => { RF.UI.setDisplay('drive'); RF.UI.setPane('result', 'activate'); Object.assign(RF.UI.dvOpts, { scene: 'road', tiles: false, mountainPass: true, trafficLogic: false, oncoming: false, preceding: false, mt: false, seed: 7, speed: 50 }); RF.UI.redrawSpec(); });

    // Game mode on the Mountain pass scene.
    await page.click('[data-game=toggle]');
    await page.waitForSelector('[data-game=music]', { state: 'attached', timeout: 15000 });
    const pre = await page.evaluate(() => ({
      count: window.__acCount, checked: document.querySelector('[data-game=music]').checked,
      visible: !document.querySelector('[data-game=music]').closest('label').hidden && document.querySelector('[data-game=music]').getClientRects().length > 0,
      playing: RF.Eurobeat.playing(), stored: localStorage.getItem('flux.eurobeat') }));
    ok('EB no AudioContext exists before the toggle is clicked', pre.count === 0, pre);
    ok('EB toggle default OFF, shown in Mountain pass game mode', pre.checked === false && pre.visible && pre.playing === false, pre);

    // Pure audio checks: render through the real scheduler code path, offline.
    const audio = await page.evaluate(() => {
      const detect = (buf) => {
        const d = buf.getChannelData(0), sr = buf.sampleRate, win = Math.max(1, Math.round(0.001 * sr));
        const env = []; let peak = 0, sq = 0;
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); sq += d[i] * d[i]; if (a > peak) peak = a; }
        for (let i = 0; i < d.length; i += win) { let m = 0; const e = Math.min(d.length, i + win); for (let j = i; j < e; j++) { const a = Math.abs(d[j]); if (a > m) m = a; } env.push(m); }
        const mx = Math.max(...env), thr = 0.3 * mx, gap = Math.round(0.2 * sr / win), peaks = []; let last = -1e9;
        for (let i = 0; i < env.length; i++) { const prev = i > 0 ? env[i - 1] : -1, next = i < env.length - 1 ? env[i + 1] : -1; if (env[i] >= thr && env[i] > prev && env[i] >= next && i - last >= gap) { peaks.push(i * win / sr); last = i; } }
        const gaps = peaks.slice(1).map((t, k) => t - peaks[k]);
        return { rms: Math.sqrt(sq / d.length), peak, onsets: peaks.length, gaps };
      };
      const sr = 44100, bars = 4, E = RF.Eurobeat;
      const renderBuf = (bpm, only) => {
        const dur = bars * 4 * 60 / bpm + 0.5, off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
        E.render(off, off.destination, 0, bars, { bpm, only });
        return off.startRendering();
      };
      return (async () => {
        const full = await renderBuf(155, null), kick155 = await renderBuf(155, 'kick'), kick120 = await renderBuf(120, 'kick');
        return { full: detect(full), mix: { peak: Math.max(...[0, 1].map(c => { const d = full.getChannelData(c); let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; })) }, kick155: detect(kick155), kick120: detect(kick120), expect155: 60 / 155, expect120: 0.5 };
      })();
    });
    // The full mix RMS comes from detect(); the kick stem is the detector input for tempo.
    const within = (gaps, want, tol) => gaps.length > 0 && gaps.every((g) => Math.abs(g - want) <= tol);
    ok('EB full mix RMS > 0.01 over 4 bars', audio.full.rms > 0.01, { rms: audio.full.rms });
    ok('EB full mix peak <= 1.0 (no clipping)', audio.mix.peak <= 1.0, { peak: audio.mix.peak });
    ok('EB kick stem: 16 onsets at 155 BPM, spacing 60/155 s +-5 ms', audio.kick155.onsets === 16 && within(audio.kick155.gaps, audio.expect155, 0.005), { onsets: audio.kick155.onsets, gaps: audio.kick155.gaps.map(g => +g.toFixed(4)) });
    ok('EB positive control: detector on 120 BPM render reports 0.5 s spacing', audio.kick120.onsets === 16 && within(audio.kick120.gaps, audio.expect120, 0.005), { onsets: audio.kick120.onsets, gaps: audio.kick120.gaps.map(g => +g.toFixed(4)) });

    // Live playback follows the run: start with the box ticked, pause, resume, then exit.
    await page.click('[data-game=music]');
    const afterTick = await page.evaluate(() => ({ count: window.__acCount, playing: RF.Eurobeat.playing(), stored: localStorage.getItem('flux.eurobeat') }));
    ok('EB ticking the box creates one AudioContext (a user gesture), music still idle until a run', afterTick.count === 1 && afterTick.playing === false && afterTick.stored === '1', afterTick);
    await page.fill('[data-game=speed]', '50'); await page.uncheck('[data-game=reseed]'); await page.fill('[data-game=seed]', '7'); await page.selectOption('[data-game=wet]', 'dry');
    await page.click('[data-game=start]');
    await page.waitForFunction(() => RF.UI.dvAnim.game && RF.UI.dvAnim.playing, null, { timeout: 60000 }).catch(() => {});
    const running = await page.evaluate(() => ({ playing: RF.Eurobeat.playing(), gameLive: !!RF.UI.dvAnim.game && !RF.UI.dvAnim.game.done, animPlaying: RF.UI.dvAnim.playing }));
    ok('EB run in progress => music playing', running.playing === true, running);
    await page.click('[data-game=pause]');
    const paused = await page.evaluate(() => RF.Eurobeat.playing());
    ok('EB pause stops the music', paused === false, { paused });
    await page.click('[data-game=pause]');
    const resumed = await page.evaluate(() => RF.Eurobeat.playing());
    ok('EB resume restarts the music', resumed === true, { resumed });
    await page.click('[data-game=music]');
    const unticked = await page.evaluate(() => RF.Eurobeat.playing());
    ok('EB unticking the box stops the music mid-run', unticked === false, { unticked });
    await page.click('[data-game=music]');
    await page.click('[data-game=toggle]');
    const exited = await page.evaluate(() => ({ playing: RF.Eurobeat.playing(), gameMode: RF.UI.dvAnim.gameMode }));
    ok('EB after exiting the game, RF.Eurobeat.playing() is false', exited.playing === false && exited.gameMode === false, exited);
    ok('EB page errors none', errors.length === 0, errors);
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all EB page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
