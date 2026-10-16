# three.js r180 (0.180.0)

Pinned release: https://github.com/mrdoob/three.js/releases/tag/r180
Published 2025-09-03 (more than two weeks before this integration).

Unmodified ES modules from:
- https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.module.min.js
- https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.core.min.js
- https://raw.githubusercontent.com/mrdoob/three.js/r180/LICENSE

MIT licence, included in LICENSE. No runtime CDN. Only the opt-in
animated Drive view imports these files. HTTP serving is required for ES modules;
opening index.html via file:// keeps the existing CPU renderer.

SHA-256 (also enforced by tests/drive-three.js):

```text
61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de  three.core.min.js
e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6  three.module.min.js
```

The vendor core contains its own random UUID/math utilities. Check #23 excludes
only these two pinned files; the app's seeded optics and scene RNG remain under
the source scan. This dependency is not imported by the optics engine.

## M1 prototype addons

GLTFLoader.js and its BufferGeometryUtils.js dependency are vendored from the
same r180 tag, under addons/loaders and addons/utils. Original source:
- https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/loaders/GLTFLoader.js
- https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/utils/BufferGeometryUtils.js

Only the `from 'three'` import specifiers were changed to
`from '../../three.module.min.js'` for local browser resolution without an importmap.
MIT, covered by the existing LICENSE. Adapted-file SHA-256 pins: addons/pins.json.
Combined addon source payload: 150,318 bytes. Car assets load only when detailed
models is enabled; a bounded module cache retains the three parsed templates and
shared textures across toggle cycles.
