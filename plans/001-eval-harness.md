# Plan 001: Build a scored detection eval harness for English, Portuguese and Spanish

> **Executor instructions**: Follow this plan step by step. Run every verification command
> and confirm the expected result before moving to the next step. If anything in the "STOP
> conditions" section occurs, stop and report. Do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7fdfa30..HEAD -- packages/pii-detect packages/redact-core`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

localveil has about 500 unit tests and zero accuracy tests. Nothing in the repo can answer
"does this change find more personal data or less." Every knob that governs whether a name
gets covered was set by argument rather than measurement: the 0.35 score floor, the 280-word
chunk, the 24-word overlap, the 12-word span cap, the shouting retry, the choice of the 24
entity prompts, and the choice of `model_q4.onnx` over the smaller exports.

That gap blocks the three changes with the largest payoff. Re-exporting the weights to cut
the 894 MB download (plan 002), batching inference (plan 005), and evaluating any replacement
checkpoint all change what the model outputs. Without a score, a regression that only shows up
on Brazilian documents ships silently and the user finds out when a CPF stays readable.

After this lands, `pnpm --filter eval start` prints span-level precision, recall and F1 per
label per language, and any of those changes becomes a number instead of an opinion.

## Current state

### The detection entry point you will call

`packages/pii-detect/src/detector.ts` exports `createDetector`, which resolves to a
`Detect` function. Excerpt from `packages/pii-detect/src/detector.ts:74-89`:

```ts
const createDetector = async (options: DetectorOptions = {}): Promise<Detect> => {
  const {
    maxWords = MAX_WORDS,
    minScore = MIN_SCORE,
    onProgress,
    overlapWords = OVERLAP_WORDS,
    resumableCache = "caches" in globalThis,
  } = options;
```

And its return, `packages/pii-detect/src/detector.ts:184-209`:

```ts
  return serialiseDetect(async (text) => {
    const chunks = chunkWords(splitWords(text), maxWords, overlapWords);
    ...
    return [...mergeChunkSpans(parts), ...patternSpans(text)];
  });
```

`resumableCache` defaults to `"caches" in globalThis`, which is `false` under Node, so the
harness gets the plain fetch path. The Node build of the runtime lives in
`packages/pii-detect/src/ort-node.ts` and is selected by the `#ort` import condition
(see `packages/pii-detect/package.json` for the `imports` map).

### The span shape you will score against

`packages/redact-core/src/types.ts:1-11`:

```ts
type PiiLabel =
  | "account_number"
  | "private_address"
  | "private_date"
  | "private_email"
  | "private_person"
  | "private_phone"
  | "private_url"
  | "secret";

type Span = { end: number; label: PiiLabel; score: number; start: number };
```

`start` and `end` are character offsets into the text passed to `detect`. `end` is
exclusive at the pattern layer (`patternSpans` in `packages/redact-core/src/patterns.ts:164`
uses `match.index + match[0].length`), so treat all spans as half-open `[start, end)`.

### The pattern layer that runs alongside the model

`packages/redact-core/src/patterns.ts` exports `patternSpans(text)`, which contributes
checksum-verified CPF, CNPJ, IBAN, Luhn card, RG, CNH, CEP, `dd/mm/yyyy` dates, emails and
phone numbers. It is part of what `detect` returns, so the harness scores model and patterns
together by default. Make the split visible: the harness must also be able to score
`patternSpans` alone, so a future model change cannot be credited for what a regex found.

### Repo conventions to match

- **Exports at the end of the file**, one `export { ... }` and one `export type { ... }`.
  See `packages/redact-core/src/patterns.ts:177` and `packages/redact-core/src/types.ts:64-82`.
- **Arrow functions only**, `const` over `let`, `type` over `interface`.
- **Object properties and union members sorted alphabetically.** This is enforced by oxlint;
  see `Span` above and every options type in the repo.
