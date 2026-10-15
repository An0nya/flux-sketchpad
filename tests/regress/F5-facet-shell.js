// F5: the facet shell in the page — switch it on, pick a cell on the map (real pointer events), edit its numbers in the panel, see it light up in Optics,
// undo / redo, save + reload, the Editor ring tap, and that the Editor is read-only while the shell is live.
// node tests/regress/F5-facet-shell.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8725);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  await idle();
  ok('page is the app under test (RF.UI, port ' + port + ')', await page.evaluate((p) => !!RF.UI && location.port === String(p), port));
  await page.evaluate(() => { RF.UI.setMode('C'); }); await page.waitForTimeout(400); await idle();
  await page.evaluate(() => { RF.Controller.actions.applyPreset(RF.UI.store); RF.UI.afterChange(); }); await page.waitForTimeout(400);
  const same = (a, b) => { const k = (x) => JSON.stringify(x, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)); return k(a) === k(b); };
  const st = () => page.evaluate(() => { const mc = RF.UI.store.scene.modeC; return { shell: mc.shell ? JSON.parse(JSON.stringify(mc.shell)) : null, surf: RF.UI.store.scene.groups.C.surfaces.length, hist: RF.UI.hist.past.length, sel: RF.UI.store.shellSel, usel: RF.UI.sel }; });
  const open = await page.evaluate(() => { for (const k of ['C-shell']) { const d = document.querySelector('details[data-section="' + k + '"]'); if (d) d.open = true; } return !!document.getElementById('shell-box'); });
  ok('the Facet shell section exists', open);
  const plainSurf = (await st()).surf;
  ok('before ticking: no shell in the scene and the plain profile is built (40 cones)', (await st()).shell === null && plainSurf === 40, 'surfaces ' + plainSurf);

  // ---- switch on through the real checkbox
  await page.click('[data-control="C.shell"]'); await page.waitForTimeout(900); await idle();
  let s = await st();
  ok('ticking Facet shell writes modeC.shell (12 x 24, conic from the parabola preset) and builds 288 cells', s.shell && s.shell.on && s.shell.nRad === 12 && s.shell.nAng === 24 && s.shell.R === 24 && s.surf === 288, JSON.stringify(s.shell) + ' surfaces ' + s.surf);
  ok('the cell map is drawn', await page.evaluate(() => !!document.getElementById('shell-map')));
  ok('no cell selected yet: the per-cell rows are hidden', await page.evaluate(() => { const w = document.querySelector('[data-control="C.cth"]').closest('[data-wrap]'); return w.style.display === 'none'; }));

  // ---- pick a cell by clicking the map: ring 5, sector 3 (centre of the cell)
  const mapPoint = (i, a) => page.evaluate(([i, a]) => { const c = document.getElementById('shell-map').getBoundingClientRect(), sh = RF.UI.store.scene.modeC.shell, Rm = 220 / 2 - 6, r = Rm * (i + 0.5) / sh.nRad, ph = 2 * Math.PI * (a + 0.5) / sh.nAng; return [c.left + c.width / 2 + r * Math.sin(ph) * c.width / 220, c.top + c.height / 2 - r * Math.cos(ph) * c.height / 220]; }, [i, a]);
  await page.evaluate(() => document.getElementById('shell-map').scrollIntoView({ block: 'center' }));
  let [x, y] = await mapPoint(5, 3); await page.mouse.click(x, y); await page.waitForTimeout(700); await idle();
  s = await st();
  ok('clicking the map selects that cell (ring 5, sector 3) and the per-cell rows appear', s.sel && s.sel.i === 5 && s.sel.a === 3 && await page.evaluate(() => document.querySelector('[data-control="C.cth"]').closest('[data-wrap]').style.display !== 'none'), JSON.stringify(s.sel));
  ok('the same cell is the inspector selection, so Optics / Scene / Result light it up', s.usel && s.usel.kind === 'facet' && s.usel.items.length === 1 && s.usel.items[0] === 'S5_3', JSON.stringify(s.usel));
  const lit = await page.evaluate(() => { const i = RF.UI.run && RF.UI.run.P.G.metas.some((m) => m.id === 'S5_3'); return !!i; });
  ok('that id exists among the traced surfaces', lit);

  // ---- edit in the panel: type into the number fields
  const typeInto = async (id, v) => { const f = page.locator('input.scrub[data-control="' + id + '"]'); await f.click(); await f.fill(String(v)); await f.press('Enter'); await page.waitForTimeout(500); await idle(); };
  const h0 = (await st()).hist;
  await typeInto('C.cth', 2); await typeInto('C.cdv', 5);
  s = await st();
  ok('typing aim 2 deg and focus 5 per m writes a sparse entry for cell 5:3 only', JSON.stringify(s.shell.cells) === JSON.stringify({ '5:3': { dTheta: 2, dv: 5 } }), JSON.stringify(s.shell.cells));
  ok('the map shows the edited cell (amber) and the note counts it', await page.evaluate(() => /1 edited/.test(document.getElementById('shell-note').textContent)));
  const surf = await page.evaluate(() => { const sc = RF.UI.store.scene, q = sc.groups.C.surfaces.find((x) => x.id === 'S5_3'), s2 = RF.U.deepCopy(sc); s2.modeC.shell.cells = {}; const d = RF.Profile.build(s2).surfaces.find((x) => x.id === 'S5_3'), o = sc.groups.C.surfaces.find((x) => x.id === 'S5_4'), od = RF.Profile.build(s2).surfaces.find((x) => x.id === 'S5_4'); return { a: q.n, b: d.n, other: JSON.stringify(o) === JSON.stringify(od), qa: JSON.stringify(q.quadric) !== JSON.stringify(d.quadric) }; });
  const ang = Math.acos(Math.min(1, surf.a[0] * surf.b[0] + surf.a[1] * surf.b[1] + surf.a[2] * surf.b[2])) * 180 / Math.PI;
  ok('the cell\'s surface really changed: its normal turned by about half the 2 deg aim (1.0 deg), its quadric differs, and its neighbour is untouched', Math.abs(ang - 1) < 0.05 && surf.qa && surf.other, ang.toFixed(3) + ' deg');

  // ---- bulk buttons
  await page.click('#btn-cell-sector'); await page.waitForTimeout(500);
  s = await st(); ok('Apply to sector copies the cell to all 12 rings of sector 3', Object.keys(s.shell.cells).length === 12 && Object.keys(s.shell.cells).every((k) => /^\d+:3$/.test(k)), Object.keys(s.shell.cells).join(' '));
  await page.click('#btn-undo'); await page.waitForTimeout(500); await idle();
  s = await st(); ok('undo reverses the bulk edit in one step (back to the single cell)', JSON.stringify(s.shell.cells) === JSON.stringify({ '5:3': { dTheta: 2, dv: 5 } }), JSON.stringify(s.shell.cells));
  await page.click('#btn-undo'); await page.waitForTimeout(500); await idle();
  s = await st(); ok('undo again takes the focus edit back', JSON.stringify(s.shell.cells) === JSON.stringify({ '5:3': { dTheta: 2 } }), JSON.stringify(s.shell.cells));
  await page.click('#btn-undo'); await page.waitForTimeout(500); await idle();
  s = await st(); ok('and the aim edit: no cells, shell still on', s.shell && s.shell.on && Object.keys(s.shell.cells).length === 0, JSON.stringify(s.shell.cells));
  const lbl = await page.evaluate(() => document.getElementById('btn-redo').title);
  ok('redo is labelled with the edit', /Redo/.test(lbl), lbl);
  await page.click('#btn-redo'); await page.waitForTimeout(500); await idle(); await page.click('#btn-redo'); await page.waitForTimeout(500); await idle();
  s = await st(); ok('redo brings both numbers back', JSON.stringify(s.shell.cells) === JSON.stringify({ '5:3': { dTheta: 2, dv: 5 } }), JSON.stringify(s.shell.cells));

  // ---- the Editor: read-only cross-section, a tap picks a ring
  const box = await page.evaluate(() => { const b = document.getElementById('left-canvas').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  const scr = (r, z) => page.evaluate(([r, z]) => RF.UI.vProf.toScreen(r, z), [r, z]).then((p) => [box.x + p[0], box.y + p[1]]);
  const before = await page.evaluate(() => JSON.stringify(RF.UI.store.scene.modeC));
  const r9 = 45 * 9.5 / 12, z9 = -12 + r9 * r9 / 48;
  [x, y] = await scr(r9, z9); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y - 20, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(500);
  ok('dragging on the Editor changes nothing while the shell is live (read-only)', await page.evaluate(() => JSON.stringify(RF.UI.store.scene.modeC)) === before);
  [x, y] = await scr(r9, z9); await page.mouse.click(x, y); await page.waitForTimeout(700); await idle();
  s = await st(); ok('tapping the cross-section at ring 9 selects ring 9 (keeping sector 3)', s.sel && s.sel.i === 9 && s.sel.a === 3, JSON.stringify(s.sel));
  ok('the Editor status line says what it is', await page.evaluate(() => /Facet shell/.test(document.getElementById('prof-info').textContent)));

  // ---- keyboard on the map
  await page.focus('#shell-map'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
  s = await st(); ok('arrow keys move the selection on the map (left = previous sector)', s.sel && s.sel.a === 2 && s.sel.i === 9, JSON.stringify(s.sel));

  // ---- save and reload
  await page.evaluate(() => { RF.UI.autosave(); }); await page.waitForTimeout(1500);
  const wire = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => /scene|flux/i.test(k) && localStorage.getItem(k).includes('"shell"')) || ''));
  ok('the autosave holds the shell and its cells', !!wire && /"cells":\{"5:3":\{"dTheta":2,"dv":5\}\}/.test(wire));
  await page.reload(); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 }); await idle(); await page.waitForTimeout(600);
  s = await st(); ok('after a reload the shell, its cells and the 288 built cells are back', s.shell && s.shell.on && same(s.shell.cells, { '5:3': { dTheta: 2, dv: 5 } }) && s.surf === 288, JSON.stringify(s.shell.cells) + ' surfaces ' + s.surf);

  // ---- hand-editing the profile ends the shell; untick keeps the cells
  await page.click('[data-control="C.shell"]'); await page.waitForTimeout(700); await idle();
  s = await st(); ok('unticking turns the shell off, keeps the cells, and the plain profile (40 cones) is traced again', s.shell && !s.shell.on && Object.keys(s.shell.cells).length === 1 && s.surf === 40, 'surfaces ' + s.surf);
  await page.click('[data-control="C.shell"]'); await page.waitForTimeout(700); await idle();
  s = await st(); ok('ticking it again brings the same cell edits back', s.shell.on && same(s.shell.cells, { '5:3': { dTheta: 2, dv: 5 } }) && s.surf === 288);

  // ---- a trace actually runs with the shell, with sane energy
  const e = await page.evaluate(() => { const c = RF.UI.run && RF.UI.run.ctx; return c ? { emitted: c.E.emitted, refl: c.E.reflected, nan: !Number.isFinite(c.E.reflected) } : null; });
  ok('the live trace has finite reflected energy', e && !e.nan && e.refl >= 0, JSON.stringify(e));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
