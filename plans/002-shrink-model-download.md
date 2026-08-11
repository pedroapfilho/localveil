# Plan 002: Cut the model download by re-exporting the weights ourselves

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

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-eval-harness.md` (BASELINE.md must exist)
- **Category**: perf
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

The first run downloads 894 MB. That is the single worst property of the product, and every
other improvement is downstream of whether the user waits for it. The repo already tried the
obvious escapes and documented why they failed: the dynamic-int8 export "collapses on the
browser's wasm integer kernels, where a name scoring 0.999 natively came back at 0.17," and
the fp16 exports either cannot create a session (no fp16 CPU kernel for the model's LSTM) or
crush the person head on WebGPU.

Both of those are properties of **somebody else's export**, not of the model. The weights
currently come from `onnx-community/gliner_multi_pii-v1`, quantized off the shelf. Two
independent levers are available on our own export, and they compose:

1. **Vocabulary trimming.** The backbone is mDeBERTa-v3-base: 86M parameters of transformer
   and 190M parameters of embedding matrix for a 250K-token multilingual vocabulary. Roughly
   68% of the model is a lookup table for languages this app does not support. Trimming the
   vocabulary to English, Portuguese and Spanish is a documented, retraining-free
   post-processing step (Ushio et al., EMNLP 2023 Findings, `asahi417/lm-vocab-trimmer`);
   the published operating range is that around 40K tokens per language retains original
   performance. An Estonian study on mDeBERTa specifically found that **pruning** the existing
   vocabulary kept NER results in the baseline range, while **replacing** the tokenizer caused
   a substantial NER drop. Prune, do not retokenize.
2. **Targeted quantization.** ONNX Runtime's dynamic quantization defaults `per_channel` to
   `false`, and per-tensor weight quantization is a known source of degradation on
   attention-heavy models. DeBERTa's disentangled attention involves gather and matmul
   patterns over relative position embeddings that quantize particularly badly. The observed
   0.999 to 0.17 collapse is consistent with per-tensor quantization of exactly those layers,
   not with a broken wasm kernel. Quantizing the embedding matrix hard while excluding the
   attention nodes is the surgical version.

If both land, the download plausibly falls from 894 MB to the 200 to 400 MB range with no
accuracy loss. If only one lands, it is still the largest single improvement available. If
neither survives the harness, that is a real answer too, and it retires the question.

## Current state

### What is downloaded and from where

`packages/pii-detect/src/detector.ts:21-23,41`:

```ts
const MODEL_ID = "onnx-community/gliner_multi_pii-v1";

const MODEL_REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";
...
const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/${MODEL_FILE}`;
```

`packages/pii-detect/src/model-runtime.ts`:

```ts
const MODEL_FILE = "model_q4.onnx";
```

The tokenizer is fetched separately from the same repo and revision,
`packages/pii-detect/src/detector.ts:88`:

```ts
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION });
```

So a self-hosted derivative needs **both** the ONNX weights and a `tokenizer.json` at the same
repo and revision. Changing `MODEL_ID` and `MODEL_REVISION` is enough to repoint everything:
the browser cache key, the CLI cache path (`packages/pii-detect/src/ort-node.ts:17-21`, a
sha256 of the URL), and the stale-weight purge (`purgeStaleModels` at
`packages/pii-detect/src/detector.ts:144-152`) all derive from those two constants.

### The graph contract that must not change

`packages/pii-detect/src/gliner-feeds.ts` names six inputs and reads one output:

```ts
    attention_mask: tensor("int64", toBigInts(input.attentionMask), [1, tokens]),
    input_ids: tensor("int64", toBigInts(input.inputIds), [1, tokens]),
    span_idx: tensor("int64", toBigInts(input.spanIdx), [1, spans, 2]),
    span_mask: tensor("bool", Uint8Array.from(input.spanMask), [1, spans]),
    text_lengths: tensor("int64", toBigInts([input.keptWords.length]), [1, 1]),
    words_mask: tensor("int64", toBigInts(input.wordsMask), [1, tokens]),
```

