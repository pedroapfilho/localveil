# Plan 003: Let the user review detections before the file is written

> **Executor instructions**: Follow this plan step by step. Run every verification command
> and confirm the expected result before moving to the next step. If anything in the "STOP
> conditions" section occurs, stop and report. Do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7fdfa30..HEAD -- packages/redact-core packages/redact-text packages/redact-image packages/redact-pdf apps/web apps/cli`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

localveil detects and writes in one motion. The user drops a file and receives a ZIP; nothing
in between lets them see what was found, and the README's own Limits section says "the model
misses things" and "read the output before you send it anywhere." The product asks the user to
audit the result without giving them any tool for it.

Every comparable product has solved this: SafeRedact classifies each detection with a
confidence score and lets you approve or dismiss it, PII Blackout lets you deselect false
positives before applying a permanent blackout, and RedactProof builds its compliance story on
the same verification step. Across 2026 vendor comparisons a human-in-the-loop review
interface with approve and reject actions is repeatedly named the distinguishing capability.
SafeRedact only achieves it by sending extracted text and coordinates to a server, which is
exactly the thing localveil does not need to do.

A review step is also the precondition for raising recall. Today the 0.35 score floor
(`packages/pii-detect/src/detector.ts:30`) has to serve two conflicting jobs at once: catch
everything, and avoid painting boxes over ordinary words. With a reviewer in the loop, those
jobs separate. Detections above the floor apply automatically, detections below it are
surfaced as suggestions, and the higher-recall models that are otherwise unusable (GLiNER2-PII
posts .75 recall against .35 precision) become options.

After this lands, a user sees every detection with its label and confidence, can dismiss the
wrong ones and add anything missed, and only then gets the file.

## Current state

### The contract that has to change

`packages/redact-core/src/types.ts:47-58`:

```ts
type RedactionResult = {
  blob: Blob;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

type Redactor = {
  accepts: (file: File) => boolean;
  redact: (
    file: File,
    detect: Detect,
    onProgress: FileProgress,
    options?: RedactOptions,
  ) => Promise<RedactionResult>;
};
```

One call goes from `File` to `Blob`. There is no point at which the caller can see what was
found. That single-phase shape is the thing this plan splits.

### What each redactor knows at the point of decision

**Text** (`packages/redact-text/src/index.ts:33-40`) has the whole document as a string and a
flat array of spans over it:

```ts
const detected = await detect(text);

const spans = [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))];
```

**PDF** (`packages/redact-pdf/src/index.ts:146-155`) accumulates one entry per page and only
paints in a second loop:

```ts
const { text, words } = buildWordIndex(legibleWords(reading));
const spans = await detect(text);

for (const token of tokensFromSpans(text, spans)) {
  tokens.set(token.text.toLowerCase(), token);
}

read.push({ spans, text, words });
page.cleanup();
```

That two-pass structure is a gift: pass one already produces everything a reviewer needs, and
pass two already re-renders rather than holding canvases. The README explains why, and it must
stay that way: "Pages are rendered a second time for painting rather than held in memory,
because a hundred A4 canvases is most of a gigabyte."

**Image** (`packages/redact-image/src/index.ts`) follows the same recognise-then-paint shape on
a single page.

### How the web app drives it

`apps/web/src/worker-protocol.ts`:

```ts
type RedactTask = (
  file: File,
  language: DocumentLanguage | undefined,
  port: MessagePort,
) => RedactionResult;
```

and `apps/web/src/store.ts` holds one `Job` per file with `progress`, `stage`, `status` and an
optional `result: { blob, redactionCount, warnings }`. `apps/web/src/components/job-row.tsx`
renders a job as an `Attachment` with a `Collapsible` details panel already wired for
language choice and warnings; that panel is where review lives.

### Repo conventions to match

- Exports at the end of the file, arrow functions, `const` over `let`, `type` over `interface`,
  object keys and union members sorted alphabetically.
- **No comments that restate the code.** See `packages/redact-core/src/rects.ts`: 46 lines,
  zero comments.
- Components use `@repo/ui` primitives over Base UI (`Attachment`, `Collapsible`, `Checkbox`,
  `Progress`, `Button`, `ScrollArea`). Read `apps/web/src/components/job-row.tsx:1-25` for the
  import shape. Do not introduce a new component library.
