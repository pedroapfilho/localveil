---
title: 'CLI build inherits nonexistent Turbo output files'
severity: 'minor'
issue: 'pedroapfilho/localveil#92'
---

## Expected Behavior

The CLI type-only build should use Turbo output metadata that matches the files it produces.

## Current Behavior

pnpm build succeeds but Turbo warns that no output files were found for cli#build. The CLI build is tsc --noEmit, while turbo.json applies dist/** outputs to every build task.

## Possible Solution

Override cli#build outputs to an empty array, or use typecheck as the CLI build gate.

## Minimal Reproducible Example

Run pnpm build without a cache hit and compare apps/cli/package.json build with turbo.json tasks.build.outputs.

## Context

Found while running the required production build after audit remediation. The build passes, but its declared artifacts do not exist.