and `packages/pii-detect/src/ort-browser.ts` takes `session.outputNames[0]`. A re-export must
preserve these six input names, their dtypes, and a single primary output of shape
`[1, positions, widths, entities]` as decoded in
`packages/pii-detect/src/gliner-decode.ts:36-38`. Anything else breaks the runtime.

### Tokens that must survive trimming

`packages/pii-detect/src/gliner-encode.ts:15-16` relies on two special tokens:

```ts
const ENT_TOKEN = "<<ENT>>";
const SEP_TOKEN = "<<SEP>>";
```

and `frameOf` in `packages/pii-detect/src/detector.ts:64-72` requires that encoding the empty
string with special tokens yields exactly two ids (CLS and SEP). The 24 entity prompts in
`packages/pii-detect/src/gliner-labels.ts` are also tokenized at inference time and include
`cpf`, `cnpj`, `iban`, `driver's license number` and `social security number`. Every piece
those strings tokenize into must be in the kept vocabulary or the prompts silently degrade to
`UNK` and detection quality collapses in a way that looks like a quantization problem.

### The device split

Browser: `packages/pii-detect/src/ort-browser.ts` creates the session with
`executionProviders: [device]` where device is `webgpu` or `wasm`. CLI:
`packages/pii-detect/src/ort-node.ts` uses `onnxruntime-node` defaults on native CPU. Pinned
versions from `packages/pii-detect/package.json`: `onnxruntime-web@1.27.0`,
`onnxruntime-node@1.24.3`. The README states one export is deliberately shared by both so the
terminal and the tab cannot disagree about a document. **Preserve that property.** A single
file that works on all three of webgpu, browser wasm and node CPU is a hard requirement of
this plan, not a preference.

## Commands you will need

| Purpose        | Command                          | Expected on success               |
| -------------- | -------------------------------- | --------------------------------- |
| Install        | `pnpm install`                   | exit 0                            |
| Typecheck      | `pnpm typecheck`                 | exit 0                            |
| Tests          | `pnpm test`                      | all pass                          |
| Lint           | `pnpm lint`                      | exit 0                            |
| Score a model  | `pnpm --filter @repo/eval start` | prints totals table, exit 0       |
| Web dev server | `pnpm dev --filter=web`          | serves on `http://localhost:5173` |

Model export work runs in Python, outside the repo, in a throwaway virtualenv. Nothing from
that environment is committed except the resulting artefacts' hashes and the export script.

## Scope

**In scope**:

- `tools/model-export/` (create): the Python export script, its `requirements.txt`, and a
  `README.md` recording the exact commands and the source revision.
- `packages/pii-detect/src/detector.ts`: the `MODEL_ID` and `MODEL_REVISION` constants only.
- `packages/pii-detect/src/model-runtime.ts`: the `MODEL_FILE` constant only.
- `packages/eval/BASELINE.md`: append the new measurement alongside the old one.
- `README.md`: the "Detection" and "Where the model runs" subsections, once a variant wins.

**Out of scope** (do NOT touch):

- `packages/pii-detect/src/gliner-encode.ts`, `gliner-decode.ts`, `gliner-feeds.ts`. If a
  re-export requires changing the encoder or decoder, the export is wrong. STOP.
- `packages/pii-detect/src/resumable-cache.ts`, `resumable-download.ts`,
  `purge-stale-models.ts`. They key off the URL and revision and need no change.
- `packages/pii-detect/src/gliner-labels.ts`. The prompts are an input to the trimming corpus,
  not something to edit to make trimming easier.
- Any change that gives the browser and the CLI different model files.

## Git workflow

- Branch: `advisor/002-shrink-model-download`
- Conventional commits, e.g. `perf(pii-detect): trim the model vocabulary to en, pt and es`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Reproduce the current export

In `tools/model-export/`, write `export.py` that downloads `urchade/gliner_multi_pii-v1` (the
PyTorch source of the ONNX community export), exports it to ONNX with the six input names
listed under "Current state", and writes `model.onnx` at fp32.

Confirm the reproduction before changing anything: point `MODEL_URL` at the local file (via a
temporary local static server, not by editing the fetch path), run
`pnpm --filter @repo/eval start`, and confirm the totals row is within 0.02 F1 of
`packages/eval/BASELINE.md`.

