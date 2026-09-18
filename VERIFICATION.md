# Verification record

Run locally on 2026-09-18. No outside sources, packages, reference images, or
precomputed intensity data were used. Node was v25.8.1; browser checks used the
Codex in-app browser against the local Python HTTP server.

## Executed, with observed results

**22/22 shared numerical checks passed in Node.** The complete per-check raw
results, including the actual measured time, are in `tests/results.json`.

**25/25 checks passed in the browser:** the same 22 plus three actual DOM/pointer
event regressions, one for each mode. The browser checks wait for the full chosen
ray count on both sides of a comparison, not a preview versus a full run.

| Measurement | Observed result |
| --- | --- |
| 10,000 rays, 200 finite surfaces, 3-bounce cap, including construction | Node **5.15 ms**; browser **7.30 ms** |
| Browser tracing portion of that benchmark | **6.20 ms** |
| One-million-ray ribbon, 64 surfaces | **661.6 ms** tracing CPU time |
| Progressive updates in that million-ray run | **9**; observed an incomplete accumulator at **230,656 rays**, then the complete result |
| Million-ray raw grid hash | `46d90f08` |
| Largest bisector centre-ray positional miss | `1.256e-14` units |
| Energy-accounting residual in multiple-bounce mirror test | `1.288e-14` relative to unit emitted power |
| Determinism / surface reorder / JSON restore hash | `8380e7d0` |
| Curved-scene 1× and 10× scale-invariance hash | `6e2f939d` |
| Actual revolved-mesh RMS outgoing angle / flat aperture | **1.237° / 53.949°**, 300 ray/surface hits |
| Same comparison, target RMS radius | **7.949 / 168.744** units |
| Curved conjugate test | measured magnification **−2**, aperture derivative `7.500e-11` |

These are individual measurements on this machine, not cross-device performance
guarantees. The benchmark sets the cap to three; its planar array does not force
every ray through three interactions. The separate energy test exercises actual
multiple bounces. Design-search time is not included in tracing time.

### Envelope expansion

The test expands the same enclosure while preserving source, target, tile budget,
and seed. It traces 10,000 samples at each size:

| Dimension scale | Intercepted power |
| --- | --- |
| 0.6× | 36.28% |
| 0.8× | 36.90% |
| 1.0× | 36.95% |
| 1.2× | 37.23% |
| 1.4× | 37.23% |
| 1.8× | 37.23% |
| 2.5× | 37.23% |

The plateaus are honest: the finite search did not improve the old design, so the
still-feasible incumbent was retained. This demonstrates the implementation's
finite-sample safeguard, not a proof that it found the best physical reflector.

The asymmetric fixture placed 64 facets with source distances **19.01–36.10** and
XYZ centre spans **23.72, 33.19, 26.48** within a **32 × 42 × 34** box. This rules
out a fixed-radius shell and demonstrates substantial enclosure use. It does not
certify the globally optimal stretched half-parabola.

### Actual UI paths

The in-page browser regressions invoke the same input, pointer-down/up, generation,
and asynchronous worker paths as interaction. They restore the scene afterwards.

| UI change | Before → after raw grid hash, 6,000 rays both sides |
| --- | --- |
| Paint: curved → flat | `d8abb5ab` → `a553a155` |
| Stamp: placed tile → wider tile | `8c7db542` → `d7cc4c5c` |
| Profile: revolve → extrude | `03a04a21` → `73ab9ef1` |

Separately clicked the intended canvas through browser automation and observed
the reflector replaced with one solved stamp surface, a nonempty target, a
source-image floor shown in the width control, and its quantitative warning.

The lens scene preset was selected and its replacement confirmed through the
in-page dialog. Observed a point source, 1,280 lens triangles, 10,000 traced rays,
six-bounce setting reported in the lens note, and **61.12%** target power. All
four lens constructors were also executed in the numerical suite and transmitted
nonzero light with conserved energy. That suite checks boundary physics, not each
preset's optical quality or collimation claim. The Fresnel preset was additionally
built through its UI controls: 1,840 triangles, 10,000 rays, **46.97%** target power,
**0.20%** unresolved, raw hash `b246f3ac`.

The app was measured at both 1,280 px and 768 px viewports. At 768 px its document
width was 753 px (scrollbar excluded), with a 521 px scene canvas: no horizontal
document overflow. The narrower in-app browser was also visually inspected.
Browser error/warning logs were empty when checked during these interactions.

### Failures found and corrected

1. The first revolved mesh had **4.20°** RMS outgoing divergence, failing the
   fixed `0.04 rad` threshold. Increasing circumferential geometric refinement
   reduced it to **1.237°**. The tolerance was not changed.
2. The original envelope test compared only 1× and 1.4× and passed. A seven-size
   sweep exposed a dip from **37.23% to 37.07%**. Retaining and comparing the
   previous feasible design fixed that measured regression; the broader test is
   now the permanent check.
3. An actual stamp click initially failed because pointer-up scheduled tracing
   and cancelled the pending design timer. Pointer-up now completes generation.
   A missing brace also prevented stamp outlines from drawing; both were fixed.
4. A first version of browser wiring tests compared a 600-ray preview with a
   6,000-ray result. That can produce a changed hash even with an inert control.
   Tests now wait for equal full ray counts; the hashes above are the corrected run.
5. Native confirmation dialogs interfered with the in-app browser automation.
   Replaced them with explicit in-page Keep current / Confirm dialogs and exercised
   the scene replacement path successfully.
6. Very low-energy Fresnel branches could previously fly to the target before the
   floor was tested. The floor is now checked before propagation, with truncated
   energy reported as unresolved. This was re-run through the full numerical suite.

## Written but not established by these tests

- Physical touch/stylus behaviour, pinch/pan on real hardware, and a comprehensive
  browser compatibility/accessibility audit.
- Global optimality or high-fidelity reproduction of arbitrary painted patterns.
- Rigorous general étendue or off-axis minimum-feature feasibility proofs.
- Exact collimation of the experimental TIR cup, high-aperture Fresnel lens quality,
  or correctness of arbitrary user-created refractive profile topology.
- Nested or overlapping dielectric materials (unsupported by the engine).
- End-to-end downloaded-file selection through the native file picker. State JSON
  validation/restore and browser reload persistence were exercised separately.
- Direct-file browser execution was enabled structurally with classic scripts but
  the browser test session used HTTP. The main-thread fallback and its message
  are implemented; this session did not time a large file-mode design search.

See the README's limitations before treating this as an engineering design tool.
