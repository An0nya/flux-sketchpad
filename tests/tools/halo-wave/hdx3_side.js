// HDX3 throwaway: side-by-side composer for halo frames (canvas in a headless page). node hdx3_side.js <out.png> <label=path> ...
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const [OUT, ...args] = process.argv.slice(2);
const items = args.map((a) => { const i = a.indexOf('='); return { label: a.slice(0, i), path: a.slice(i + 1) }; });
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.setContent('<html><body style="margin:0"><canvas id=c></canvas></body></html>');
    const url = await page.evaluate(async (items) => {
      const imgs = await Promise.all(items.map((it) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + it.b64; })));
      const S = 2, W = imgs[0].width * S, Hh = imgs[0].height * S, gap = 12, top = 34;
      const c = document.getElementById('c'); c.width = items.length * (W + gap); c.height = Hh + top;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.font = '16px sans-serif'; x.fillStyle = '#000';
      imgs.forEach((im, i) => { x.drawImage(im, i * (W + gap), top, W, Hh); x.fillText(items[i].label, i * (W + gap) + 8, 22); });
      return c.toDataURL('image/png');
    }, items.map((it) => ({ label: it.label, b64: fs.readFileSync(it.path).toString('base64') })));
    fs.writeFileSync(OUT, Buffer.from(url.split(',')[1], 'base64')); console.log('wrote', OUT);
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
