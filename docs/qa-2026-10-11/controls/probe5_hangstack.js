// Set target distance huge via the UI path, then pause the main thread with CDP and print the JS stack: where is it stuck?
const { boot } = require('./h.js');
const ID = process.argv[2] || 'tgt.dist', V = +(process.argv[3] || 1e10);
(async () => {
  const { browser, page } = await boot();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  const stacks = [];
  cdp.on('Debugger.paused', async (ev) => { stacks.push(ev.callFrames.slice(0, 8).map((f) => f.functionName + ' @ ' + f.url.split('/').pop() + ':' + (f.location.lineNumber + 1))); await cdp.send('Debugger.resume'); });
  page.evaluate(([id, v]) => { RF.UI.setControl(id, v); }, [ID, V]).catch(() => {});
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 4000)); await cdp.send('Debugger.pause'); await new Promise((r) => setTimeout(r, 500)); }
  console.log(ID, V); for (const s of stacks) console.log(s.join('\n  '), '\n---');
  await browser.close();
})();
