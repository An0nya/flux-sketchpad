const pw = require(process.env.PLAYWRIGHT);
(async () => { const b = await pw.chromium.launch(), p = await b.newPage(), errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('file:///Users/anya/Projects/flux-sketchpad/.claude/worktrees/b6-memory/index.html'); await p.waitForTimeout(3000);
  console.log(JSON.stringify(await p.evaluate(async () => { const r = {}; try { const w = new Worker('js/solve-worker.js'); r.worker = await new Promise((res) => { w.onerror = (e) => res('error: ' + (e.message || 'blocked')); setTimeout(() => res('no error in 1.5s'), 1500); }); } catch (e) { r.worker = 'throws: ' + e.message; } try { await fetch('samples/x.jpg'); r.fetch = 'ok'; } catch (e) { r.fetch = e.message; } return r; })));
  console.log(errs.join('\n')); await b.close(); })();