**Verify**: the fp32 self-export scores within 0.02 F1 of the recorded baseline. If it does
not, the export pipeline is wrong and every later measurement is meaningless. STOP.

### Step 2: Quantize with per-channel weights and excluded attention nodes

Produce three candidate files from the step 1 fp32 graph:

- `model_int8_pc.onnx`: `quantize_dynamic` with `per_channel=True`, `S8S8` with QDQ (the ONNX
  Runtime docs name S8S8+QDQ as the default first choice, and `per_channel` defaults to
  `false`, which is the suspected cause of the earlier collapse).
- `model_int8_pc_excl.onnx`: as above, plus `nodes_to_exclude` covering the disentangled
  attention MatMul and Gather nodes over relative position embeddings. Identify them by name
  from the graph; do not guess at a pattern.
- `model_emb4.onnx`: 4-bit weight-only on the embedding matrix, everything else left at fp32.
  The embedding matrix is 68% of the parameters and is a lookup, which quantizes cleanly.

Score all three plus the existing `model_q4.onnx` with the harness. Record every result in a
table: file size in MB, overlap F1, exact F1, and per-label recall for `private_person` and
`account_number` (the two the repo has previously seen break).

**Verify**: the table exists, with four rows and a size for each. Do not pick a winner yet.

### Step 3: Trim the vocabulary

Using `asahi417/lm-vocab-trimmer` (or an equivalent hand-written prune, whichever is simpler
against this checkpoint), build the keep-set from the union of:

- Every token produced by tokenizing a Portuguese, a Spanish and an English corpus. Use public
  Wikipedia dumps or `oscar`-style corpora. Do not use any corpus containing real personal data.
- Every token produced by tokenizing all 24 strings in
  `packages/pii-detect/src/gliner-labels.ts`, plus `<<ENT>>` and `<<SEP>>`.
- Every single-character piece for ASCII, Latin-1 Supplement and Latin Extended-A, plus all
  digits and common punctuation. OCR output contains characters no prose corpus produces, and
  a missing digit piece would break the check-digit paths in
  `packages/redact-core/src/patterns.ts`.
- The tokenizer's own special tokens, in their original positions where the config requires it.

Target roughly 60K to 80K kept tokens across the three languages. Prune the embedding matrix
and remap ids; **do not train a new tokenizer**, for the mDeBERTa NER reason recorded under
"Why this matters".

Emit `model.onnx` (fp32, trimmed) and the matching `tokenizer.json`, then apply the winning
quantization recipe from step 2 to produce the trimmed-and-quantized candidate.

**Verify**: `tokenizer.encode("")` with special tokens yields exactly 2 ids (the invariant
`frameOf` enforces at `packages/pii-detect/src/detector.ts:64-72`), and every one of the 24
prompt strings round-trips through encode/decode without producing an unknown-token id. Assert
both in the export script and print the result.

### Step 4: Score the trimmed candidates and pick a winner

Score the trimmed fp32 and trimmed-quantized files with the harness. Extend the step 2 table.

The winner must satisfy **all** of:

- Overlap F1 within 0.01 of the baseline, and per-label recall for `private_person` and
  `account_number` no more than 0.02 below baseline.
- Portuguese-only recall no more than 0.02 below baseline. This is the language the whole
  exercise exists for, and an aggregate score can hide its loss.
- Loads and runs on all three of browser WebGPU, browser wasm, and `onnxruntime-node`.
- Strictly smaller than 894 MB.

If no candidate clears the bar, the winner is "none" and that is a valid, reportable outcome.
Report the table and stop; do not relax the thresholds to manufacture a result.

**Verify**: the extended table, plus a recorded run of the winning file on each of the three
runtimes.

### Step 5: Publish and repoint

Publish the winning `model.onnx` (under `onnx/`, matching the URL shape in
`detector.ts:41`) and `tokenizer.json` to a Hugging Face repo the project controls. The base
model is Apache 2.0, so a derivative is permitted; the model card must name
`urchade/gliner_multi_pii-v1` as the source, state the exact trimming and quantization recipe,
and record the eval table.

Then change exactly three constants:

- `MODEL_ID` and `MODEL_REVISION` in `packages/pii-detect/src/detector.ts:21-23`, pinned to a
  **commit SHA**, never a branch. The existing comment in `README.md` explains why: an
  unpinned revision splices bytes from two revisions into one resumed download and the cache
  key never moves.
