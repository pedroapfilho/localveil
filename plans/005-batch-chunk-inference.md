# Plan 005: Run a document's chunks through the model in one batched session call

> **Executor instructions**: Follow this plan step by step. Run every verification command
> and confirm the expected result before moving to the next step. If anything in the "STOP
> conditions" section occurs, stop and report. Do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7fdfa30..HEAD -- packages/pii-detect`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-eval-harness.md` (BASELINE.md must exist)
- **Category**: perf
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

A document is split into 280-word chunks and each chunk is fed to the model one at a time, in
sequence, with an `await` per chunk. Every chunk is independent of every other chunk, so the
sequencing buys nothing. It costs a full round trip through the ONNX session per chunk, and on
WebGPU it costs more than that: dispatching many tiny inferences leaves the GPU idle between
submissions, which is the workload GPUs are worst at.

The cost compounds. Detection is serialised globally across the whole app: `serialiseDetect`
in `packages/redact-core/src/detect-rpc.ts` queues every worker's requests through one session,
so a slow per-document detection blocks every other file in the pool. Making one document's
detection faster makes the whole queue faster.

There is also a second inference per chunk when the chunk contains shouting lines. Those are
independent too and batch alongside the rest.

## Current state

`packages/pii-detect/src/detector.ts:184-209` is the sequential loop, written as a `reduce`
over promises with two lint rules suppressed because of exactly this pattern:

```ts
return serialiseDetect(async (text) => {
  const chunks = chunkWords(splitWords(text), maxWords, overlapWords);

  /* oxlint-disable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
  const parts = await chunks.reduce<Promise<Array<ChunkSpans>>>(async (pending, chunk) => {
    const collected = await pending;

    collected.push({ offset: 0, spans: await inferSpans(chunk.words) });

    const shouting = collectShouting(text.slice(chunk.start, chunk.end));

    if (shouting.text.length > 0) {
      const found = await inferSpans(splitWords(shouting.text));

      collected.push({
        offset: chunk.start,
        spans: toSourceSpans(found, shouting.segments),
      });
    }

    return collected;
  }, Promise.resolve([]));
  /* oxlint-enable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

  return [...mergeChunkSpans(parts), ...patternSpans(text)];
});
```

`inferSpans` (`packages/pii-detect/src/detector.ts:158-182`) encodes one chunk and calls
`run(encoded)` once.

Every tensor is currently built with a leading batch dimension of 1, in
`packages/pii-detect/src/gliner-feeds.ts`:

```ts
    attention_mask: tensor("int64", toBigInts(input.attentionMask), [1, tokens]),
    input_ids: tensor("int64", toBigInts(input.inputIds), [1, tokens]),
    span_idx: tensor("int64", toBigInts(input.spanIdx), [1, spans, 2]),
    span_mask: tensor("bool", Uint8Array.from(input.spanMask), [1, spans]),
    text_lengths: tensor("int64", toBigInts([input.keptWords.length]), [1, 1]),
    words_mask: tensor("int64", toBigInts(input.wordsMask), [1, tokens]),
```

and the decoder reads the last three dimensions of the output,
`packages/pii-detect/src/gliner-decode.ts:36-38`:

```ts
const entities = logits.dims.at(-1) ?? 0;
const widths = logits.dims.at(-2) ?? 0;
const positions = logits.dims.at(-3) ?? 0;
```

Reading from the end means the decoder already tolerates a leading batch dimension greater
than 1 for the shape read, but the length check on the next line does not:

```ts
  if (positions * widths * entities !== logits.data.length) {
```

That check must become per-batch-item, and `decodeSpans` must learn to slice one item out of
a batched tensor.

Chunks are not equal length. `chunkWords` (`packages/pii-detect/src/chunk-words.ts`) slices
`size` words at a stride of `size - overlap`, so the final chunk is usually short, and
`encodeGlinerInput` drops words that tokenize to nothing. Batching therefore requires padding
`input_ids`, `attention_mask` and `words_mask` to the longest chunk in the batch, and padding
`span_idx` and `span_mask` to the largest span count. The padding must not produce spans: pad
`attention_mask` with 0, `words_mask` with 0, and `span_mask` with 0.

### Repo conventions to match

- Arrow functions, `const` over `let`, exports at the end, alphabetically sorted keys.
- Guards are hand-written type predicates, not a schema library. See `isNumberArray` at
  `packages/pii-detect/src/gliner-decode.ts:7-19`.
