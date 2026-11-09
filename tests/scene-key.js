// shared helper (neb f144/396f, template a78f/6252477 + 687a/0750fac + 45aa/f602175): does the drive scene
// cache key carry `opt`? Pre-B3 the key is the skey literal in js/drive-anim.js; B3 (cache-keys) moves it
// into js/cache-keys.js's animScene recipe. Dual-shape so suites stay green on both sides of that landing.
// Scope is the point: the pre-B3 match stops at the tkey (skey and tkey share one statement, so a whole-
// statement match cannot tell which half carries the option — neb 396f), and the post-B3 branch asks the
// module's recipeOptions (or a bracket-balanced scan) instead of truncating at the first ']'.
const fs = require('fs'), path = require('path');
const sceneKeyHas = (anim, ROOT, opt) => {
  const ck = path.join(ROOT, 'js', 'cache-keys.js');
  if (fs.existsSync(ck)) {
    try {   // neb d31f: recipeOptions takes the recipe ARRAY (not a name); optionMap() is the name-keyed map
      const mod = require(ck);
      const ids = mod.optionMap ? mod.optionMap().animScene
        : mod.RECIPES && mod.recipeOptions ? mod.recipeOptions(mod.RECIPES.animScene)
        : mod.recipeOptions && mod.animScene ? mod.recipeOptions(mod.animScene) : null;
      if (ids) return ids.includes(opt);
    } catch (e) { /* fall through to text scan */ }
    const t = fs.readFileSync(ck, 'utf8'), i = t.search(/animScene\s*(?::|=)\s*\[/);
    if (i < 0) return false;
    const j = t.indexOf('[', i);
    for (let k = j, depth = 0; k < t.length; k++) {
      if (t[k] === '[') depth++;
      else if (t[k] === ']') { depth--; if (!depth) return t.slice(j, k + 1).includes(opt); }
    }
    return false;
  }
  for (const m of anim.matchAll(/skey\s*=\s*([^;]*?)(?:,\s*tkey\s*=|;)/g)) if (m[1].includes(opt)) return true;
  return false;
};
const sceneKeyHasAll = (anim, ROOT, opts) => opts.every((o) => sceneKeyHas(anim, ROOT, o));
module.exports = { sceneKeyHas, sceneKeyHasAll };
