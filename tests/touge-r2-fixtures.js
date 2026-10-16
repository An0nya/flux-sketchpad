// Shared Node/browser fixture. The live Mountain pass uses the terrain renderer;
// this flat CPU/GPU comparison needs a route that fits the flat renderer's window.
(function (root) {
  function flatHairpinRoute(RF, dist) {
    const A = RF.DriveAnim, lastBendTile = Math.floor(dist / A.TILE_LEN) + 2;
    return A.tileRoute(0, dist, false, (seed, k) => {
      const tile = RF.Touge.tile(seed, k);
      // Retain the normal flat window (one tile behind, current, two ahead).
      // The recipe API also generates five farther tiles: continue straight there,
      // rather than feeding the terrain renderer's distant bends to flat uniforms.
      return k <= lastBendTile ? tile : { ...tile, kind: 'straight', curvature: 0 };
    });
  }
  const fixtures = { flatHairpinRoute };
  if (typeof module !== 'undefined') module.exports = fixtures;
  else root.TRFixtures = fixtures;
})(globalThis);