- Errors are `TypeError` with a sentence explaining what the model did, e.g.
  "The model scored N entity types where M were asked for"
  (`packages/pii-detect/src/gliner-decode.ts:40-42`). Match that voice.
- **No comments that restate the code.**
- Max 400 lines per file.

## Commands you will need

| Purpose   | Command                               | Expected on success         |
| --------- | ------------------------------------- | --------------------------- |
| Install   | `pnpm install`                        | exit 0                      |
| Typecheck | `pnpm typecheck`                      | exit 0                      |
| Tests     | `pnpm --filter @repo/pii-detect test` | all pass                    |
| All tests | `pnpm test`                           | all pass                    |
| Lint      | `pnpm lint`                           | exit 0                      |
| Score     | `pnpm --filter @repo/eval start`      | prints totals table, exit 0 |

## Scope

**In scope**:

- `packages/pii-detect/src/gliner-feeds.ts`
- `packages/pii-detect/src/gliner-decode.ts`
- `packages/pii-detect/src/detector.ts` (the `inferSpans` call site and the chunk loop)
- `packages/pii-detect/src/model-runtime.ts` (the `RunModel` signature)
- `packages/pii-detect/src/ort-browser.ts` and `ort-node.ts` (tensor construction only)
- Tests beside each of the above.

**Out of scope** (do NOT touch):

- `packages/pii-detect/src/gliner-encode.ts`. Encoding one chunk is correct; batching happens
  above it, by padding several encoded chunks together.
- `packages/pii-detect/src/chunk-words.ts`, `split-words.ts`, `shouting.ts`. Chunk boundaries,
  sizes and the shouting retry rule are unchanged.
- `MAX_WORDS`, `OVERLAP_WORDS`, `MIN_SCORE`, `MAX_WIDTH` in `detector.ts`.
- `packages/redact-core/src/detect-rpc.ts`. Global serialisation stays; this plan speeds up
  what happens inside one turn, it does not make turns concurrent.
- The model artefact. If batching requires a re-export, that is plan 002's territory. STOP.

## Git workflow

- Branch: `advisor/005-batch-chunk-inference`
- Conventional commit, e.g. `perf(pii-detect): batch a document's chunks into one session run`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Prove the graph accepts a batch

Before writing anything, confirm the exported ONNX graph has a dynamic batch axis on all six
inputs. Write a throwaway script that loads the cached model with `onnxruntime-node` and runs
two identical copies of one chunk as a batch of 2, then checks that the output's first
dimension is 2 and that both slices are numerically identical to a batch-of-1 run of the same
chunk.

If the graph pins batch to 1, STOP and report. Batching then requires a re-export, which is
plan 002's scope, not this one.

**Verify**: the script prints the output dims and a max absolute difference between the two
slices below 1e-4.

### Step 2: Make the decoder batch-aware

Change `decodeSpans` in `packages/pii-detect/src/gliner-decode.ts` to take a batch index and
read only that item's slice of `logits.data`. Replace the whole-tensor length check with a
check that `batch * positions * widths * entities === logits.data.length`, keeping the existing
error voice. `suppressOverlaps` is per-item and does not change.

**Verify**: `pnpm --filter @repo/pii-detect test` passes, including new cases in
`gliner-decode.test.ts` for a batch of 1 (behaviour identical to today), a batch of 3 where
only the middle item has a scoring span, and a shape/length mismatch that must still throw.

### Step 3: Add batched feeds

Add a `toBatchedFeeds` to `packages/pii-detect/src/gliner-feeds.ts` that takes
`Array<GlinerInput>` and produces the six tensors with a leading batch dimension, padding as
described under "Current state". Keep `toFeeds` as the single-item path so existing tests keep
their meaning, or express it as `toBatchedFeeds([input])` if that is exactly equivalent.

Update `RunModel` in `packages/pii-detect/src/model-runtime.ts` to take
`Array<GlinerInput>` and return the batched `Logits`, and update both
`packages/pii-detect/src/ort-browser.ts` and `ort-node.ts` to call `toBatchedFeeds`.

**Verify**: `pnpm --filter @repo/pii-detect test` passes with new cases in a
`gliner-feeds.test.ts` covering: padding to the longest chunk, `attention_mask` zeroed in the
padded region, `span_mask` zeroed in the padded region, and dims correct for a batch of 3 with
three different lengths.

