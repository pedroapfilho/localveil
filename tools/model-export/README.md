# Model export

Rebuilds the detection weights localveil downloads, so the 894 MB first run can be measured
against alternatives rather than argued about. Nothing here runs in CI or at build time; it is
run by hand when someone wants to change what the app fetches.

The weights the app uses today come from `onnx-community/gliner_multi_pii-v1`, quantized by
somebody else. Two levers are available on our own export and they compose:

**Result: int8 is dead, trimming works.** Both int8 recipes below collapse in the browser
exactly as the shipped README describes, so lever 2 is closed. Lever 1 lands: trimming to Latin
script and then quantizing to 4 bits gives 539 MB against the shipped 853 MB with identical
spans on all 30 corpus documents and a 0.9956 name score on both browser paths. The only step
left is publishing the weights and the trimmed tokenizer at one pinned revision.

Keep U+2581 in the keep set. It is SentencePiece's word-initial marker, it lives in Block
Elements rather than General Punctuation, and dropping it deletes every `\u2581word` piece while
leaving the bare form. Nothing hits an unknown token, so the tokenizer looks fine; the corpus
just tokenizes about half again as long and the model loses 5 F1.

1. **Vocabulary trimming.** mDeBERTa-v3-base is 86M parameters of transformer and 190M of
   embedding matrix for a 250K-token multilingual vocabulary, so roughly two thirds of the
   download is a lookup table for scripts localveil never reads. `trim_vocab.py` keeps only the
   Latin-script pieces, plus every piece the 24 entity prompts tokenize into, plus the special
   tokens. It prunes rather than retokenizes: an mDeBERTa study on Estonian found pruning held
   NER in the baseline range where replacing the tokenizer dropped below every baseline.
2. **Targeted quantization.** `quantize_dynamic` defaults `per_channel` to `false`, and
   per-tensor weight quantization is a known failure mode on attention-heavy graphs. DeBERTa's
   disentangled attention, with its gather and matmul patterns over relative position
   embeddings, is close to the worst case. The 0.999 to 0.17 int8 collapse recorded in the
   repo README matches that signature, which points at the off-the-shelf export rather than at
   the browser's wasm kernels. `export.py` produces a per-channel variant and an
   embeddings-only variant, the latter being the surgical one: it hits the two thirds of the
   parameters that are a lookup and leaves attention alone.

## Setup

```bash
uv venv --python 3.12 .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Run

```bash
# 24 entity prompts, read straight out of the TypeScript source so the two cannot drift
python3 - <<'PY'
import json, re, pathlib
src = pathlib.Path("packages/pii-detect/src/gliner-labels.ts").read_text()
pathlib.Path("tools/model-export/prompts.json").write_text(
    json.dumps(re.findall(r'prompt:\s*"([^"]+)"', src), indent=2) + "\n")
PY

.venv/bin/python export.py --prompts prompts.json --out build
.venv/bin/python trim_vocab.py --prompts prompts.json --out build/trimmed
.venv/bin/python export.py --source build/trimmed --prompts prompts.json --out build/trimmed-onnx
```

## Score a candidate

`packages/pii-detect` fetches one pinned URL and the CLI caches it under
`~/.cache/localveil/models` keyed by a sha256 of that URL. `@repo/eval`'s `swap` script puts a
candidate in that slot, keeping the shipped weights beside it, so the harness scores the
candidate without any source change:

```bash
pnpm --filter @repo/eval swap /tmp/lv-export/build/model_int8_embeddings.onnx
EVAL_MIN_SCORE=0.65 pnpm --filter @repo/eval start
pnpm --filter @repo/eval swap --restore
```

**Check the browser before believing a CPU number.** `apps/web/wasm-check.html` runs a
candidate through the app's own loading and device selection and prints the model's score for a
known name. Drop the file at `apps/web/public/candidate.onnx`, run `pnpm dev --filter=web`, and
open `/wasm-check.html`, or `?device=wasm` to force the fallback path. This is not optional:
the per-channel int8 recipe below scores 0.9972 on native CPU and 0.09 on WebGPU for the same
input, which is the whole reason int8 was rejected.

**Sweep the floor, do not fix it.** Quantization shifts the score distribution, so two exports
compared at one threshold are being compared on calibration rather than accuracy. Measured on
this corpus, the same fp32 export scores 87.4 F1 at 0.35 and 94.6 at 0.80. Compare candidates
at each one's best floor.

Compare the totals against `packages/eval/BASELINE.md`. A candidate is only worth shipping if
it clears all of:

- overlap F1 within 0.01 of baseline,
- `private_person` and `account_number` recall no more than 0.02 below baseline,
- **Portuguese-only** recall no more than 0.02 below baseline, since an aggregate hides the
  language the whole exercise exists for,
- loads on browser WebGPU, browser wasm and `onnxruntime-node`, because the app ships one file
  to all three and the terminal and the tab must not disagree about a document.

A trimmed model also needs its `tokenizer.json` served from the same repo and revision as the
weights, because `detector.ts` loads the tokenizer with `AutoTokenizer.from_pretrained(MODEL_ID,
{ revision })`. Scoring a trimmed candidate therefore needs the tokenizer overridden too, not
just the weights swapped.

## Publishing

Not automated, and deliberately. The winner goes to a Hugging Face repo the project controls,
with `urchade/gliner_multi_pii-v1` named as the source (it is Apache 2.0, so a derivative is
fine), the exact recipe recorded, and the eval table in the card. Then three constants change:
`MODEL_ID` and `MODEL_REVISION` in `packages/pii-detect/src/detector.ts`, pinned to a commit
SHA and never a branch, and `MODEL_FILE` in `model-runtime.ts` if the name differs.

A fourth interface language later means re-running the trim with that language's script in the
keep set, or its text tokenizes to `UNK` and detection looks broken for a reason nothing in the
app explains.
