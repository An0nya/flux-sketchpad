# Exported photometry and geometry

The Export menu beside Save to disk and `tools/flux.js export` share `js/exports.js`. Scene JSON remains available from
Save to disk. No saved-scene fields or solver interfaces change.

## Photometry

IES defaults to **`IES:LM-63-2019`**, Type C, `TILT=NONE`, absolute photometry (`lumens per lamp = -1`), multiplier 1,
metre units, and generation type `1.00010` (Computer Simulation). The menu's older-reader checkbox, or CLI
`--ies-2002`, selects **`IESNA:LM-63-2002`** and its unused-field value 1. Numeric tables have the same layout.
An older reader that rejects the 2019 identifier needs that explicit compatibility option.

EULUMDAT uses C-γ, type 3, **Isym=0 (none)**, nonuniform angle lists (`Dc=Dg=0`), all C planes below 360, and all
γ angles from 0 to 180. Its absolute-luminaire lamp count is -1. Luminaire lumens are the sum of traced-window bin
energies; LOR is 100% of that exported output. The table stores `absolute cd × 1000 / window lumens`, with conversion
factor 1; multiply by `window lumens / 1000` to recover cd. A zero-flux LDT is rejected because that normalization is
undefined. IES can represent a dark trace.

Both formats use this fixed frame (world axes as stored by the app):

| Direction | File coordinates |
|---|---|
| +x, forward | C=0°, γ=90° |
| +y, lamp left | C=90°, γ=90° |
| -y, lamp right | C=270°, γ=90° |
| -z, down | γ=0° |
| +z, up | γ=180° |

For the app's A convention, `C=wrap(-H)` and `γ=90+V`. For B and S, the writer converts a file direction
`(sinγ cosC, sinγ sinC, -cosγ)` through `RF.FarField.hvOf(direction, conv)` before reading the grid. The beam is
exported at **design aim**, without the Spec report's automatic aiming or left-traffic display mirroring.

Input is always **the Spec grid at infinity**, even if Measure at selects a finite screen. Bin intensity is `E/Om`
(lumens / steradians = candela), interpolated between bin centres; no display kernel or peak normalization is applied.
A-convention output contains every native bin centre. B/S output resamples at half the native angular step. Guard
planes surround the window; the C=360 IES seam duplicates C=0. No left/right or up/down symmetry is assumed.
Exports above 8 million table entries fail with a request to increase the Spec bin size.

**Outside the traced window, entries are zero because no measurements are available.** These files describe a
windowed distribution, not a measured full sphere. IES keywords record the input H/V window, its convention, window
lumens, and total escaping lumens. LDT's lumens describe the window only. Reintegrating an imported interpolated table
can differ from the original bin-energy sum, especially at hard window boundaries or noisy bins; intensities are not
rescaled to conceal that difference.

Photometric dimensions are zero for a point-source model. Electrical input, CCT, CRI and room-utilization direct
ratios are unavailable: IES watts are 0; LDT watts/direct ratios use required numeric zero placeholders, CCT/CRI say
unknown/n/a. The LDT report field explicitly labels the unavailable numeric fields. Those placeholders are not
measurements or room-utilization results. Downward flux fraction is derived from the bin energies (bins crossing the
horizon are assigned by their centre).

## Geometry

`.gltf` contains an embedded base64 buffer; no sidecar assets are needed. Enabled scene surfaces are compiled with
`RF.Geo.compile` and meshed with the renderer's `RF.Geo.mesh`. Each polygon is triangulated as a fan, as in the WebGL
renderer; degenerate triangles are omitted. Each compiled surface gets a named mesh/node under its group node.
Reflector, refracting lens and other enabled scene surfaces are included; source/envelope/target guides are excluded.

Positions are multiplied by 0.001 (mm → m). The rotation `(x,y,z) → (x,z,-y)` gives glTF its y-up frame while preserving
triangle winding. Each triangle has a unit face normal. A neutral double-sided material makes both sides visible;
this is geometry export, not a transfer of optical refractive indices or a manufacturing-solid representation.

## References and checks

- ANSI/IES **LM-63-19**, §5 (file fields), Table 2 (generation type), Annex C (example);
  [ANSI's publisher overview](https://blog.ansi.org/ansi/standard-file-photometric-data-ies-lm-63-19/).
  The standard's published text was consulted through a [mirrored copy](https://www.scribd.com/document/885840971/LM-63-19).
- [DIAL's EULUMDAT field specification](https://evo.support-en.dial.de/support/solutions/articles/9000074164-description-of-the-eulumdat-format)
  for angle lists, ordering, symmetry and normalization; [AGi32's format specification](https://docs.agi32.com/PhotometricToolbox/Content/Open_Tool/eulumdat_file_format.htm)
  for the absolute-photometry negative lamp-count convention. DIAL clarifies that the historical field widths are
  storage estimates; fields are ASCII strings, not fixed-width truncations.
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), coordinate system,
  mesh primitives, buffers, bufferViews and accessors.
- Independent IES reader: [iesna](https://github.com/richard-viney/iesna), npm version 2.0.1, MIT.

`node tests/export-formats.js` checks independent IES/LDT parsing, asymmetric A/B/S intensity round trips, a real
exit-ray trace, the 0/360 seam, absolute scaling, errors, and glTF structure, buffer ranges, accessor counts/bounds,
metre conversion, normals, winding, reflector/lens inclusion and disabled groups. It also runs within
`node tests/regress-node.js`. Optional `IESNA_MODULE=/absolute/path/to/iesna/dist/index.js` compares both IES header
variants against the independent npm parser, without a repository dependency. `tests/flux-cli.js --node-only` covers
all three CLI exports and proves a saved finite-distance scene exports the actual infinity trace.

Browser validation belongs to the tester: serve on 8745, then `node tests/regress/EX-export.js 8745`. It verifies the
page identity/port, actual file downloads, both IES headers, the existing scene JSON download, unavailable reasons,
and no page errors. The builder does not execute browsers.
