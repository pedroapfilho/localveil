# Plan 006: Re-detect the redacted output and warn when anything survived

> **Executor instructions**: Follow this plan step by step. Run every verification command
> and confirm the expected result before moving to the next step. If anything in the "STOP
> conditions" section occurs, stop and report. Do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7fdfa30..HEAD -- packages/redact-core packages/redact-text packages/redact-image packages/redact-pdf`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

localveil has no check that its own output is clean. Detection finds spans, geometry turns
spans into rectangles, and a canvas paints them, and nothing anywhere confirms that the thing
handed back no longer contains what was found. Every one of those steps has a plausible failure
that produces a file that looks redacted and is not:

- A rectangle that lands a few pixels short leaves the first letter of a name showing. The
  README already records this failure mode for a different reason (splitting a run's box by
  character count "drifts by a whole character on a proportional font, which leaves the first
  letter of a name showing").
- The PDF path redraws every surviving word as invisible text
  (`packages/redact-pdf/src/index.ts:186-203`). `isCovered` decides which words to skip, and it
  is a rectangle-overlap test (`packages/redact-pdf/src/covered.ts`). A word whose box overlaps
  a rect by one pixel is treated as covered; a word the paint missed is written back into the
  searchable layer in full. A black box with the name still selectable underneath it is the
  exact failure this product exists to prevent.
- A span whose coordinates come back reversed or off by one produces a mask that misses.

The fix is cheap because the machinery already exists. After redaction, extract the text that
survives in the output and run the same `detect` over it. If anything comes back, the file
carries a warning. That turns a class of silent, invisible failures into a visible one, and it
is a claim the product can make: localveil checks its own work.

This is not a guarantee of correctness. The detector missed things on the way in and will miss
them on the way out. It catches the geometry and plumbing failures, which are the ones the user
has no way to notice.

## Current state

### Where output text can be re-read

**Text** (`packages/redact-text/src/index.ts:41-48`): the masked string is right there before it
becomes a `Blob`. Covered graphemes are replaced with `█`
(`packages/redact-text/src/mask.ts:5`), and line breaks survive. Re-running `detect` over the
masked string is a direct call with no extraction step.

**PDF** (`packages/redact-pdf/src/index.ts:186-203`): the invisible text layer is written word
by word from `page.words`, skipping words where `isCovered(word.bbox, rects)` is true. The
surviving text is therefore knowable without reparsing the output: it is exactly the words that
were **not** skipped, joined. Collect them during the existing loop.

**Image** (`packages/redact-image/src/index.ts`): the same shape on one page. The surviving
words are those whose boxes were not covered.

### The warning mechanism to extend

`packages/redact-core/src/types.ts:41-46`:

```ts
type WarningKey =
  "warning.droppedCharacters" | "warning.lowConfidence" | "warning.noText" | "warning.scannedPages";
```

Warnings are collected in a `Set<WarningKey>` and returned on `RedactionResult`
(`packages/redact-pdf/src/index.ts:80,213-217`). `apps/web/src/components/job-row.tsx` already
renders them in the details panel, and `packages/i18n` holds one message per key in `en`, `pt`
and `es`. Adding a key requires all three locales or typecheck fails.

### Repo conventions to match

- Arrow functions, `const` over `let`, exports at the end, alphabetically sorted keys and union
  members. `WarningKey` is alphabetical; the new key must be inserted in order.
- **No comments that restate the code.**
- Warning message copy explains what the user should do, not just what happened. Read the
  existing three in `packages/i18n` and match their register in all three languages.

## Commands you will need

| Purpose   | Command                                       | Expected on success        |
| --------- | --------------------------------------------- | -------------------------- |
| Install   | `pnpm install`                                | exit 0                     |
| Typecheck | `pnpm typecheck`                              | exit 0                     |
| Tests     | `pnpm test`                                   | all pass                   |
| Lint      | `pnpm lint`                                   | exit 0                     |
| CLI check | `pnpm --filter cli start fixtures/sample.pdf` | writes `localveil.zip`     |
| Dev       | `pnpm dev --filter=web`                       | serves on `localhost:5173` |

## Scope

**In scope**:

- `packages/redact-core/src/types.ts`: one new `WarningKey`.
- `packages/redact-core/src/verify.ts` (create) and `verify.test.ts`: the shared check.
- `packages/redact-text/src/index.ts`, `packages/redact-image/src/index.ts`,
  `packages/redact-pdf/src/index.ts`: call the check before returning.
- `packages/i18n/`: the new message in `en`, `pt` and `es`.
- Tests beside each changed file.
- `README.md`: one paragraph under "How a file is redacted".

**Out of scope** (do NOT touch):

- `packages/pii-detect/**`. The check reuses the `Detect` function each redactor already holds.
- `packages/redact-core/src/rects.ts`, `patterns.ts`, `repeats.ts`. If the check finds a real
  geometry bug, report it; do not fix it in this plan. Fixing the bug and adding the detector
  that found it in one change makes both unreviewable.
- `packages/redact-pdf/src/covered.ts`. Same reason.
- Any behaviour that **blocks** output. The check warns; it never refuses to produce a file. A
  user with a partly-redacted file and a warning is better served than a user with nothing.

## Git workflow

- Branch: `advisor/006-verify-output`
- Conventional commit, e.g. `feat(redact-core): warn when detections survive into the output`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the shared check

Create `packages/redact-core/src/verify.ts` exporting:

```ts
type Survivor = { label: PiiLabel; score: number; text: string };

const survivingSpans = async (text: string, detect: Detect): Promise<Array<Survivor>> => { ... };
```

It runs `detect` over the given text and returns one entry per span, with `text` set to the
matched substring truncated to 80 graphemes. Skip any span whose matched substring consists
only of `█` and whitespace: the text redactor's masked output is a legitimate input to this
check, and a run of blocks is the mask working, not a survivor.

Export it from `packages/redact-core/src/index.ts` alongside the existing exports.

**Verify**: `pnpm --filter @repo/redact-core test` passes with new cases: a clean string returns
empty, a string containing an email returns one survivor, a string of `█` returns empty, and a
long match is truncated to 80 graphemes without splitting one.

### Step 2: Add the warning key and its messages

Insert `"warning.notFullyRedacted"` into the `WarningKey` union in
`packages/redact-core/src/types.ts`, in alphabetical position (between
`warning.lowConfidence` and `warning.noText`).

Add the message to all three locales in `packages/i18n`. The English copy must tell the user
what to do, in the register of the existing warnings: that something the detector recognises is
still readable in the result and the file should be checked by hand before it is sent anywhere.

**Verify**: `pnpm typecheck` exits 0 (a missing locale fails here), `pnpm test` passes.

### Step 3: Wire it into the text redactor

In `packages/redact-text/src/index.ts`, after `maskSpans` and before building the `Blob`, call
`survivingSpans(masked, detect)` and add `"warning.notFullyRedacted"` when it returns anything.

**Verify**: `pnpm --filter @repo/redact-text test` passes with a new test: a document where a
deliberately mis-positioned span leaves an email intact produces the warning, and a normally
redacted document does not.

### Step 4: Wire it into the PDF and image redactors

Collect the surviving words during the existing invisible-text loop in
`packages/redact-pdf/src/index.ts:186-203` (the words for which `isCovered` returned false),
join them with single spaces per page, and run the check once per document over the
concatenation rather than once per page, so a name split across a page boundary is not
re-detected spuriously and so the cost is one detection call per file.

Do the same in `packages/redact-image/src/index.ts` for the single page.

The check costs one extra `detect` call per document. Detection is globally serialised by
`serialiseDetect` in `packages/redact-core/src/detect-rpc.ts`, so this adds to the queue. Report
the measured cost on `fixtures/sample.pdf` as a fraction of total time. If it exceeds 15%, say
so in your report; do not add a configuration flag to disable it without being asked.

**Verify**: `pnpm --filter @repo/redact-pdf test` and `pnpm --filter @repo/redact-image test`
pass with a new test each: a document where a word's box is deliberately offset so paint misses
it produces the warning; a normal document does not.

### Step 5: Run it against the fixtures

Run every file in `fixtures/` through the CLI and record which ones raise the new warning.

This is the interesting part of the plan. If a fixture raises it, there is a real geometry or
plumbing bug in the current code, found by the check. **Do not fix it here.** Record the file,
the surviving text, and the label, and report it. That becomes its own finding with its own
plan.

**Verify**: a table in your report with one row per fixture and whether the warning fired.

### Step 6: Document it

Add a short paragraph to the "How a file is redacted" section of `README.md` describing the
check and being explicit about its limit: it re-reads the output with the same detector, so it
catches painting and plumbing failures, not detection misses. Keep the existing voice; never
use an em dash.

**Verify**: `pnpm format:check` exits 0, `pnpm lint` exits 0, `pnpm typecheck` exits 0,
`pnpm test` exits 0.

## Test plan

New tests, following the structure of the existing cases in each file:

- `packages/redact-core/src/verify.test.ts`: the four cases from step 1.
- `packages/redact-text/src/index.test.ts`: warning fires on a deliberately mis-positioned span;
  does not fire on normal output; does not fire on a document that is entirely `█`.
- `packages/redact-pdf/src/redact.test.ts`: warning fires when a word box is offset past its
  rect; does not fire normally; fires once per document rather than once per page.
- `packages/redact-image/src/index.test.ts`: the first two of those.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `pnpm test` exits 0 with at least 9 new tests
- [ ] `warning.notFullyRedacted` exists in `en`, `pt` and `es`
- [ ] A fixture table from step 5 is in the report
- [ ] `git status` shows no changes under `packages/pii-detect/`, `rects.ts`, `covered.ts` or
      `patterns.ts`
- [ ] No code path can refuse to produce a `Blob` because of this check
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The check fires on most or all fixtures. That means either the check is wrong, or there is a
  systemic redaction bug. Either way it needs a decision before shipping a warning that always
  appears.
- Adding the second `detect` call per document more than doubles wall-clock on
  `fixtures/sample.pdf`. Report the measurement.
- The text redactor's own `█` output is detected as a survivor and the skip rule in step 1 does
  not suppress it cleanly.
- You are tempted to fix a geometry bug the check uncovers. Out of scope by design. Record it.

## Maintenance notes

- The most likely first genuine finding is not geometry but the repeat pass. `spansForTokens`
  in `packages/redact-core/src/repeats.ts` builds its pattern with the `i` flag but no diacritic
  folding, so a name tagged as "João" does not cover "JOAO" produced by an OCR pass that dropped
  the tilde. If the fixture table in step 5 shows survivors that are accent-stripped versions of
  covered names, that is the cause, and it deserves its own small plan.
- If plan 003 lands, this check should run after the user's dismissals are applied, not before,
  and a survivor that the user deliberately dismissed must not raise the warning. Note that
  ordering when the two meet.
- A reviewer should scrutinise: that the check never blocks output, that it runs once per
  document rather than once per page, and that the `█` skip rule cannot mask a real survivor
  that happens to sit next to a block character.