### Step 4: Batch the chunk loop

Rewrite the loop in `packages/pii-detect/src/detector.ts:184-209` to:

1. Encode every chunk, and every shouting retry, up front into a flat list of encoded inputs,
   each tagged with the offset and the segment mapping it needs afterwards.
2. Split that list into batches of at most `BATCH_SIZE` (start at 4, exported as a named
   constant beside `MAX_WORDS`) and at most a total padded token count that keeps peak memory
   bounded. Pick the token cap so a batch never exceeds roughly 4x the tokens of a single
   full-size chunk, and state the number as a constant.
3. Run each batch through `run`, decode each item, and map back to source spans exactly as
   `inferSpans` does today.
4. Feed the collected `ChunkSpans` to `mergeChunkSpans` unchanged.

Remove the two `oxlint-disable` comments if the sequential-await pattern is gone. If batches
are still awaited in sequence (they will be, since the session is one), keep whichever
suppression is still needed and drop the other.

Skip empty encodings before batching: `encodeGlinerInput` returns `keptWords.length === 0` for
a chunk of nothing but punctuation, and `inferSpans` currently short-circuits on that
(`packages/pii-detect/src/detector.ts:167-169`). Preserve that.

**Verify**: `pnpm --filter @repo/pii-detect test` passes, including the existing
`detector.test.ts` and `detector.integration.test.ts` unchanged.

### Step 5: Prove it is faster and unchanged

Run `pnpm --filter @repo/eval start` and compare against `packages/eval/BASELINE.md`.

The bar:

- Overlap F1, exact F1, and per-label recall for every label must be **identical** to the
  baseline, not merely close. Batching is a pure refactor of the execution order; any score
  change means padding is leaking into the attention mask or the decode slice is off by one.
  A difference of even 0.005 is a bug, not noise.
- Record wall-clock for the whole harness run before and after.

Also time one long document (concatenate several corpus documents to at least 20 chunks) on
browser WebGPU, browser wasm, and node CPU. Report all three.

**Verify**: identical scores, and a recorded speedup figure per runtime.

## Test plan

- `packages/pii-detect/src/gliner-decode.test.ts`: batch of 1, batch of 3 with one scoring
  item, mismatched shape throws, entity-count mismatch still throws.
- `packages/pii-detect/src/gliner-feeds.test.ts` (new): the four padding cases from step 3.
- `packages/pii-detect/src/detector.test.ts`: a document producing exactly `BATCH_SIZE + 1`
  chunks, asserting the spans equal what the sequential path produced (capture the expected
  array from a pre-change run and pin it).
- Existing `detector.integration.test.ts` must pass untouched.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 with at least 8 new tests in `packages/pii-detect`
- [ ] `pnpm --filter @repo/eval start` produces scores **identical** to
      `packages/eval/BASELINE.md` on every label and language
- [ ] A recorded speedup on a 20-chunk document for WebGPU, wasm and node CPU
- [ ] `git status` shows no changes under `packages/redact-*` or `apps/`
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 shows the graph pins its batch dimension to 1.
- Any eval score differs from the baseline. Do not accept a small difference as noise; find the
  padding or slicing bug, and if you cannot, report with the failing document.
- Peak memory on a long document rises enough to affect the worker pool's sizing, which is
  computed in `apps/web/src/probe-capacity.ts` from `hardwareConcurrency` and `deviceMemory`.
  Reducing `BATCH_SIZE` is a legitimate response; changing the pool sizing is not.
- WebGPU produces different spans from wasm for the same batched input. The two runtimes must
  continue to agree, which is an existing invariant of the project.

## Maintenance notes

- `BATCH_SIZE` is a memory-versus-throughput knob and its right value differs between a phone
  on wasm and a desktop on WebGPU. Starting at a fixed 4 is deliberate; making it adaptive is a
  follow-up, and it should be driven by the same probe that sizes the worker pool rather than
  by a second, independent guess.
- Padding correctness is the whole risk surface. A reviewer should check that
  `attention_mask`, `words_mask` and `span_mask` are all zeroed in the padded region, and that
  `text_lengths` carries each item's own real word count rather than the padded one.
- If plan 002 lands a re-exported model, re-run step 1 against the new artefact before
  assuming the batch axis survived the export.
