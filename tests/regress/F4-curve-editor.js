// F4: the Profile editor's curve mode — create, move, extend, bend, split, undo with real pointer events; the point editor behind the toggle; an old scene loads untouched.
// node tests/regress/F4-curve-editor.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8724);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  await idle();
  ok('page is the app under test (RF.UI, port ' + port + ')', await page.evaluate((p) => !!RF.UI && location.port === String(p), port));
  await page.evaluate(() => { RF.UI.setMode('C'); }); await page.waitForTimeout(400); await idle();
  // start from a known profile: two points, as an old scene would have them
  await page.evaluate(() => { RF.Controller.actions.setProfile(RF.UI.store, []); RF.UI.afterChange(); }); await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const b = document.getElementById('left-canvas').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  const scr = (r, z) => page.evaluate(([r, z]) => RF.UI.vProf.toScreen(r, z), [r, z]).then((p) => [box.x + p[0], box.y + p[1]]);
  const cur = () => page.evaluate(() => { const mc = RF.UI.store.scene.modeC; return { n: mc.profile.length, curve: mc.curve ? JSON.parse(JSON.stringify(mc.curve)) : null, hist: RF.UI.hist.past.length, live: !!RF.Profile.curveLive(mc) }; });
  const click = async (r, z) => { const [x, y] = await scr(r, z); await page.mouse.click(x, y); await page.waitForTimeout(900); await idle(); };
  const drag = async (from, to) => { const [x0, y0] = await scr(...from), [x1, y1] = await scr(...to); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(900); await idle(); };
  ok('curve editor is on by default; the point-editor toggle exists', await page.evaluate(() => document.getElementById('prof-curve').checked));

  // ---- create: two taps make a straight segment
  await click(2, -12); await click(16, 12);
  let s = await cur();
  ok('two taps create a 2-node curve with a straight segment', s.curve && s.curve.nodes.length === 2 && s.curve.bulge[0] === 0 && s.n === 2 && s.live, JSON.stringify(s.curve));
  const n0 = s.curve.nodes.map((p) => p.slice());

  // ---- move: drag the body (middle of the segment, off the bend diamond)
  const mid = [(n0[0][0] + n0[1][0]) / 2, (n0[0][1] + n0[1][1]) / 2], off = [mid[0] + (n0[1][0] - n0[0][0]) * 0.2, mid[1] + (n0[1][1] - n0[0][1]) * 0.2];
  await drag(off, [off[0] + 2, off[1] - 3]);
  s = await cur(); const moved = s.curve.nodes;
  ok('dragging the body moves both ends by the same amount and keeps the length', Math.abs(moved[0][0] - n0[0][0] - 2) < 0.3 && Math.abs(moved[0][1] - n0[0][1] + 3) < 0.3 && Math.abs((moved[1][0] - moved[0][0]) - (n0[1][0] - n0[0][0])) < 1e-6 && Math.abs((moved[1][1] - moved[0][1]) - (n0[1][1] - n0[0][1])) < 1e-6, JSON.stringify(moved));

  // ---- extend: drag the far end
  await drag(moved[1], [moved[1][0] + 4, moved[1][1] + 2]);
  s = await cur();
  ok('dragging an end extends the segment and leaves the other end where it was', Math.abs(s.curve.nodes[1][0] - moved[1][0] - 4) < 0.3 && JSON.stringify(s.curve.nodes[0]) === JSON.stringify(moved[0]), JSON.stringify(s.curve.nodes));
  const ext = s.curve.nodes;

  // ---- bend: drag the diamond at the segment middle off the chord
  const m2 = [(ext[0][0] + ext[1][0]) / 2, (ext[0][1] + ext[1][1]) / 2];
  await drag(m2, [m2[0] + 3, m2[1] - 3]);
  s = await cur();
  ok('dragging the midpoint handle bends the segment (bulge != 0, more profile points, ends unchanged)', Math.abs(s.curve.bulge[0]) > 0.02 && s.n > 4 && JSON.stringify(s.curve.nodes) === JSON.stringify(ext) && s.live, 'bulge ' + s.curve.bulge[0] + ', profile points ' + s.n);
  const bent = s.curve.bulge[0];

  // ---- extend the chain with a tap, snap to the axis
  await click(0.05, 22);
  s = await cur();
  ok('a tap in empty space extends the chain by a node and snaps to the axis (r = 0)', s.curve.nodes.length === 3 && s.curve.nodes[2][0] === 0 && s.curve.bulge.length === 2, JSON.stringify(s.curve.nodes[2]));

  // ---- split / straighten through the panel
  await page.evaluate(() => { RF.UI.profSeg = 0; }); await page.click('#btn-split-seg'); await page.waitForTimeout(500);
  s = await cur(); ok('Split segment adds a node and keeps two bent halves', s.curve.nodes.length === 4 && Math.abs(s.curve.bulge[0]) > 0 && Math.abs(s.curve.bulge[1]) > 0, JSON.stringify(s.curve.bulge));
  await page.evaluate(() => { RF.UI.profSeg = 0; }); await page.click('#btn-straight-seg'); await page.waitForTimeout(500);
  s = await cur(); ok('Straighten segment zeroes its bulge', s.curve.bulge[0] === 0, JSON.stringify(s.curve.bulge));

  // ---- undo walks it all back, one edit per press
  const trail = [];
  for (let i = 0; i < 10; i++) { const h = (await cur()).hist; if (!h) break; await page.click('#btn-undo'); await page.waitForTimeout(400); await idle(); const c = await cur(); trail.push(c.curve ? c.curve.nodes.length + 'n/' + c.curve.bulge.map((b) => +b.toFixed(2)).join(',') : c.n + 'p'); }
  console.log('       undo trail: ' + trail.join('  <-  '));
  ok('undo steps back through straighten, split, node tap, bend (bulge ' + bent.toFixed(2) + ' -> 0), extend, move, 2nd tap, 1st tap: one edit per press', trail.length === 8 && trail[0].startsWith('4n/') && trail[1].startsWith('3n/') && trail[2].startsWith('2n/') && trail[3] === '2n/0' && trail[6] === '1p' && trail[7] === '0p', trail.join(' | '));
  s = await cur(); ok('after undoing everything the profile is empty again', s.n === 0 && !s.curve, JSON.stringify(s));
  await page.evaluate(() => { RF.UI.redo && RF.UI.redo(); }); await page.waitForTimeout(400);
  s = await cur(); ok('redo brings the first edit back', s.n >= 1, 'points ' + s.n);

  // ---- the old point editor is behind the toggle and still works
  await page.evaluate(() => { RF.Controller.actions.setProfile(RF.UI.store, [[0, 10], [8, 12]]); RF.UI.afterChange(); }); await page.waitForTimeout(300);
  await page.click('#prof-curve'); await page.waitForTimeout(300);  // off
  ok('toggle off: curve editor off', await page.evaluate(() => RF.UI.profCurve === false && !RF.UI.curveNow()));
  await click(14, 14);
  s = await cur(); ok('toggle off: a tap appends a plain point and writes no curve object (old behaviour)', s.n === 3 && !s.curve, JSON.stringify(s));
  const p1 = await page.evaluate(() => RF.UI.store.scene.modeC.profile[1]);
  await drag(p1, [p1[0] + 1, p1[1] + 2]);
  s = await cur(); const p1b = await page.evaluate(() => RF.UI.store.scene.modeC.profile[1]);
  ok('toggle off: dragging a vertex moves just that point', Math.abs(p1b[0] - p1[0] - 1) < 0.3 && s.n === 3 && !s.curve, JSON.stringify([p1, p1b]));
  await page.click('#prof-curve'); await page.waitForTimeout(300);

  // ---- an old scene (profile points, no curve) loads untouched and gives the same surfaces
  const old = await page.evaluate(async () => {
    const st = RF.UI.store, sc = st.scene; sc.modeC.preset = { kind: 'parabola', f: 12, rim: 45, n: 40, theta: 20, depth: 30 };
    RF.Controller.actions.applyPreset(st); st.commit({ deferA: true });
    const before = JSON.stringify(RF.Profile.build(sc).surfaces), wire = RF.State.serialize(sc);
    return { before, wire, n: sc.modeC.profile.length };
  });
  await page.evaluate((w) => { RF.UI.loadScene ? RF.UI.loadScene(RF.State.deserialize(w)) : RF.UI.openScene(w); }, old.wire).catch(() => {});
  await page.waitForTimeout(800); await idle();
  const after = await page.evaluate(() => { const sc = RF.UI.store.scene; return { surf: JSON.stringify(RF.Profile.build(sc).surfaces), hasCurve: !!sc.modeC.curve, n: sc.modeC.profile.length, rep: JSON.stringify(RF.UI.store.reports.C && RF.UI.store.reports.C.segments) }; });
  ok('old scene: ' + old.n + ' profile points load with no curve object', after.n === old.n && !after.hasCurve && !/"curve"/.test(old.wire));
  ok('old scene: the sweep builds byte-identical surfaces after loading', after.surf === old.before, after.surf.length + ' chars');
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
