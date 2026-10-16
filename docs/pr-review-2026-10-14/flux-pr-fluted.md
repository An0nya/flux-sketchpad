Add a sealed-beam solver combining a paraboloid reflector with a fluted lens, H4 filament presets, and four loadable lamp examples. The solver limits lens steps to the envelope and exposes lamp, beam, and lens choices.

Validation: `node tests/all.js` and `node tests/regress-node.js` passed on main. The latter verified 12 lamp/beam/lens combinations, extreme flute angles, and steering of the beam peak. Ten browser assertions passed on the combined checkout, covering the dropdown, H4 presets, lens choices, clean designs, and the worker tuner. Retained bench data live in `tools/sealed-beam/`.

Merged into main at d385332 and deployed. Pages reports a successful build, and the served solver matches the local file by SHA-256.
