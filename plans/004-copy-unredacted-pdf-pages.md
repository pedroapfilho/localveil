# Plan 004: Copy PDF pages that carry no redaction instead of rasterising them

> **Executor instructions**: Follow this plan step by step. Run every verification command
> and confirm the expected result before moving to the next step. If anything in the "STOP
> conditions" section occurs, stop and report. Do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7fdfa30..HEAD -- packages/redact-pdf`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

Every page of every PDF is rasterised to a PNG at twice its point size and embedded as an
image, then the surviving words are redrawn as invisible text to keep the file searchable. The
README is honest about the cost: "A redacted PDF is images. The text layer is rebuilt from
recognised words, so it is searchable but not identical to the original, and the file is
larger."

That cost is worth paying on a page where something was covered, because drawing boxes over
live text leaves the words in the file for anyone to copy out. It is pure loss on a page where
nothing was covered. A 40-page contract with two names on page 3 currently comes back as 40
page-sized PNGs with a reconstructed text layer, when 39 of those pages could have been copied
through byte-for-byte with their original fonts, vectors, links and selectable text intact.

The fix is small and self-contained: if a page produced no rectangles, copy the source page
instead of embedding a bitmap. Output size drops sharply on the common case, the second render
of those pages is skipped entirely, and quality on untouched pages goes from "re-recognised
approximation" to "the original."

## Current state

`packages/redact-pdf/src/index.ts:160-204` is the second pass. Every page goes through the same
path regardless of whether anything was covered:

```ts
for (let number = 1; number <= pdf.numPages; number += 1) {
  const progress = 0.7 + ((number - 1) / pdf.numPages) * 0.3;
  const page = read[number - 1];

  onProgress(progress, "stage.redacting");

  const { canvas, viewport } = await renderPage(number);
  const spans = [...page.spans, ...spansForTokens(page.text, everyToken)];
  const rects = spansToRects(spans, page.words);

  redactionCount += mergeOverlappingRanges(spans).length;
  paint(canvas, rects);

  onProgress(progress, "stage.assembling");

  const encoded = await canvas.convertToBlob({ type: "image/png" });
  const png = await out.embedPng(await encoded.arrayBuffer());
  const sheet = out.addPage([viewport.width / SCALE, viewport.height / SCALE]);

  sheet.drawImage(png, {
    height: viewport.height / SCALE,
    width: viewport.width / SCALE,
    x: 0,
    y: 0,
  });

  for (const word of page.words) {
    if (isCovered(word.bbox, rects)) {
      continue;
    }

    try {
      sheet.drawText(word.text, {
        font,
        opacity: 0,
        size: (word.bbox.y1 - word.bbox.y0) / SCALE,
        x: word.bbox.x0 / SCALE,

        y: (viewport.height - word.bbox.y1) / SCALE,
      });
    } catch {
      warnings.add("warning.droppedCharacters");
    }
  }
}
```

`rects` is already computed before the render is used for anything but painting, so the branch
point exists at line 169 with no restructuring.

The source bytes are read once at `packages/redact-pdf/src/index.ts:67-75`:

```ts
const [pdfjs, pdfLib, source] = await Promise.all([
  import("pdfjs-dist"),
  import("pdf-lib"),
  file.arrayBuffer(),
  parserInstalled,
]);

const opened = pdfjs.getDocument(documentOptions(new Uint8Array(source)));
const [pdf, out] = await Promise.all([opened.promise, pdfLib.PDFDocument.create()]);
```

`source` is still in scope in the second loop, so `pdf-lib` can load the original document from
the same bytes and copy pages out of it. Note that `pdfjs.getDocument` may transfer or detach
the underlying buffer; if it has, load `pdf-lib` from a copy taken before that call.

Cross-page propagation happens between the loops at `packages/redact-pdf/src/index.ts:157`:

```ts
const everyToken = [...tokens.values()];
```

so by the time the second loop runs, "this page has no rects" is final. A name first tagged on
the last page has already been propagated to page one.

### Repo conventions to match

- Arrow functions, `const` over `let`, exports at the end, alphabetically sorted object keys.
- **No comments that restate the code.** This file has three comments across 226 lines and all
  three are lint suppressions. Do not add explanatory ones.
- Max 400 lines per file. This file is 226; the change should add fewer than 40.

## Commands you will need

| Purpose   | Command                                       | Expected on success    |
| --------- | --------------------------------------------- | ---------------------- |
| Install   | `pnpm install`                                | exit 0                 |
| Typecheck | `pnpm typecheck`                              | exit 0                 |
| Tests     | `pnpm --filter @repo/redact-pdf test`         | all pass               |
| All tests | `pnpm test`                                   | all pass               |
| Lint      | `pnpm lint`                                   | exit 0                 |
| CLI check | `pnpm --filter cli start fixtures/sample.pdf` | writes `localveil.zip` |

## Scope

**In scope**:

- `packages/redact-pdf/src/index.ts`
- `packages/redact-pdf/src/redact.test.ts`
- `README.md`, the "PDF: render, recognise, paint, rebuild" details block only.

**Out of scope** (do NOT touch):

- `packages/redact-pdf/src/covered.ts`, `canvas-factory.ts`, `filter-factory.ts`.
- `packages/redact-core/src/rects.ts`. The rectangle computation is correct; this plan only
  branches on whether the result is empty.
