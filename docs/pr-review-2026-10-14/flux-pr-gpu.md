Flux currently requires users to opt into GPU tracing. Enable it by default where WebGPU is available, retain the CPU fallback and explicit user choice, and cap ray counts and batch sizes using device limits.

Validation: `node tests/all.js` and `node tests/regress-node.js` passed on main containing this change and the fluted-lens solver. Six browser assertions passed on the combined feature checkout, including WebGPU readiness/default choice, explicit opt-out, simulated low-memory caps, cap messaging, and lifting the cap.

Merged into main at 9f03bbf and deployed through d385332. Pages reports a successful build, and the served GPU script matches the local file by SHA-256.
