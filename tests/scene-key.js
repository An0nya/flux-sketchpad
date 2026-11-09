// shared helper (neb f144, template a78f/6252477): does the drive scene cache key carry `opt`?
// Pre-B3 the key is the skey literal in js/drive-anim.js; B3 (cache-keys) moves it into js/cache-keys.js's
// animScene recipe. Dual-shape so suites stay green on both sides of that landing — and scoped to the
// skey statement only (the tkey literal carries the same !!o.x fragments and must not satisfy this).
const fs = require('fs'), path = require('path');
const sceneKeyHas = (anim, ROOT, opt) => {
  const ck = path.join(ROOT, 'js', 'cache-keys.js');
  if (fs.existsSync(ck)) { const t = fs.readFileSync(ck, 'utf8'); const m = t.match(/animScene\s*(?::|=)\s*\[([\s\S]*?)\]/); return !!(m && m[1].includes(opt)); }   // inline (animScene: [) or named (var animScene = [) — frenchie 1c99
  for (const m of anim.matchAll(/skey\s*=\s*[^;]+;/g)) if (m[0].includes(opt)) return true;
  return false;
};
const sceneKeyHasAll = (anim, ROOT, opts) => opts.every((o) => sceneKeyHas(anim, ROOT, o));
module.exports = { sceneKeyHas, sceneKeyHasAll };