- **Every user-visible string is a typed message key** in `@repo/i18n`, with entries for `en`,
  `pt` and `es`. `MessageKey` is a union; adding a key without all three locales fails
  typecheck.
- Icon-only buttons need `aria-label`. Lists of interactive rows need keyboard support.
  See the project UI rules: targets at least 24px, `:focus-visible` rings, `aria-live` for
  status changes.
- Max 400 lines per file.

## Commands you will need

| Purpose    | Command                                       | Expected on success               |
| ---------- | --------------------------------------------- | --------------------------------- |
| Install    | `pnpm install`                                | exit 0                            |
| Typecheck  | `pnpm typecheck`                              | exit 0                            |
| Tests      | `pnpm test`                                   | all pass                          |
| Scoped     | `pnpm --filter web test`                      | all pass                          |
| Lint       | `pnpm lint`                                   | exit 0                            |
| Format     | `pnpm format:check`                           | exit 0                            |
| Dev server | `pnpm dev --filter=web`                       | serves on `http://localhost:5173` |
| CLI        | `pnpm --filter cli start fixtures/sample.pdf` | writes `localveil.zip`            |

## Scope

**In scope**:

- `packages/redact-core/src/types.ts`: add the two-phase types.
- `packages/redact-text/src/index.ts`, `packages/redact-image/src/index.ts`,
  `packages/redact-pdf/src/index.ts`: split each `redact` into `analyse` and `apply`.
- `packages/redact-core/src/registry.ts` if it dispatches on the `Redactor` shape.
- `apps/web/src/worker-protocol.ts`, `redact-worker.ts`, `worker-pool.ts`, `use-redaction.ts`,
  `store.ts`.
- `apps/web/src/components/`: a new `detection-review.tsx` and `detection-row.tsx`, plus
  changes to `job-row.tsx` and `download-panel.tsx`.
- `packages/i18n/`: new message keys in all three locales.
- `apps/cli/src/run-redaction.ts`: keep the CLI on the non-interactive path (analyse then
  immediately apply everything).
- Tests beside each changed file.

**Out of scope** (do NOT touch):

- `packages/pii-detect/**`. This plan changes nothing about detection. In particular, do NOT
  lower `MIN_SCORE` in `packages/pii-detect/src/detector.ts:30`. The two-threshold policy is a
  follow-up that this plan merely makes possible; changing the floor and the UI in one change
  makes both unreviewable.
- `packages/redact-core/src/patterns.ts`, `rects.ts`, `repeats.ts`, `word-index.ts`.
- Any visual overlay of boxes on a rendered page. This plan ships a **list** review. A canvas
  overlay is a follow-up, and attempting it here will blow the scope.
- The ZIP format and `packages/redact-core/src/zip.ts`.

## Git workflow

- Branch: `advisor/003-review-before-export`
- Conventional commits, e.g. `feat(web): let the user dismiss detections before export`.
- Commit per step; the codebase must typecheck at every commit.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the two-phase types to `@repo/redact-core`

In `packages/redact-core/src/types.ts`, add:

```ts
type Detection = {
  confidence: number;
  id: string;
  label: PiiLabel;
  page?: number;
  preview: string;
  source: "model" | "pattern" | "repeat" | "user";
};

type Analysis = {
  detections: Array<Detection>;
  handle: unknown;
  warnings: Array<WarningKey>;
};

type Decisions = { dismissed: ReadonlySet<string> };

type Redactor = {
  accepts: (file: File) => boolean;
  analyse: (
    file: File,
    detect: Detect,
    onProgress: FileProgress,
    options?: RedactOptions,
  ) => Promise<Analysis>;
  apply: (
    analysis: Analysis,
    decisions: Decisions,
    onProgress: FileProgress,
  ) => Promise<RedactionResult>;
};
```

`preview` is the covered text itself for text files, and the recognised words under the span
for PDFs and images. It is what the reviewer reads, so it must be the actual matched string,
truncated to 80 graphemes.

`handle` carries whatever a redactor needs to finish (for text: the string and the span list;
for PDF: the per-page `{ spans, text, words }` array and the source bytes). It must be
**structured-cloneable**, because it crosses the worker boundary, and it must **not** contain
rendered canvases or image bitmaps. Re-rendering in `apply` is the existing design and stays.

**Verify**: `pnpm --filter @repo/redact-core typecheck` exits 0. `pnpm test` still passes
(nothing consumes the new types yet).

