// Tester only: python3 tests/serve.py 8745; node tests/regress/EX-export.js 8745
// No browser execution by the builder (FEATURE-CONTRACT-CODEX.md).
const fs = require('fs'), os = require('os'), path = require('path');
let pw; for (const name of [process.env.PLAYWRIGHT, 'playwright', '/Users/anya/Projects/agent-qa/node_modules/playwright']) { if (!name) continue; try { pw = require(name); break; } catch (_) {} }
if (!pw) throw new Error('Set PLAYWRIGHT to a Playwright installation');
const { parseIes, parseLdt, validateGltf } = require('../export-formats.js');
const port = +(process.argv[2] || 8745), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'EX-export-page-'));
let fails = 0;
const ok = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!pass) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
  try {
    const page = await browser.newPage({ acceptDownloads: true }), errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.Panels.initExports);
    ok('EX correct initialized page and port', await page.evaluate(p => !!RF.UI && location.port === String(p), port));
    const scene = JSON.parse(fs.readFileSync(path.join(__dirname, '../../examples/sealed-beam-7in-high.json'), 'utf8')); scene.sim.rays = 30000; scene.modeD.step = 0.5; scene.modeD.distance = 10000;
    await page.evaluate(sc => RF.UI.loadScene(RF.State.deserialize(JSON.stringify(sc)), 'EX page test'), scene);
    await page.waitForFunction(() => !RF.UI.needCompile && !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done && !RF.UI.run.preview, null, { timeout: 180000 });
    await page.click('#export-menu summary');
    ok('EX all export choices enabled after actual Spec trace, even with finite measurement screen', await page.evaluate(() => ['ies','ldt','gltf'].every(f => !document.getElementById('export-'+f).disabled)));
    const menuFits = await page.evaluate(() => { const a = document.querySelector('.export-options').getBoundingClientRect(), b = document.getElementById('sidebar').getBoundingClientRect(); return a.left >= b.left && a.right <= b.right; });
    ok('EX export menu fits inside sidebar', menuFits);
    for (const format of ['ies','ldt','gltf']) {
      const event = page.waitForEvent('download'); await page.click('#export-'+format); const download = await event, file = path.join(tmp, download.suggestedFilename()); await download.saveAs(file);
      const text = fs.readFileSync(file,'utf8'); const parsed = format === 'gltf' ? validateGltf(text).g : format === 'ies' ? parseIes(text) : parseLdt(text);
      ok('EX actual '+format+' download parses', format === 'gltf' ? parsed.meshes.length > 0 : parsed.C.length > 1 && parsed.cd.some(row=>row.some(cd=>cd>0)), file);
    }
    await page.check('#export-legacy'); const legacy = page.waitForEvent('download'); await page.click('#export-ies'); const old = await legacy; await old.saveAs(path.join(tmp,'legacy.ies'));
    ok('EX legacy IES option is reachable', fs.readFileSync(path.join(tmp,'legacy.ies'),'utf8').startsWith('IESNA:LM-63-2002'));
    const saved = page.waitForEvent('download'); await page.click('#btn-download'); const save = await saved; await save.saveAs(path.join(tmp,'scene.json'));
    ok('EX original scene JSON download still available', JSON.parse(fs.readFileSync(path.join(tmp,'scene.json'),'utf8')).modeD.distance === 10000);
    const disabled = await page.evaluate(() => {
      const ui=RF.UI, run=ui.run; ui.run=null; RF.Panels.refreshExports(ui);
      const noTrace=['ies','ldt'].every(f=>document.getElementById('export-'+f).disabled && document.getElementById('export-'+f+'-reason').textContent.length>0), geometry=!document.getElementById('export-gltf').disabled;
      ui.run=run; const enabled=Object.values(ui.store.scene.groups).map(g=>g.enabled); Object.values(ui.store.scene.groups).forEach(g=>g.enabled=false); RF.Panels.refreshExports(ui);
      const noSurfaces=document.getElementById('export-gltf').disabled && /surfaces/.test(document.getElementById('export-gltf-reason').textContent);
      Object.values(ui.store.scene.groups).forEach((g,i)=>g.enabled=enabled[i]); RF.Panels.refreshExports(ui); return {noTrace,geometry,noSurfaces};
    });
    ok('EX missing trace / surfaces have visible reasons; geometry works without a trace', disabled.noTrace && disabled.geometry && disabled.noSurfaces, JSON.stringify(disabled));
    ok('EX no page errors', errors.length === 0, errors.join(' | '));
  } finally { await browser.close(); }
  console.log('EX export page: '+(fails ? fails+' FAILED' : 'all checks passed')); process.exitCode = fails ? 1 : 0;
})().catch(e=>{ console.error(e); process.exitCode=1; });
