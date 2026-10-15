# Feedback: sealed-beam-v1 (external review, 2026-10-15) + Claude's reproduction

## The feedback (Anya pasted it; reviewer = external model)
1. **Source setup is ambiguous.** The 7" example is labelled `h4-low` but uses a TRANSVERSE filament; the H4 bulb is
   axial. Separate "assumed sealed-beam filament" from "H4 bulb assembly". The H4 model lacks its internal dipping shield,
   tip obscuration and bulb glass; the solver's forward cap is not the H4 dipping shield.
2. **Placement and focus.** Expose filament centre + orientation relative to the reflector focus; document assumed
   offsets. Moving the source and rebuilding also moves the generated optics, which confuses placement experiments:
   add a fixed-optics source-adjustment mode.
3. **Lens model.** Each flute is one tilted planar square with the step (riser) faces omitted. Add curved flute
   profiles (spread within each element), variable-width / non-square regions (flux allocation), and the connecting faces.
   Internal flute placement (inner face) is historically valid.
Recommended order: consistent source assembly + mounting reference → verify bare reflector → better flute geometry →
retune. Keep LB2M and LB2V comparisons separate (they change aim procedure AND photometric limits).

## Claude's check (2026-10-15, `tools/flux.js trace … --rays 2e6 --spec fmvss-lb2m`, optics held fixed)
- Claim 1 TRUE: `examples/sealed-beam-7in-low.json` has `source.preset: h4-low`, `axis: [0,1,0]` (transverse); F3 chose it
  as an assumption (report: "filament orientation ASSUMED, no source found"). Claim 3 TRUE: F3's report says "no riser faces".
- Placement experiment REPRODUCED:
  | source | LB2M pass / fail / unsure | fails |
  |---|---|---|
  | axial at the focus (axis [1,0,0], pos 0,0,0) | 14 / 7 / 1 | 4U 8L · 1.5U 1R to R · 1U 1.5L to L · 0.5U 1.5L to L · 0.5U 1R–3R · 0.5D 1.5L to L · 1.5D 9L |
  | axial, +1 mm forward, 0.5 mm right (−y), 0.5 mm up | **19 / 3 / 0** (reviewer: 18 / 3 / 1) | 4U 8L · 1.5U 1R to R · 0.5U 1R–3R |
  | same but 0.5 mm LEFT (+y) | 14 / 7 / 1 | (control: the right shift matters) |
  Same three remaining fails as the reviewer reports (two upward maxima + the 4U 8L minimum); the unsure row differs
  (seed / noise). Fitted placement with an incomplete H4 model, NOT a correct bulb installation.
