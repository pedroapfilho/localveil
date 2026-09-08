---
title: "Full dead-code check fails on inherited worker entry points and unused exports"
severity: "minor"
---

Running pnpm fallow:dead on the React Doctor remediation branch reports 2 unused files, 5 unused exports and 2 unused types outside the changed code. The worker entry points apps/cli/src/file-worker.ts and apps/web/src/wasm-check.ts need reachability review, along with the exports listed by the command. pnpm exec fallow audit --base origin/main passes its new-only gate with zero new dead-code or complexity findings. Keep this separate from the React Doctor fixes; determine which findings are genuine dead code and which are missing entry-point attribution.
