// Native port of tests/regress/SB1-studs-everywhere.js (the adapter skips that script while this file exists).
// Lane studs are placed on every scene (open road, forest, city, mountain pass), the studs toggle is enabled on every scene,
// and the drive view draws without page errors on each. The count comes from the page's own world builder, not from pixels.
// The scenes stay sequential in one page (as the original): switching between them is part of what is checked.
const { test, expect } = require('../fixtures.js');
test.use({ viewport: { width: 1280, height: 950 } });

test('SB1: studs on every scene, toggle enabled, no errors', async ({ drive: page, pageErrors, consoleErrors }) => {
  for (const [scene, pass] of [['road', false], ['forest', false], ['city', false], ['road', true]]) {
    await test.step(pass ? 'pass' : scene, async () => {
      await page.evaluate(([s, mp]) => { Object.assign(RF.UI.dvOpts, { scene: s, mountainPass: mp, rpm: true }); RF.UI.redrawSpec(); }, [scene, pass]);
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const V = RF.DriveAnim._.V, btn = document.querySelector('[data-anim="c-rpm"]');
        const world = V.p && V.p.src ? RF.DriveAnim.tileWorld(V.p, 95, 2) : null;
        return { studs: world ? world.objects.filter((o) => o.cls === 'rpm').length : -1, toggleDisabled: btn ? btn.disabled : 'missing' };
      });
      expect.soft(r.studs, 'studs placed on the page (count at 95 m)').toBeGreaterThan(0);
      expect.soft(r.toggleDisabled, 'studs toggle enabled').toBe(false);
    });
  }
  expect([...pageErrors, ...consoleErrors], 'no page errors across the four scenes').toEqual([]);
});
