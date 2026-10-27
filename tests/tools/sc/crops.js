// Compose labelled, magnified crops of several shots into one PNG (no image library needed: the page canvas does it).
// Usage: PLAYWRIGHT=... node tests/tools/sc/crops.js <out.png> <x,y,w,h> <scale> <label=file.png> [<label=file.png> ...]
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs');
const [out, rect, scale, ...items] = process.argv.slice(2), [x, y, w, h] = rect.split(',').map(Number), S = +scale;
(async () => {
  const browser = await pw.chromium.launch(); const page = await browser.newPage();
  const imgs = items.map((it) => { const i = it.indexOf('='); return { label: it.slice(0, i), b64: fs.readFileSync(it.slice(i + 1)).toString('base64') }; });
  const png = await page.evaluate(async ({ imgs, x, y, w, h, S }) => {
    const c = document.createElement('canvas'); c.width = w * S; c.height = (h * S + 18) * imgs.length; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < imgs.length; i++) { const im = new Image(); im.src = 'data:image/png;base64,' + imgs[i].b64; await im.decode(); const oy = i * (h * S + 18); g.drawImage(im, x, y, w, h, 0, oy + 18, w * S, h * S); g.fillStyle = '#fff'; g.font = '13px sans-serif'; g.fillText(imgs[i].label, 4, oy + 13); }
    return c.toDataURL('image/png').split(',')[1];
  }, { imgs, x, y, w, h, S });
  fs.writeFileSync(out, Buffer.from(png, 'base64')); await browser.close();
})();
