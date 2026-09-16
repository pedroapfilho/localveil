---
title: "Two native ONNX runtime versions collide on Linux"
severity: "minor"
---

## Expected Behavior

The CLI and model integration tests can load the detector and tokenizer in one Node process on Linux.

## Current Behavior

Transformers installs ONNX Runtime 1.24.3 while the detector loads 1.29.0. Both native libraries have the same SONAME; loading the older library first makes the newer binding fail with `VERS_1.29.0 not found`. macOS tests pass, hiding the failure until Linux CI runs.

## Possible Solution

Keep Transformers' transitive native runtime aligned with the detector's direct runtime using a narrow dependency override. Verify the combined imports and test suite on Linux.

## Minimal Reproducible Example

Install the workspace on Ubuntu and run `pnpm --filter @repo/pii-detect test` with both runtime versions in the dependency graph.

## Context

The first CI check workflow exposed this during component standardization. The PR aligns the native ABI; review the override when either direct runtime or Transformers changes version.

Transformers also imports `onnxruntime-common` without declaring it. A package extension declares that direct dependency so isolated Vercel installs can resolve the browser bundle.
