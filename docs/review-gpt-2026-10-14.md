# External review (GPT, 2026-10-14): idea bank, NOT a plan

Anya had GPT inspect the live site from a chat session with no machine: screenshots + a static URL probe only. Its recommendations, verbatim in substance, with
Claude's check against the code (2026-10-14) where a claim mattered. Treat everything here as candidate backlog.

## Claims checked
| claim | check |
|---|---|
| No IES/LDT/glTF export | TRUE: Download writes only the scene JSON (`js/panels.js` `download`). |
| No chromatic aberration / diffraction | TRUE: no wavelength or dispersion code in js/. |
| WebGL in the drive animation | TRUE: `js/drive-anim.js` (F2, 10-14). |
| No discoverable manifest (`/api.json`, `/solvers.json` 404) | TRUE. |
| "Dozen solvers claimed, 5 visible" | Screenshot artifact: GPT had no machine, only screenshots of the dropdown. index.json has 32 (11 default, 7 legacy, 14 benchmark). |
| "Physics engine untouched since early days" | TRUE in Anya's sense: base reflection/refraction/trace is fully backwards compatible; changes since are the GPU path plus added features, no rewrite. |

## Its recommendations
**P0 (engine untouched):** LM-63 IES writer from ray bins + glTF reflector mesh · manufacturability viz (Gaussian
curvature heat map, draft/undercut, Laplacian smoothing tied to Min facet distance) · 3-wavelength chromatic
(450/550/650 nm, Sellmeier for PMMA/silicone, blue fringe above cut-off) + 0.1–0.2° vertical blur for diffraction ·
A/B compare (hash solve inputs, cache, side-by-side far field + metrics diff).

**P1:** static `api.json` manifest (solvers, params, emitters, version) · multi-emitter single envelope (sum N shifted
mappings before scoring) · ADB: (A) TIR micro-lens array, one lens = one channel, or (B) facet groups tagged as channels on
SQM reflectors · halogen sliding shield as a moving occluder plane in the projector solver.

**P2 (drive sim):** wet-road BRDF (Keitz: specular lobe vs grazing angle) · tiles: T-junction + signals, urban canyon with
street lamps, forest/hilly · eye model: auto-exposure from display white cd/m², De Boer glare, sign retroreflection bloom ·
visibility: STV small target (0.2 m, R 0.2) Weber contrast + iso-lux lines on the road.

**Don't touch:** the base ray tracer. Wrap it.

## Status
- Agent API: Claude proposed `tools/flux.js` (Node CLI + Playwright screenshots + generated api.json), awaiting Anya's go.
- Drive sim: plan to be formulated with Anya (see F2 report "Out of scope — ideas" + the P2 list above).
