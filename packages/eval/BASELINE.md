# Baseline

The measurement plans 002 and 005 compare against. Regenerate with
`pnpm --filter @repo/eval start` and replace the tables below, keeping the old ones in git
history rather than in this file.

## What was measured

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Commit      | `2a11b05`                                           |
| Date        | 2026-08-11                                          |
| Model       | `onnx-community/gliner_multi_pii-v1`                |
| Revision    | `2e0397a7e8a250d76c37122232b3cbde42c8d629`          |
| File        | `model_q4.onnx` (853 MB on disk)                    |
| Runtime     | `onnxruntime-node` 1.24.3, native CPU, darwin arm64 |
| Score floor | 0.65                                                |
| Corpus      | 30 documents, 12 pt, 9 en, 9 es                     |

Predictions are merged by label before scoring, because two detectors finding the same value
paint one rectangle, not two. Matching is then one-to-one and greedy by overlap length: a
prediction pairs with an expected span when the labels agree and the ranges overlap by at
least one character. The exact table repeats the pass with boundary equality required.

## Detection, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    94.4   94.4   94.4     17      1      1
private_address   92.9  100.0   96.3     13      1      0
private_date      93.8  100.0   96.8     15      1      0
private_email    100.0  100.0  100.0     21      0      0
private_person    97.4  100.0   98.7     37      1      0
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0   25.0   40.0      1      0      3
secret           100.0   60.0   75.0      3      0      2
TOTAL             95.3   95.3   95.3    122      6      6
```

## Detection, exact boundaries

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    88.9   88.9   88.9     16      2      2
private_address   85.7   92.3   88.9     12      2      1
private_date      93.8  100.0   96.8     15      1      0
private_email    100.0  100.0  100.0     21      0      0
private_person    97.4  100.0   98.7     37      1      0
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0   25.0   40.0      1      0      3
secret            66.7   40.0   50.0      2      1      3
TOTAL             93.0   93.0   93.0    119      9      9
```

## By language, overlap matching

```
label   prec    rec     f1     tp     fp     fn
-----------------------------------------------
en      97.2   94.6   95.9     35      1      2
es      97.0   94.1   95.5     32      1      2
pt      93.2   96.5   94.8     55      4      2
```

## Pattern layer alone, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number   100.0   94.4   97.1     17      0      1
private_address  100.0    7.7   14.3      1      0     12
private_date     100.0   73.3   84.6     11      0      4
private_email    100.0  100.0  100.0     21      0      0
private_person   100.0    0.0    0.0      0      0     37
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0    0.0    0.0      0      0      4
secret           100.0    0.0    0.0      0      0      5
TOTAL             97.0   50.8   66.7     65      2     63
```

## Detection plus the structural layer, overlap matching

The CSV and JSON field-name layer from `@repo/redact-text`, scored on top of detection. It
only applies to documents whose id ends in `csv` or `json`, so most rows are unchanged.

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    94.4   94.4   94.4     17      1      1
private_address   92.9  100.0   96.3     13      1      0
private_date      93.8  100.0   96.8     15      1      0
private_email    100.0  100.0  100.0     21      0      0
private_person    97.4  100.0   98.7     37      1      0
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0   25.0   40.0      1      0      3
secret           100.0  100.0  100.0      5      0      0
TOTAL             95.4   96.9   96.1    124      6      4
```

## Reading it

**Precision and recall are both 95.3%.** They were 89.1 and 96.1 until the score floor moved
from 0.35 to 0.65 on 2026-08-11, which traded one true positive for nine false ones. An earlier
version of this file reported 60% precision; that was a flaw in the scorer, not the detector.
The model and the pattern layer both find the same email, and counting that as one hit and one
false alarm punished agreement. Predictions are merged by label before scoring now, which is
what happens before a rectangle is painted.

**`private_url` is the only real hole left.** 25% recall, 3 of 4 missed, and the pattern layer
contributes nothing to it. `secret` was the second hole and the structural layer closed it: 60%
recall from the model alone, 100% once CSV and JSON field names are read.

**Portuguese now leads on recall and trails on precision.** 93.2 / 96.5 against English's
97.2 / 94.6. It carries the most spans in the corpus (55 of 122) so it also carries the most
absolute errors, but the language the project exists for is not the weak one.

**The pattern layer is the precise one and the model is the broad one**, which is the division
they were built for: 97.0% precision at 50.8% recall for patterns, against the model's wider
net. The pattern layer's only imprecision is 2 false positives on phones, both the same known
defect: `\b\d{3,4}-\d{4}\b` in `packages/redact-core/src/patterns.ts:154` claims invoice
numbers like `2024-0817`, and `isYearRange` does not catch it because the second half is not a
year. It is pinned in `packages/eval/src/corpus.test.ts` rather than fixed.

**The structural layer is free and closes the `secret` gap.** Recall 95.3 to 96.9, precision
95.3 to 95.4, no label regressed. An earlier draft also mapped `city`, `cidade` and `ciudad` to
`private_address`, which cost 29 points of address precision for no recall; a bare city is not
something the model covers in prose either, so those field names were dropped.