### Step 2: Split the text redactor

Rewrite `packages/redact-text/src/index.ts` so `analyse` reads the file, detects, expands
repeats, and returns one `Detection` per merged span with `preview` set to
`text.slice(start, end)` and `source` distinguishing model spans (score < 1) from pattern spans
(score === 1, as set in `packages/redact-core/src/patterns.ts:170`) from repeat expansions
(the extra spans produced by `spansForTokens`). `apply` filters out dismissed ids and calls
`maskSpans` on what remains.

`redactionCount` must keep its current meaning: `mergeOverlappingRanges(spans).length` over
the spans actually applied.

**Verify**: `pnpm --filter @repo/redact-text test` passes, including a new test asserting that
dismissing every detection yields output byte-identical to the input, and that dismissing none
yields output identical to today's `redact`.

### Step 3: Split the image and PDF redactors

Same split. For PDF, `analyse` is the existing first loop up to and including
`read.push({ spans, text, words })`, and `apply` is the existing second loop. Assign each
detection a stable `id` (`${pageNumber}:${start}-${end}` is sufficient and deterministic) and
set `page` so the reviewer can see where it came from.

The cross-page token propagation currently happens between the loops
(`packages/redact-pdf/src/index.ts:157`, `const everyToken = [...tokens.values()]`). Those
propagated spans must appear in `analyse`'s detections with `source: "repeat"`, otherwise the
reviewer sees a box they were never shown. Compute them at the end of `analyse` and store them
in `handle`.

**Verify**: `pnpm --filter @repo/redact-pdf test` and `pnpm --filter @repo/redact-image test`
pass. Add a test to each asserting that `apply` with an empty `dismissed` set produces the same
`redactionCount` as the pre-split `redact` did on the same fixture.

### Step 4: Carry the analysis across the worker boundary

Change `apps/web/src/worker-protocol.ts` so the worker exposes two tasks instead of one:
`analyseTask` returning `Analysis`, and `applyTask` taking the analysis handle plus decisions
and returning `RedactionResult`. Keep the `MessagePort` model connection exactly as it is.

The analysis must survive `postMessage`. Confirm this explicitly rather than assuming: add a
test in `apps/web/src/worker-pool.test.ts` that round-trips a representative `Analysis` through
`structuredClone` and asserts deep equality. If any redactor's `handle` fails that, fix the
handle, not the test.

Add to `apps/web/src/store.ts`: `analysis?: Analysis`, `dismissed: Set<string>`, and a
`"reviewing"` value in `JobStatus`. A job goes `queued` then `running` then **`reviewing`**
then `running` again then `done`.

**Verify**: `pnpm --filter web test` passes, including the `structuredClone` round-trip.

### Step 5: Build the review UI

Create `apps/web/src/components/detection-review.tsx` and `detection-row.tsx`.

Requirements, all of which are checkable:

- One row per detection: the `preview` text, a label chip, the confidence as a percentage with
  **tabular numerals**, the page number when present, and a checkbox that keeps or dismisses it.
- Group rows by label, with a per-group "dismiss all" control. Sort within a group by
  confidence, lowest first, because the low-confidence rows are the ones worth a human's eye.
- Never use colour alone to signal confidence. Pair any colour with text or an icon.
- Rows are keyboard reachable and toggleable with Space; the group header is a real button.
- The count of kept detections is announced through `aria-live="polite"` when it changes.
- Virtualise the list with `virtua` when it exceeds 100 rows. A scanned 40-page document
  produces hundreds.
- An "Apply redactions" button, enabled from the moment review opens, that moves the job to
  `running` and calls `applyTask`.
- A "Keep everything" button that skips review entirely for that job.

Add the message keys to `packages/i18n` for `en`, `pt` and `es`. Every new string goes through
`useTranslations`; do not hard-code English anywhere.

Render the review inside the existing `Collapsible` panel in
`apps/web/src/components/job-row.tsx`, which already handles the open state and the details
layout.

**Verify**: `pnpm --filter web test` passes with new tests in `detection-review.test.tsx`
covering: rows render with label and confidence, toggling a checkbox changes the kept count,
"dismiss all" in a group clears that group only, the apply button fires with the right
dismissed set, and the list is keyboard operable. Then `pnpm dev --filter=web`, drop
`fixtures/sample.pdf`, and confirm review appears with detections listed before any file is
produced.

