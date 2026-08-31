# AGENTS.md

Guidance for AI coding agents working in `localveil`. `CLAUDE.md` is a symlink to this file.

## What this repo is

A local-first redaction tool, and the source of truth for the fleet's `tool` profile. It blacks out personal data in files without uploading them: a named-entity model plus a pattern layer finds names, emails, phones, addresses, dates, account numbers and secrets, then paints over them. Detection runs in a Web Worker in the browser and in a worker thread in the CLI. There is no account, no server, no database and no auth stack, so none of the SaaS-shaped standards apply here.

## Layout

```
apps/
  web/                 Vite SPA (not Next). Workers, model host, review UI.
  cli/                 ink CLI, run through tsx; bin/localveil.js registers the loader
packages/
  config-typescript/   @repo/typescript-config (base/library/react-library/vite presets)
  config-vitest/       @repo/config-vitest (node/react presets + coverage thresholds)
  redact-core/         format-neutral redaction primitives
  redact-text/         plain text, Markdown, CSV, JSON, logs
  redact-pdf/          PDF page rendering and overlay
  redact-image/        raster images
  redact-node/         filesystem entry points for the CLI
  ocr/                 Tesseract wrapper for scanned input
  pii-detect/          model loading, inference, resumable weight cache
  eval/                labelled corpus, scoring, report table
  i18n/                en/pt/es messages, provider, locale storage
  ui/                  shared React components
plans/                 numbered design notes, oldest first
fixtures/              sample inputs the tests read from disk
```

## Dev workflow

```bash
pnpm install
pnpm dev --filter=web      # https://localveil.web.localhost via portless
pnpm --filter cli start    # terminal pipeline
```

Root scripts run turbo: `dev`, `build`, `start`, `test`, `test:coverage`, `lint`, `typecheck`, `clean`. Root-only: `format`/`format:check` (oxfmt) and the `fallow*` suite. Pre-commit runs husky → lint-staged (oxlint + oxfmt).

Every package's `exports` points straight at `./src/index.ts`. Nothing here is published, so no package has a build step; `vite` and `vitest` consume the TypeScript directly and `tsc --noEmit` is the only type gate.

## Conventions

- kebab-case filenames; oxlint (`oxlint-config-awesomeness`) + oxfmt; no ESLint/Prettier
- `type` over `interface`, arrow functions, exports at end, WHY-comments only
- Relative imports are extensionless; `allowImportingTsExtensions` stays off. Vite's asset queries (`./redact-worker.ts?worker&url`) and `new URL("worker.ts", import.meta.url)` are bundler inputs, not module specifiers, so they keep the extension
- Node ≥24, pnpm 11.13.1 (pinned `packageManager`)
- No Playwright, no database, no auth by design (tool profile)

## Model and cache

The detection weights are large and are never committed. `.gitignore` excludes `*.onnx`, `*.onnx_data`, `.cache/` and `*.traineddata`; the browser writes weights to browser storage in ranges so a refresh resumes, and the CLI caches them under `~/.cache/localveil/models`. A test that needs a real file on disk reads from `fixtures/`.

## Notable decisions

- Everything runs client-side. A change that introduces a network call for anything but the weights and a Tesseract language pack breaks the product's core promise.
- Workers are addressed by URL (`new URL("model-worker.ts", import.meta.url)`), not by import specifier, so those strings keep their extension.
- This repo is registered in the orchestrator (`~/dev/orchestrator`) as the `tool` profile's base: its tsconfig presets and root devDependency versions are the verifier baseline for that profile. Change them deliberately.
