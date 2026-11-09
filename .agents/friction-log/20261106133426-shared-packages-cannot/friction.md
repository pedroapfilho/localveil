---
title: 'Shared packages cannot use ES2025 APIs because the web app type-checks them under the ES2023 lib'
severity: 'minor'
---

## Expected Behavior

Code in a shared package such as `@repo/redact-core` type-checks the same way in every consumer, so a package that targets ESNext can use what Node 24 and the supported browsers already ship, like `RegExp.escape`.

## Current Behavior

Every package exports its TypeScript source, so `apps/web` type-checks `redact-core` with its own preset. `packages/config-typescript/vite.json` sets `lib` to `ES2023`, while `base.json` uses `ESNext`. Replacing the hand-written `escapeForRegExp` with `RegExp.escape` passes in `redact-core` and every other package, then fails only in `web:typecheck` with TS2550.

## Possible Solution

Align the vite preset `lib` with the base preset (`ESNext`, `DOM`, `DOM.Iterable`), or give the web app its own `lib` override. The preset is the fleet baseline, so this needs a deliberate change in standy.

## Minimal Reproducible Example

Use `RegExp.escape` in `packages/redact-core/src/text.ts` and run `pnpm typecheck`: only `web:typecheck` fails.

## Context

Found while removing reimplemented helpers in the untangle refactor. The helper stayed hand-written, and the web glossary keeps its own copy for the same reason.
