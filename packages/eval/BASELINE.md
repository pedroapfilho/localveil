# Baseline

The measurement plans 002 and 005 compare against. Regenerate with
`pnpm --filter @repo/eval start` and replace the tables below, keeping the old ones in git
history rather than in this file.

## What was measured

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Commit      | `c09a9f6`                                           |
| Date        | 2026-08-20                                          |
| Model       | `onnx-community/gliner_multi_pii-v1`                |
| Revision    | `2e0397a7e8a250d76c37122232b3cbde42c8d629`          |
| File        | `model_q4.onnx` (853 MB on disk)                    |
| Runtime     | `onnxruntime-node` 1.24.3, native CPU, darwin arm64 |
| Score floor | 0.65                                                |
| Corpus      | 32 documents, 12 pt, 11 en, 9 es                    |

Predictions are merged by label before scoring, because two detectors finding the same value
paint one rectangle, not two. Matching is then one-to-one and greedy by overlap length: a
prediction pairs with an expected span when the labels agree and the ranges overlap by at
least one character. The exact table repeats the pass with boundary equality required.

## Which table to read

The detector is not what a redactor hands the review list. `en-10-defined-terms` writes its
party labels the way a contract does, bare rather than behind an article, and the model reads
all 44 of them as people at 0.97 and above. They are false positives in the detection table
and gone from the whole-analysis table, which is what the pipeline actually produces. Read the
last table for pipeline quality and the first for model behaviour, and do not compare the two.

## Detection, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    94.7  100.0   97.3     18      1      0
private_address   93.3  100.0   96.6     14      1      0
private_date      94.1  100.0   97.0     16      1      0
private_email    100.0  100.0  100.0     24      0      0
private_person    47.6  100.0   64.5     40     44      0
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0   40.0   57.1      2      0      3
secret           100.0   60.0   75.0      3      0      2
TOTAL             73.7   96.4   83.5    132     47      5
```

## Detection, exact boundaries

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    94.7  100.0   97.3     18      1      0
private_address   93.3  100.0   96.6     14      1      0
private_date      94.1  100.0   97.0     16      1      0
private_email    100.0  100.0  100.0     24      0      0
private_person    47.6  100.0   64.5     40     44      0
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0   40.0   57.1      2      0      3
secret            66.7   40.0   50.0      2      1      3
TOTAL             73.2   95.6   82.9    131     48      6
```

## By language, overlap matching

```
label   prec    rec     f1     tp     fp     fn
-----------------------------------------------
en      49.4   91.5   64.2     43     44      4
es     100.0   97.1   98.6     34      0      1
pt      94.8  100.0   97.3     55      3      0
```

## Pattern layer alone, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number   100.0  100.0  100.0     18      0      0
private_address  100.0    7.1   13.3      1      0     13
private_date     100.0  100.0  100.0     16      0      0
private_email    100.0  100.0  100.0     24      0      0
private_person   100.0    0.0    0.0      0      0     40
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0    0.0    0.0      0      0      5
secret           100.0    0.0    0.0      0      0      5
TOTAL            100.0   54.0   70.1     74      0     63
```

## Detection plus the structural layer, overlap matching

The CSV and JSON field-name layer from `@repo/redact-text`, scored on top of detection. It
only applies to documents whose id ends in `csv` or `json`, so most rows are unchanged.

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    94.7  100.0   97.3     18      1      0
private_address   93.3  100.0   96.6     14      1      0
private_date      94.1  100.0   97.0     16      1      0
private_email    100.0  100.0  100.0     24      0      0
private_person    47.6  100.0   64.5     40     44      0
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0  100.0  100.0      5      0      0
secret           100.0  100.0  100.0      5      0      0
TOTAL             74.5  100.0   85.4    137     47      0
```

## Whole analysis, overlap matching

Everything above plus the repeats layer and the defined-terms filter, composed the way
`redact-text` composes them. This is what reaches the review list.

Removing the defined-terms filter takes `en-10-defined-terms` from 8 true positives and no
false ones to 49 false positives, and its `private_person` precision from 100 to 5.8.

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    94.7  100.0   97.3     18      1      0
private_address   93.3  100.0   96.6     14      1      0
private_date      94.1  100.0   97.0     16      1      0
private_email    100.0  100.0  100.0     24      0      0
private_person    97.6  100.0   98.8     40      1      0
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0  100.0  100.0      5      0      0
secret           100.0  100.0  100.0      5      0      0
TOTAL             97.2  100.0   98.6    137      4      0
```