- **No comments that restate the code.** A comment is allowed only when it carries something
  the file cannot show (an external system's behaviour, a citation for a magic number).
  `packages/redact-core/src/patterns.ts` has zero comments across 177 lines. Match that.
- **File names are kebab-case.** Tests sit beside their subject as `<name>.test.ts`.
- **Max 400 lines per file.** Split into focused modules before exceeding it.

### Package scaffolding to copy

`packages/ocr/package.json` is the exemplar for a leaf package:

```json
{
  "name": "@repo/ocr",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "clean": "rm -rf node_modules coverage",
    "lint": "oxlint",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@repo/redact-core": "workspace:*", "tesseract.js": "^7.0.0" },
  "devDependencies": {
    "@repo/config-vitest": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

`packages/ocr/vitest.config.ts` is a single line: `export { default } from "@repo/config-vitest/node";`.

The workspace globs are `apps/*` and `packages/*` in `pnpm-workspace.yaml`, so a new
directory under `packages/` is picked up without editing that file.

## Commands you will need

| Purpose     | Command                          | Expected on success          |
| ----------- | -------------------------------- | ---------------------------- |
| Install     | `pnpm install`                   | exit 0                       |
| Typecheck   | `pnpm typecheck`                 | exit 0, no errors            |
| Tests       | `pnpm test`                      | all pass                     |
| Scoped      | `pnpm --filter @repo/eval test`  | all pass                     |
| Lint        | `pnpm lint`                      | exit 0                       |
| Format      | `pnpm format:check`              | exit 0                       |
| Run harness | `pnpm --filter @repo/eval start` | prints a score table, exit 0 |

## Scope

**In scope** (create these):

- `packages/eval/package.json`
- `packages/eval/tsconfig.json`
- `packages/eval/vitest.config.ts`
- `packages/eval/src/index.ts`
- `packages/eval/src/score.ts` and `packages/eval/src/score.test.ts`
- `packages/eval/src/corpus.ts` and `packages/eval/src/corpus.test.ts`
- `packages/eval/src/report.ts` and `packages/eval/src/report.test.ts`
- `packages/eval/src/run.ts`
- `packages/eval/corpus/*.json` (the labelled documents)

**Out of scope** (do NOT modify):

- `packages/pii-detect/src/**` and `packages/redact-core/src/**`. This plan measures the
  detector; it does not change it. If the harness reveals a bug, record it in the run output
  and report back rather than fixing it here.
- `apps/web/**` and `apps/cli/**`.
- `README.md`. Documentation for this package is a separate decision.
- The `MIN_SCORE`, `MAX_WORDS` and `OVERLAP_WORDS` constants. Tuning them is what the harness
  is _for_, in a later change.

## Git workflow

- Branch: `advisor/001-eval-harness`
- Conventional commits. Recent history for the style:
  `feat(web): report the model download in a toast, not a page-wide bar`,
  `fix: preserve redactions across OCR retries`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Scaffold the package

Create `packages/eval/` mirroring `packages/ocr/`:

- `package.json`: name `@repo/eval`, private, type module, the same six scripts as `@repo/ocr`
  plus `"start": "tsx src/run.ts"`. Dependencies: `@repo/pii-detect": "workspace:*"` and
  `@repo/redact-core": "workspace:*"`. Dev dependencies: `@repo/config-vitest`,
  `@repo/typescript-config`, `tsx`, `typescript`, `vitest` at the versions used by
  `apps/cli/package.json` (read it; do not guess).
- `tsconfig.json`: copy `packages/ocr/tsconfig.json` verbatim.
- `vitest.config.ts`: `export { default } from "@repo/config-vitest/node";`

**Verify**: `pnpm install` exits 0, then `pnpm --filter @repo/eval typecheck` exits 0.

### Step 2: Define the corpus format and write the scorer

Create `packages/eval/src/corpus.ts` with these types and a loader:

```ts
type LabelledSpan = { end: number; label: PiiLabel; start: number };

type EvalDocument = {
  id: string;
  language: "en" | "es" | "pt";
  source: "handwritten" | "synthetic";
  spans: Array<LabelledSpan>;
  text: string;
};
```

The loader reads every `*.json` under `packages/eval/corpus/`, validates that each `spans`
entry satisfies `0 <= start < end <= text.length`, and throws a `TypeError` naming the
offending document id when it does not. Do not add a schema library; a hand-written guard
matches the repo (see `isNumberArray` in `packages/pii-detect/src/gliner-decode.ts:7-19`).

Create `packages/eval/src/score.ts` exporting:

```ts
type Counts = { falseNegative: number; falsePositive: number; truePositive: number };
type LabelScore = Counts & { f1: number; precision: number; recall: number };
```

Matching rules, which the tests must pin:

1. A predicted span matches an expected span when the labels are equal and the character
   ranges **overlap by at least one character**. Exact-boundary matching punishes the model
   for including a title or trailing punctuation, which does not matter when the output is a
   black rectangle over the region.
2. Matching is one-to-one and greedy by overlap length, so two predictions over one expected
   span produce one true positive and one false positive.
3. Report a second, stricter figure alongside it: **exact-boundary** precision/recall, so
   boundary drift is visible rather than hidden by rule 1.

**Verify**: `pnpm --filter @repo/eval test` passes with the new `score.test.ts` covering:
one exact match, one partial overlap, a label mismatch on an overlapping range, two
predictions over one expected span, an empty prediction set, and an empty expected set
(precision must be defined, not `NaN`).

### Step 3: Build the corpus

Create at least **30 documents** under `packages/eval/corpus/`, distributed as:

- 12 Portuguese (Brazilian), 9 English, 9 Spanish.
- Across shapes: prose paragraphs, an invoice, a CSV row block, a log excerpt, a JSON
  payload, an ID-card field dump (the `nome` / `filiação` / `RG` / `CPF` layout), and one
  all-capitals document to exercise the shouting retry in
  `packages/pii-detect/src/shouting.ts`.
- Every span in `PiiLabel` must appear at least three times overall and at least once in
  Portuguese.

Every value must be **invented**. Generate CPF, CNPJ, IBAN and card numbers that pass their
own check digits by construction, using the verifiers already in
`packages/redact-core/src/patterns.ts` (`isCpf`, `isCnpj`, `isIban`, `luhn` are all exported)
to confirm. Reuse the invented people already in `fixtures/` so the corpus and the fixtures
tell the same story. Do not copy any real document, and do not fetch any dataset containing
real personal data.

Include **negative material** deliberately: an invoice number that has the shape of a CPF but
fails its check digits, a year range like `2019-2024`, an acronym-heavy log line, and a
sentence containing common Portuguese nouns that a name detector over-predicts on (`Estado`,
`Câmara`, `Silva` used as a street name). These are the cases where precision is lost, and a
corpus without them will rate an over-predicting model as excellent.

Add `packages/eval/corpus/README.md` stating in one paragraph that every value is invented
and how to add a document.

**Verify**: `pnpm --filter @repo/eval test` passes with `corpus.test.ts` asserting: every
document loads, every span range is in bounds, every `PiiLabel` appears at least three times,
Portuguese covers every label at least once, and every CPF/CNPJ/IBAN/card literal in the
corpus passes its verifier from `@repo/redact-core`.

### Step 4: Wire the runner

Create `packages/eval/src/run.ts`. It must:

1. Build a detector with `createDetector({ resumableCache: false })` and report download
   progress to stderr so a first run does not look hung.
2. Run every corpus document through it, collecting predicted spans.
3. Also run `patternSpans(document.text)` alone, so the report can attribute credit.
4. Print a table to stdout with one row per label and one row per language, plus a totals row,
   showing overlap-precision, overlap-recall, F1, and the exact-boundary pair. Print the
   pattern-only totals as a separate block.
5. Write the full per-document result to `packages/eval/results/<ISO-date>.json` and print
   that path. Add `packages/eval/results/` to `.gitignore`.
6. Accept `--filter <substring>` to run a subset by document id, and `--json` to skip the
   table and emit only the JSON.
7. Exit 0 on completion regardless of scores. This is a measurement tool, not a gate. A
   threshold gate is a later decision, and hard-coding one now would block plan 002.

Keep the table formatting in `packages/eval/src/report.ts` as a pure function from results to
string, so it is unit-testable without running the model.

**Verify**: `pnpm --filter @repo/eval test` passes with `report.test.ts` covering the
formatter on a fixed result object. Then run `pnpm --filter @repo/eval start` and confirm it
prints a table with a non-zero recall on the totals row and writes the JSON file. Record the
totals row in your report back.

### Step 5: Record the baseline

Create `packages/eval/BASELINE.md` containing the totals table from step 4 verbatim, the
commit SHA it was measured at, the model id and revision from
`packages/pii-detect/src/detector.ts:21-23` (`onnx-community/gliner_multi_pii-v1`, revision
`2e0397a7e8a250d76c37122232b3cbde42c8d629`), the model file from
`packages/pii-detect/src/model-runtime.ts` (`model_q4.onnx`), and the device it ran on.

This file is what plans 002, 005 and 007 compare against. Without it they have nothing.

**Verify**: `pnpm lint` exits 0, `pnpm format:check` exits 0, `pnpm typecheck` exits 0,
`pnpm test` exits 0.

## Test plan

New test files, modelled structurally on `packages/redact-core/src/patterns.test.ts` (flat
`describe`/`it`, no mocks, table-driven cases):

- `packages/eval/src/score.test.ts`: the six matching cases listed in step 2, plus
  precision and recall when both sets are empty.
- `packages/eval/src/corpus.test.ts`: the five corpus invariants listed in step 3, plus a
  rejection case where a document declares a span past the end of its text.
- `packages/eval/src/report.test.ts`: stable formatting for a fixed result object, including
  a label with zero expected spans.

Do not write a test that runs the model. Model inference belongs in `run.ts`, which is
invoked by hand and in CI on demand, not in `pnpm test`.

## Done criteria

ALL must hold:

- [ ] `pnpm install` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `pnpm test` exits 0, with at least 15 new tests under `packages/eval`
- [ ] `pnpm --filter @repo/eval start` exits 0 and prints a totals row with recall > 0
- [ ] `packages/eval/corpus/` holds at least 30 documents, at least 12 of them `"language": "pt"`
- [ ] `packages/eval/BASELINE.md` exists and records the totals table plus the model revision
- [ ] `git status` shows no modified files outside `packages/eval/` and `.gitignore`
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `createDetector` cannot be constructed under Node without a browser `caches` global. The
  detector defaults `resumableCache` to `"caches" in globalThis`; if passing `false`
  explicitly is not enough, report the failure rather than editing `packages/pii-detect`.
- Downloading the weights fails or exceeds 20 minutes. Report it; do not switch to a
  different model file to make the run finish.
- The corpus you generate produces a totals recall below 0.20 or above 0.95. Both suggest the
  corpus is wrong rather than the model: near-zero usually means a span-offset bug, near-one
  usually means the documents are too easy to be diagnostic. Report the table and stop.
- You find yourself wanting to change a constant in `packages/pii-detect` to improve a score.
  That is out of scope by design. Record it and report.

## Maintenance notes

- The corpus is the asset; the harness is scaffolding around it. When someone reports a miss
  in the wild, the fix is to add a document reproducing it, not to add a regex.
- Overlap matching (rule 1) is deliberately lenient because the product paints rectangles.
  If localveil ever gains a "replace with a token" output mode, exact-boundary scoring
  becomes the primary figure and the report ordering should flip.
- A reviewer should scrutinise: whether any corpus value is real (it must not be), whether
  greedy overlap matching is one-to-one, and whether the pattern-only block is genuinely
  computed separately rather than derived by subtraction.
- Deliberately deferred: a CI gate on the scores, and running the harness against alternative
  checkpoints. The second is what plan 002 uses this for, and both need a baseline first.