- `MODEL_FILE` in `packages/pii-detect/src/model-runtime.ts` if the filename differs.

**Verify**: `pnpm test` exits 0, `pnpm typecheck` exits 0. Then `pnpm dev --filter=web` with a
cleared browser cache: confirm the download reports the new byte count, the page reaches
`model.ready`, and a `fixtures/sample.pdf` run produces the same redaction count as before the
change. Then run the CLI on the same fixture and confirm it agrees.

### Step 6: Update the record

Append the winning measurement to `packages/eval/BASELINE.md` next to the old one. Update the
`README.md` "Detection" subsection so its account of which export is used and why the
alternatives failed matches reality, including the new evidence about per-tensor quantization.
Keep the existing prose style: it explains _why_, not _what_.

**Verify**: `pnpm format:check` exits 0, `pnpm lint` exits 0.

## Test plan

No new unit tests. This plan changes constants and an artefact, and the existing suite covers
the code paths around them (`packages/pii-detect/src/detector.test.ts`,
`resumable-cache.test.ts`, `purge-stale-models.test.ts`).

The verification that matters is the eval harness from plan 001 plus three manual runtime
checks. Record all of them in the report:

1. Browser WebGPU, cold cache, `fixtures/sample.pdf`: redaction count and wall-clock.
2. Browser wasm (force it by launching Chrome with `--disable-gpu`), same file, same checks.
3. CLI on the same file: `pnpm --filter cli start fixtures/sample.pdf`, same checks.

The browser and the CLI must report the same redaction count. If they diverge, the shared-export
invariant is broken. STOP.

## Done criteria

ALL must hold:

- [ ] `tools/model-export/export.py` and its `README.md` exist and record the source revision
- [ ] The fp32 self-export scored within 0.02 F1 of `packages/eval/BASELINE.md` (step 1)
- [ ] A candidate table with at least six rows (size, overlap F1, exact F1, person recall,
      account recall, pt-only recall) is in the report
- [ ] The winning file is smaller than 894 MB and clears every threshold in step 4
- [ ] `pnpm typecheck` exits 0, `pnpm lint` exits 0, `pnpm test` exits 0
- [ ] Browser WebGPU, browser wasm and CLI all produce the same redaction count on
      `fixtures/sample.pdf`
- [ ] `git status` shows changes only in `tools/model-export/`, the three constants,
      `packages/eval/BASELINE.md` and `README.md`
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The fp32 self-export in step 1 does not reproduce the baseline within 0.02 F1.
- Any candidate requires changing `gliner-encode.ts`, `gliner-decode.ts` or `gliner-feeds.ts`
  to run. The graph contract is fixed.
- No candidate clears the step 4 bar. Report the table; that is the deliverable.
- A candidate is smaller and scores well but fails on any one of the three runtimes. Shipping
  different files to browser and CLI is explicitly out of scope.
- Trimming pushes any of the 24 entity prompts to an unknown token. Fix the keep-set, and if
  it cannot be fixed, report.
- You cannot publish to a Hugging Face repo the project controls. Steps 1 to 4 are still
  valuable on their own; report the table and stop before step 5.

## Maintenance notes

- The export script is the artefact with the longest life. Whatever detection checkpoint wins
  a future evaluation, the trimming and quantization recipe applies to it unchanged, so keep
  `tools/model-export/` maintained rather than deleting it after one use.
- A future contributor adding a fourth interface language must re-run the trim with that
  language's corpus in the keep-set, or that language will tokenize into `UNK` and detection
  will look broken for reasons nothing in the app explains. Say so in the export README.
- A reviewer should scrutinise: that `MODEL_REVISION` is a commit SHA and not a branch, that
  the browser and CLI still share one file, and that per-language recall (not just aggregate
  F1) was checked.
- Deliberately deferred: evaluating replacement checkpoints
  (`knowledgator/gliner-pii-*`, `fastino/gliner2-privacy-filter-PII-multi`,
  `nvidia/gliner-PII`). Those are model swaps with different decode contracts and belong in
  their own plan, after this one proves the export pipeline works.
