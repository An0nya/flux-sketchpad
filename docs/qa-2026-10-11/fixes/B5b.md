# B5b spec decisions (branch fix/b5b-spec-decisions, base 62f9139)
Commits: 74aeec2 (D-S13), 60672bd (D-S16 + D-S03 + D-S18, one commit: all three edit roadModel/update in spec-ui.js).
Tests: tests/regress-node.js (D-S13 source check), tests/regress/D-spec-decisions.js (S03/S16/S18, Playwright, port 8827). Before: 9 FAIL; after: all PASS. tests/all.js: "all passed"; regress-node 0 FAIL; G15-G18, G20, G02b still pass.
IIHS check (D-S13): Headlight Test and Rating Protocol Ver. III, July 2018, "Test Conditions" printed p.5 (PDF p.6) + Figure 2: straightaway points 1 and 3 = right/left edges of a 6.6 m road, curves points 1,2 = edges of a 3.3 m lane, 25 cm up, origin X on the car's lane centre. App geometry (road.js IIHS.lane 3.3; right -1.65 m, left +4.95 m) matches. No discrepancy.
Stopped / not done: solvers.js tools.trace (res.road) still uses the Measure-at grid and the Road aim for quality/goals (needs solvers.js, outside batch). ui.js:362 preview grids untouched.