**Exact-boundary scoring costs 2.3 points of F1 overall and 25 on `secret`.** The model finds
an API key but disagrees about where it ends, which matters more for a key than for a name.

## The score floor is the biggest lever, and it is mistuned

Measured 2026-08-10 while testing whether the 894 MB download could be cut. The floor is
`MIN_SCORE` in `packages/pii-detect/src/detector.ts`, and the harness now takes an
`EVAL_MIN_SCORE` override so it can be swept.

On the shipped weights, overlap matching, whole corpus:

```
floor    prec    rec     f1     tp     fp     fn
------------------------------------------------
0.35     89.1   96.1   92.5    123     15      5
0.50     92.5   96.1   94.3    123     10      5
0.65     95.3   95.3   95.3    122      6      6
0.80     96.0   94.5   95.3    121      5      7
0.90     97.4   88.3   92.6    113      3     15
```

Portuguese alone, which is the language the project exists for:

```
floor    prec    rec     f1     tp     fp     fn
------------------------------------------------
0.35     87.3   96.5   91.7     55      8      2
0.50     91.7   96.5   94.0     55      5      2
0.65     93.2   96.5   94.8     55      4      2
0.80     93.1   94.7   93.9     54      4      3
0.90     96.2   87.7   91.7     50      2      7
```

Moving the floor from 0.35 to 0.65 is worth **2.8 F1 points** on the whole corpus and **3.1 on
Portuguese**, and it costs one true positive out of 128. Nothing else measured here comes close
to that for the effort, and it changes no download.

It was moved to 0.65 on 2026-08-11. The trade is a product decision rather than a tuning
one. A redaction tool's asymmetry is that a false positive costs an unneeded box while a false
negative leaks an identity, which is the reasoning already recorded in the README's own table.
What decided it is that the review step now exists, so an over-eager box is one click to
dismiss and the argument for a low floor is weaker than it was. Portuguese made the strongest
case: at 0.65 its recall is unchanged at 96.5 and its precision gains six points.

Re-measured after the change, which is the table at the top of this file: 95.3 precision,
95.3 recall, 95.3 F1, against 89.1 / 96.1 / 92.5 before. The one true positive given up is a
`secret`, and `account_number` recall drops from 100 to 94.4, so a later run should watch those
two rather than the aggregate.

## What a fixed floor does to a model comparison

Quantization shifts the score distribution, so two exports compared at one threshold are being
compared on calibration, not accuracy. The same fp32 export of `urchade/gliner_multi_pii-v1`
scores 87.4 F1 at 0.35 and 94.6 at 0.80. Plan 002's step-1 gate assumed threshold invariance
and is wrong as written; compare candidates at each one's best floor instead.

Best-floor comparison, native CPU (`onnxruntime-node`):

```
export                       size     best floor   f1     pt f1
---------------------------------------------------------------
model_q4.onnx (shipped)      853 MB   0.65         95.3   94.8
self-exported int8, per-ch   333 MB   0.80         94.9   93.8
self-exported fp32           1157 MB  0.80         94.6   n/m
```

The per-channel int8 export is **39% of the size for 0.4 F1**, which would clear the bar in
`tools/model-export/README.md` if native CPU were the only runtime. It is not, and this does
**not** refute the README's account of the int8 collapse: that collapse is specifically about
the browser's wasm integer kernels, and the README already records that the old int8 export
"scores correctly on native CPU". So this measurement confirms on node what was already known
and leaves the real question open. Whether per-channel quantization survives wasm has to be
measured in a browser, and until it is, no download change is justified.

## Per-channel quantization does not fix the browser collapse

Measured 2026-08-11 in a real browser against the dev server, using the self-exported
per-channel int8 from `tools/model-export/`. One sentence, the same one in every run:
`Fatura para Mariana Duarte Rocha, CPF 529.982.247-25, em 14/03/2024.` The number that matters
is the model's score for the name, because that is the head the README records as collapsing.

```
runtime                              score for "Mariana Duarte Rocha"
-------------------------------------------------------------------
onnxruntime-node, native CPU                                  0.9972
browser, WebGPU                                               0.0911
browser, wasm                                                 0.2084
```

The wasm figure lands where the README's account said it would, at 0.17. So the hypothesis
behind plan 002, that the collapse was an artifact of per-tensor quantization and that
`per_channel=True` would fix it, is **wrong**. Per-channel changes nothing in the browser, and
WebGPU is worse than wasm rather than better.

Two things follow. The README's line about the collapse should say "in the browser" rather than
"on the browser's wasm integer kernels", since WebGPU fails at least as badly. And int8 is off
the table as a way to shrink the download, whatever the recipe, which leaves vocabulary
trimming as the only untested lever: it deletes embedding rows rather than reducing precision,
so it does not touch the arithmetic that is breaking here.

The page that produced these numbers is `apps/web/wasm-check.html`. Drop a candidate at
`apps/web/public/candidate.onnx`, run `pnpm dev --filter=web`, and open `/wasm-check.html` for
the default device or `/wasm-check.html?device=wasm` to force the fallback path. It seeds the
candidate into CacheStorage under the pinned model URL, so it exercises the app's own loading
and device-selection code rather than a parallel copy of it.
