# Baseline

The measurement plans 002, 005 and 007 compare against. Regenerate with
`pnpm --filter @repo/eval start` and replace the tables below, keeping the old ones in git
history rather than in this file.

## What was measured

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Commit      | `4187d37`                                           |
| Date        | 2026-08-10                                          |
| Model       | `onnx-community/gliner_multi_pii-v1`                |
| Revision    | `2e0397a7e8a250d76c37122232b3cbde42c8d629`          |
| File        | `model_q4.onnx` (853 MB on disk)                    |
| Runtime     | `onnxruntime-node` 1.24.3, native CPU, darwin arm64 |
| Score floor | 0.35                                                |
| Corpus      | 30 documents, 12 pt, 9 en, 9 es                     |

Matching is one-to-one and greedy by overlap length. A prediction pairs with an expected span
when the labels agree and the character ranges overlap by at least one character. The exact
table repeats the same pass with boundary equality required.

## Detection, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    51.4  100.0   67.9     18     17      0
private_address   76.5  100.0   86.7     13      4      0
private_date      50.0  100.0   66.7     15     15      0
private_email     51.2  100.0   67.7     21     20      0
private_person    90.2  100.0   94.9     37      4      0
private_phone     41.7  100.0   58.8     15     21      0
private_url      100.0   25.0   40.0      1      0      3
secret            75.0   60.0   66.7      3      1      2
TOTAL             60.0   96.1   73.9    123     82      5
```

## Detection, exact boundaries

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number    48.6   94.4   64.2     17     18      1
private_address   76.5  100.0   86.7     13      4      0
private_date      50.0  100.0   66.7     15     15      0
private_email     51.2  100.0   67.7     21     20      0
private_person    90.2  100.0   94.9     37      4      0
private_phone     41.7  100.0   58.8     15     21      0
private_url      100.0   25.0   40.0      1      0      3
secret            50.0   40.0   44.4      2      2      3
TOTAL             59.0   94.5   72.7    121     84      7
```

## By language, overlap matching

```
label   prec    rec     f1     tp     fp     fn
-----------------------------------------------
en      67.3   94.6   78.7     35     17      2
es      60.0   97.1   74.2     33     22      1
pt      56.1   96.5   71.0     55     43      2
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
private_phone     68.2  100.0   81.1     15      7      0
private_url      100.0    0.0    0.0      0      0      4
secret           100.0    0.0    0.0      0      0      5
TOTAL             90.3   50.8   65.0     65      7     63
```

## Reading it

Five things this first run says, recorded so a later run can be compared against a claim
rather than a memory.

**Recall is already high and precision is the problem.** 96.1% recall against 60.0% precision:
82 false positives against 123 true positives. Roughly two boxes in five are painted over
something nobody asked to hide. That inverts the usual assumption behind picking a
higher-recall checkpoint, and it is the strongest argument yet for the review step in plan 003:
the product's weakness is what it over-covers, and a reviewer fixes over-covering for free.

**Portuguese is the worst of the three languages**, at 56.1% precision against English's 67.3%.
That is the maintainer's primary use case and the reason `gliner_multi_pii-v1` was chosen over
`openai/privacy-filter`. Recall in Portuguese is fine (96.5%); it is precision that lags.

**`private_url` recall is 25%** and `secret` recall is 60%, the only two labels the model
genuinely misses. Both are also the two labels the pattern layer contributes nothing to
(0.0 recall each). Anything aimed at recall should start there rather than at names.

**The pattern layer is doing the precise work.** 90.3% precision against the model's 60.0%,
and 100% precision on every checksummed label. Its 68.2% phone precision is the one exception,
and the cause is known: `\b\d{3,4}-\d{4}\b` in `packages/redact-core/src/patterns.ts:154`
claims invoice numbers like `2024-0817`, which `isYearRange` does not catch because the second
half is not a year. That is pinned as a known false positive in
`packages/eval/src/corpus.test.ts` rather than fixed, because plan 001 measures and does not
change the detector.

**Exact-boundary scoring costs almost nothing except on `secret`**, which drops from 66.7 to
44.4 F1. The model finds an API key but disagrees about where it ends. That matters for a
`secret` more than for a name, since half a key is still half a key.
