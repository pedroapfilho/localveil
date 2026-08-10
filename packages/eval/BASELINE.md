# Baseline

The measurement plans 002 and 005 compare against. Regenerate with
`pnpm --filter @repo/eval start` and replace the tables below, keeping the old ones in git
history rather than in this file.

## What was measured

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Commit      | `10ff3d8`                                           |
| Date        | 2026-08-10                                          |
| Model       | `onnx-community/gliner_multi_pii-v1`                |
| Revision    | `2e0397a7e8a250d76c37122232b3cbde42c8d629`          |
| File        | `model_q4.onnx` (853 MB on disk)                    |
| Runtime     | `onnxruntime-node` 1.24.3, native CPU, darwin arm64 |
| Score floor | 0.35                                                |
| Corpus      | 30 documents, 12 pt, 9 en, 9 es                     |

Predictions are merged by label before scoring, because two detectors finding the same value
paint one rectangle, not two. Matching is then one-to-one and greedy by overlap length: a
prediction pairs with an expected span when the labels agree and the ranges overlap by at
least one character. The exact table repeats the pass with boundary equality required.

## Detection, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    90.0  100.0   94.7     18      2      0
private_address   81.3  100.0   89.7     13      3      0
private_date      78.9  100.0   88.2     15      4      0
private_email    100.0  100.0  100.0     21      0      0
private_person    92.5  100.0   96.1     37      3      0
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0   25.0   40.0      1      0      3
secret            75.0   60.0   66.7      3      1      2
TOTAL             89.1   96.1   92.5    123     15      5
```

## Detection, exact boundaries

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    75.0   83.3   78.9     15      5      3
private_address   75.0   92.3   82.8     12      4      1
private_date      78.9  100.0   88.2     15      4      0
private_email    100.0  100.0  100.0     21      0      0
private_person    90.0   97.3   93.5     36      4      1
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0   25.0   40.0      1      0      3
secret            50.0   40.0   44.4      2      2      3
TOTAL             84.8   91.4   88.0    117     21     11
```

## By language, overlap matching

```
label   prec    rec     f1     tp     fp     fn
-----------------------------------------------
en      94.6   94.6   94.6     35      2      2
es      86.8   97.1   91.7     33      5      1
pt      87.3   96.5   91.7     55      8      2
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
account_number    90.0  100.0   94.7     18      2      0
private_address   81.3  100.0   89.7     13      3      0
private_date      78.9  100.0   88.2     15      4      0
private_email    100.0  100.0  100.0     21      0      0
private_person    92.5  100.0   96.1     37      3      0
private_phone     88.2  100.0   93.8     15      2      0
private_url      100.0   25.0   40.0      1      0      3
secret            83.3  100.0   90.9      5      1      0
TOTAL             89.3   97.7   93.3    125     15      3
```

## Reading it

**Recall is 96.1% and precision 89.1%.** Both are healthier than the pipeline's reputation
suggests. An earlier version of this file reported 60% precision; that was a flaw in the
scorer, not in the detector. The model and the pattern layer both find the same email, and
counting that as one hit and one false alarm punished agreement. Predictions are now merged by
label before scoring, which is what actually happens before a rectangle is painted.

**`private_url` is the real hole.** 25% recall, 3 of 4 missed, and the pattern layer
contributes nothing to it. `secret` was the second hole at 60% until the structural layer
closed it.

**Portuguese is not the weak language it was assumed to be.** 87.3% precision and 96.5% recall,
against English's 94.6 / 94.6. Portuguese trails on precision by seven points and leads on
recall by two. It is the language with the most spans in the corpus (55 of 123), so it also
carries the most absolute errors.

**The pattern layer is the precise one and the model is the broad one**, which is the division
they were built for: 97.0% precision at 50.8% recall for patterns, against the model's wider
net. The pattern layer's only imprecision is 2 false positives on phones, both the same known
defect: `\b\d{3,4}-\d{4}\b` in `packages/redact-core/src/patterns.ts:154` claims invoice
numbers like `2024-0817`, and `isYearRange` does not catch it because the second half is not a
year. It is pinned in `packages/eval/src/corpus.test.ts` rather than fixed.

**The structural layer costs nothing and closes the `secret` gap.** Recall 96.1 to 97.7,
precision 89.1 to 89.3, no label regressed. It found both API keys and passwords the model
walked past in JSON. An earlier draft also mapped `city`, `cidade` and `ciudad` to
`private_address`, which cost 29 points of address precision for no recall; a bare city is not
something the model covers in prose either, so those field names were dropped.

**Exact-boundary scoring costs 4.5 points of F1 overall and 22 on `secret`.** The model finds
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

It is left at 0.35 deliberately, because the trade is a product decision rather than a tuning
one. A redaction tool's asymmetry is that a false positive costs an unneeded box while a false
negative leaks an identity, which is the reasoning already recorded in the README's own table.
What changed is that the review step now exists, so an over-eager box is cheap to dismiss and
the argument for a low floor is weaker than it was. Portuguese is the strongest case for
moving: at 0.65 its recall is unchanged at 96.5 and its precision gains six points.

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