### Step 6: Add a global preference and keep the CLI non-interactive

Add a single toggle beside the dropzone: "Review before exporting", defaulting to **on**.
Persist it in `localStorage` alongside the existing language choice. When off, jobs go straight
from `running` to `done` as they do today.

`apps/cli/src/run-redaction.ts` calls `analyse` then immediately `apply` with an empty
`dismissed` set. The CLI's behaviour must not change in this plan.

**Verify**: `pnpm --filter cli start fixtures/sample.pdf` produces a `localveil.zip` whose
redaction count matches the pre-change run on the same fixture. With the web toggle off,
`fixtures/sample.txt` produces the same output as before.

### Step 7: Update the README

Update the "How a file is redacted" section to describe the review step, and the Limits
section, which currently tells the user to read the output because there was no other option.
Match the existing prose: it explains why, not what, and never uses an em dash.

**Verify**: `pnpm format:check` exits 0, `pnpm lint` exits 0, `pnpm typecheck` exits 0,
`pnpm test` exits 0.

## Test plan

New and changed tests, modelled on `apps/web/src/components/job-row.test.tsx` (Testing Library,
render plus user-event, no snapshot tests):

- `packages/redact-text/src/index.test.ts`: dismiss-all yields the input unchanged;
  dismiss-none matches the pre-split output; `preview` equals the covered substring.
- `packages/redact-pdf/src/redact.test.ts`: `apply` with no dismissals matches the previous
  `redactionCount`; cross-page propagated spans appear in `analyse`'s detections with
  `source: "repeat"`; dismissing a propagated detection removes exactly one box.
- `packages/redact-image/src/index.test.ts`: the same two cases as text.
- `apps/web/src/worker-pool.test.ts`: `structuredClone` round-trip of an `Analysis` per format.
- `apps/web/src/components/detection-review.test.tsx`: the five UI cases from step 5.
- `apps/web/src/store.test.ts`: the `reviewing` status transition, and that `dismissed`
  resets on requeue (`REQUEUED` in `apps/web/src/store.ts:31-37` must gain the new fields).

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `pnpm test` exits 0, with at least 15 new tests
- [ ] `grep -rn "redact:" packages/redact-*/src/index.ts` returns no matches (the single-phase
      contract is gone, not shadowed)
- [ ] `pnpm --filter cli start fixtures/sample.pdf` produces the same redaction count as
      before this change
- [ ] Every new user-visible string exists in `en`, `pt` and `es` (typecheck enforces this;
      confirm no string literal was rendered directly)
- [ ] `git status` shows no changes under `packages/pii-detect/`
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any redactor's `handle` cannot be made structured-cloneable without holding rendered page
  bitmaps. Holding canvases across the review pause would reintroduce the memory problem the
  PDF two-pass design exists to avoid.
- The PDF `apply` path needs to re-run OCR to paint. It must not; the word boxes are already in
  `handle`. If it does, the split is in the wrong place.
- You find yourself needing to change `MIN_SCORE` or anything under `packages/pii-detect/` to
  make review useful. That is the follow-up, deliberately excluded.
- The review list for a 40-page scanned fixture takes longer than 500ms to render even with
  virtualisation.
- Adding the `reviewing` status breaks the worker pool's completion accounting in
  `apps/web/src/worker-pool.ts` in a way that needs a redesign of the pool. Report it.

## Maintenance notes

- The next change after this one is the two-threshold policy: keep `MIN_SCORE` at 0.35 for
  auto-apply and surface a second, lower band as unchecked suggestions. The `Detection.source`
  field and the confidence sort in step 5 exist so that change is additive.
- `source: "user"` is in the type but unused by this plan. It reserves the shape for
  "add a detection the model missed", which is the other half of a real review step and is a
  deliberate follow-up.
- A reviewer should scrutinise: that `apply` re-renders rather than caching pages, that
  dismissed ids actually reach the paint step for PDFs (the easy bug is filtering the detection
  list but not the rect list), and that the CLI path did not silently change behaviour.
- If a visual overlay is added later, `Detection` needs the rect, and rects are viewport-scaled
  by `SCALE = 2` in `packages/redact-pdf/src/index.ts:17`. Store page dimensions in `handle`
  now if that follow-up is likely.