- The first loop (`packages/redact-pdf/src/index.ts:107-155`). Detection, OCR and language
  behaviour are unchanged by this plan. In particular, do NOT skip OCR on any page: a page with
  no rects still has to be read, because a name found there propagates to other pages.
- `redactionCount`. Its value must not change for any input.
- Any attempt to read word boxes from the PDF's own text layer. That is a separate, much larger
  change.

## Git workflow

- Branch: `advisor/004-copy-unredacted-pdf-pages`
- Conventional commit, e.g. `perf(redact-pdf): copy pages that carry no redaction`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Load the source document with pdf-lib

Before the second loop, load the original bytes into a `pdf-lib` document alongside the empty
output document. Take a copy of `source` before `pdfjs.getDocument` runs if that call detaches
the buffer; verify which by asserting `source.byteLength > 0` immediately after the
`getDocument` call and reporting if it is zero.

**Verify**: `pnpm --filter @repo/redact-pdf test` still passes with no behaviour change yet.

### Step 2: Branch the second loop on empty rects

Restructure the loop body so that after `rects` is computed:

- When `rects.length === 0`: copy page `number` from the source document into `out` via
  `copyPages`, add it, and skip the render, the PNG encode, and the invisible-text redraw
  entirely. `redactionCount` still accumulates `mergeOverlappingRanges(spans).length`, which is
  zero in this branch, so the total is unchanged.
- When `rects.length > 0`: the existing path, unchanged.

Compute `rects` **without** calling `renderPage`, so the render only happens on the painting
branch. `spansToRects` needs only `page.spans`, `page.text`, `page.words` and `everyToken`,
all of which come from the first pass.

Page ordering must be preserved exactly. Copying is asynchronous; do not reorder pages by
resolving copies concurrently.

**Verify**: `pnpm --filter @repo/redact-pdf test` passes. Then run
`pnpm --filter cli start fixtures/sample.pdf` and confirm the reported redaction count matches
the count from a run on the same fixture before this change (record both).

### Step 3: Extend the tests

Add to `packages/redact-pdf/src/redact.test.ts`:

- A multi-page document where one page has a detection and the others do not: assert the output
  has the same page count as the input, that `redactionCount` is unchanged from the
  all-rasterised behaviour, and that the untouched pages still carry their original text.
- A document where every page has a detection: assert the output is identical in page count and
  redaction count to today's behaviour, so the painting path is untouched.
- A document where no page has a detection: assert the output page count matches and that no
  PNG was embedded (assert on output byte size being close to the input's, or by inspecting the
  produced document's page resources, whichever the existing test helpers support).

Model the tests on the existing cases in the same file; do not introduce a new mocking style.

**Verify**: `pnpm test` exits 0 with three new passing tests.

### Step 4: Correct the README

The "PDF: render, recognise, paint, rebuild" block and the Limits bullet "A redacted PDF is
images" both now overstate the case. Rewrite them to say that pages carrying a redaction are
rasterised, for the reason already given, and pages that carry none are copied through
untouched. Keep the existing voice: it explains why, not what, and never uses an em dash.

**Verify**: `pnpm format:check` exits 0, `pnpm lint` exits 0.

## Test plan

Covered in step 3. Three new tests in `packages/redact-pdf/src/redact.test.ts`, following the
structure of the cases already there. No new test files, no new fixtures unless the existing
`fixtures/sample.pdf` is single-page, in which case add a small multi-page PDF under
`packages/redact-pdf/src/__fixtures__/` built from invented content only.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 with three new passing tests in `packages/redact-pdf`
- [ ] `redactionCount` on `fixtures/sample.pdf` is identical before and after the change
- [ ] The output page count equals the input page count in all three new tests
- [ ] `renderPage` is not called on the no-rects branch (assert via a spy in the test, or by
      grep confirming it sits inside the painting branch)
- [ ] `git status` shows changes only in `packages/redact-pdf/` and `README.md`
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pdf-lib`'s `copyPages` cannot read the source bytes because `pdfjs.getDocument` detached the
  buffer and copying the array beforehand measurably increases peak memory on a large document.
- The copied pages appear out of order or the output page count differs from the input.
- A copied page in the output still shows content that should have been covered. That would mean
  `rects.length === 0` is not a reliable signal, which invalidates the whole approach. Report it
  with the document that reproduces it.
- `redactionCount` changes for any input.

## Maintenance notes

- The output is now a mixed document: some pages original, some rasterised. Anything downstream
  that assumed every page is an image (a future thumbnail generator, a page-count-times-size
  estimate) needs to stop assuming it.
- This makes the born-digital case cheaper but not free: OCR still runs on every page in the
  first pass, which is the dominant cost. Reading word boxes from the PDF's own text layer is
  the change that removes it, and it is deliberately out of scope here. That work has to solve
  run-level-to-word-level box splitting, which needs glyph advances from `page.getOperatorList()`
  or `commonObjs`; `getTextContent({ disableCombineTextItems: true })` alone gives finer runs
  but still not words.
- A reviewer should scrutinise: page ordering, that `redactionCount` accumulates on both
  branches, and that OCR was not skipped on the copied pages (which would break cross-page
  propagation).
