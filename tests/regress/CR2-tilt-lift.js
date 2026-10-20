// CR2: glare discs sit on the lamp the mesh car draws, on a pass grade with a bank. Claude: python3 tests/serve.py 8984; PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/CR2-tilt-lift.js 8984
// For an oncoming car at 8, 15 and 30 m on two banked grades, every car disc (heads, plates, reflectors, tails) projects to within 1.5 px of
// the GPU mesh mount it is drawn at. The GPU side is the mount from state.mounts (the GLB, picked by adapt()'s own key) moved by the rendered
// transform rebuilt from update()'s maths. Control: with the gate forced off, the head lamps are off by more than 3 px at 8 m.
// Drift guard: the CPU mount table D.Models.MESH_MOUNTS equals the GLB mounts the GPU reads, within 1e-3 m.
// The car is held at one road station; dist moves so it sits at the wanted range (rel).
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8984);
const REPO = path.join(__dirname, '../..');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: ['--use-angle=metal'] });
  let fails = 0;
  const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon\.ico|Failed to load resource/.test(t)) errors.push('console: ' + t); if (/shader|ERROR: 0:/i.test(t)) errors.push('shader: ' + t); });
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate(s => RF.UI.loadScene(RF.State.deserialize(s), 'CR2 fixture'), fs.readFileSync(path.join(REPO, 'tests/fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/drive-three-page.js' });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(async () => {
      const u = await P1Page.ready(), A = RF.DriveAnim, V = A._.V;
      Object.assign(u.dvOpts, { scene: 'road', mountainPass: true, gpuRenderer: true, detailedModels: true, deerBehaviour: false, streetLamps: 'sodium', oncoming: true, preceding: false, trafficLogic: false, animals: false, people: true, posts: true, signs: true, trafficDensity: 3 });
      window.CR2 = { u, A, V };
    });
    await page.waitForFunction(() => { const V = RF.DriveAnim._.V; return V.three && V.three.modelState().ready; }, null, { timeout: 90000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const { u, A, V } = window.CR2; u.dvAnim.playing = false;
      const Tch = RF.Touge, M = RF.Drive.Models, src = V.src, t = 0;
      const eyeOf = () => V.p.eye, tanH = () => Math.tan(V.p.hfov * Math.PI / 360), W = () => V.p.w, H = () => V.p.h;
      // Screen position of a world point, on the object shader's ray: (1, -sx tanH, sy tanH H/W) from the eye.
      const proj = Q => { const e = eyeOf(), q = [Q[0] - e[0], Q[1] - e[1], Q[2] - e[2]], th = tanH(); return [-q[1] / (q[0] * th), q[2] / (q[0] * th * H() / W())]; };
      const pxDist = (a, b) => { const pa = proj(a), pb = proj(b); return Math.hypot((pa[0] - pb[0]) * W() / 2, (pa[1] - pb[1]) * H() / 2); };
      // The GPU mount in world: update()'s rotation (columns X, Y, U; scale 1) applied to the mount point. Rebuilt here, not imported.
      const gpuMount = (d, P) => {
        const F = d.face === -1 ? -1 : 1, n = d.normal, tt = [Math.cos(d.yaw) * F, Math.sin(d.yaw) * F, (d.grade || 0) * F], k = tt[0] * n[0] + tt[1] * n[1] + tt[2] * n[2];
        const X0 = [tt[0] - k * n[0], tt[1] - k * n[1], tt[2] - k * n[2]], L = Math.hypot(...X0), X = X0.map(v => v / L);
        const Y = [n[1] * X[2] - n[2] * X[1], n[2] * X[0] - n[0] * X[2], n[0] * X[1] - n[1] * X[0]];
        return [0, 1, 2].map(j => [d.x, d.y, d.z || 0][j] + X[j] * P[0] + Y[j] * P[1] + n[j] * P[2]);
      };
      const worldAt = (dist, p) => Tch.world(p, dist, t);
      // Two anchors on the pass (grade and bank), and one oncoming car ahead of each: the nearest with rel > 40 at the anchor.
      const anchors = [764.2, 1270];
      const out = { rows: {}, drift: 0, driftCount: 0, missing: [], cars: [] };
      for (const anchor of anchors) {
        const cand = A._.trafficCars(src, anchor, t).filter(c => c.kind === 'oncoming' && c.rel > 40).sort((a, b) => a.rel - b.rel);
        if (!cand.length) { out.cars.push({ anchor, none: true }); continue; }
        const car = cand[0], station = anchor + car.rel;
        out.cars.push({ anchor, id: car.id, station: +station.toFixed(2) });
        for (const T of [8, 15, 30]) {
          const dist = station - T;
          u.dvOpts.oncoming = true; u.dvAnim.dist = dist; u.redrawSpec(); A._.frame();
          const cur = A._.trafficCars(src, dist, t).find(c => c.id === car.id);
          const w = worldAt(dist, V.p), root = w.objects.find(o => o.detailPart === 'car' && o.detail && o.modelId === car.id);
          const discs = w.objects.filter(o => o.detailPart === 'car' && o.k === 'disc' && o.modelId === car.id);
          const mounts = V.three.modelState().mounts.filter(m => m.id === car.id);
          // Each CPU disc is matched by the key adapt() reads (meshKey = end:type:side) to the mount the GPU drew it at.
          const rowsPx = discs.map(d => {
            const mt = mounts.find(m => (m.end + ':' + m.type + ':' + m.side) === d.meshKey);
            if (!mt) return { mat: d.mat, key: d.meshKey, px: null };
            return { mat: d.mat, key: d.meshKey, px: +pxDist([d.x, d.y, d.z], gpuMount(root.detail, mt.p)).toFixed(3) };
          });
          // Gate off: the head lamps without the mount, against the same GPU head mount.
          const offW = worldAt(dist, Object.assign({}, V.p, { detailedModels: false }));
          const offHeads = offW.objects.filter(o => o.detailPart === 'car' && o.k === 'disc' && o.headlamp && o.modelId === car.id);
          const headMounts = mounts.filter(m => m.type === 'head');
          const headOff = offHeads.map(l => Math.min(...headMounts.map(m => pxDist([l.x, l.y, l.z], gpuMount(root.detail, m.p)))));
          // Drift guard over every mount the GPU read this frame.
          for (const m of V.three.modelState().mounts) { const key = m.end + ':' + m.type + ':' + m.side, row = M.MESH_MOUNTS[['sedan', 'suv', 'hatchback-sports'].indexOf(m.variant)][key]; out.driftCount++; if (!row) { out.drift = Infinity; out.missing.push(m.variant + ' ' + key); continue; } out.drift = Math.max(out.drift, ...m.p.map((v, j) => Math.abs(v - row.p[j])), ...m.n.map((v, j) => Math.abs(v - row.n[j]))); }
          out.rows[anchor + '/' + T] = { rel: cur ? +cur.rel.toFixed(2) : null, grade: +(root.detail.grade || 0).toFixed(4), bankTilt: +Math.hypot(root.detail.normal[0], root.detail.normal[1]).toFixed(4), discs: rowsPx.length, matched: rowsPx.filter(p => p.px !== null).length, worstPx: Math.max(...rowsPx.map(p => p.px === null ? Infinity : p.px)), perType: rowsPx, headOffPx: headOff.map(v => +v.toFixed(2)) };
        }
      }
      u.dvOpts.oncoming = true; u.redrawSpec(); A._.frame();
      return out;
    });
    console.log(JSON.stringify({ cars: r.cars, drift: r.drift, driftCount: r.driftCount, missing: [...new Set(r.missing)] }));
    ok('CR2 drift guard: the CPU mount table equals the GLB mounts the GPU reads (1e-3 m)', r.driftCount > 0 && r.drift < 1e-3, { drift: r.drift, checked: r.driftCount, missing: [...new Set(r.missing)] });
    ok('CR2 two anchors on the pass each found an oncoming car', r.cars.length === 2 && r.cars.every(c => !c.none), r.cars);
    for (const [key, row] of Object.entries(r.rows)) {
      const [anchor, T] = key.split('/');
      ok(`CR2 anchor ${anchor}, car at ${T} m: rel within 0.5 m, on a grade and bank`, row.rel !== null && Math.abs(row.rel - +T) < 0.5 && row.grade > 0.02 && row.bankTilt > 0.01, { rel: row.rel, grade: row.grade, bankTilt: row.bankTilt });
      ok(`CR2 anchor ${anchor}, car at ${T} m: every car disc (head, plate, reflector, tail) within 1.5 px of its GPU mount`, row.matched === row.discs && row.worstPx <= 1.5, { discs: row.discs, matched: row.matched, worstPx: row.worstPx, perType: row.perType });
      if (+T === 8) ok(`CR2 anchor ${anchor}, control at 8 m: with the gate off the head lamps are more than 3 px from the mount`, row.headOffPx.some(v => v > 3), { headOffPx: row.headOffPx });
    }
    console.log('info: gate-off head-lamp offsets (px) by row: ' + JSON.stringify(Object.fromEntries(Object.entries(r.rows).map(([k, v]) => [k, v.headOffPx]))));
    ok('CR2 no page or shader errors', errors.length === 0, errors.slice(0, 5));
  } finally { await browser.close(); }
  if (fails) { console.log(fails + ' check(s) failed'); process.exit(1); }
  console.log('all CR2 page checks passed');
})().catch(e => { console.error(e); process.exit(1); });
