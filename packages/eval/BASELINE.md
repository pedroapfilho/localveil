# Baseline

The measurement plans 002 and 005 compare against. Regenerate with
`pnpm --filter @repo/eval start` and replace the tables below, keeping the old ones in git
history rather than in this file.

## What was measured

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Commit      | `74ecb8d`                                           |
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
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0   40.0   57.1      2      0      3
secret           100.0   60.0   75.0      3      0      2
TOTAL             96.9   95.3   96.1    123      4      6
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
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0   40.0   57.1      2      0      3
secret            66.7   40.0   50.0      2      1      3
TOTAL             94.5   93.0   93.8    120      7      9
```

## By language, overlap matching

```
label   prec    rec     f1     tp     fp     fn
-----------------------------------------------
en      97.2   89.7   93.3     35      1      4
es     100.0   94.3   97.1     33      0      2
pt      94.8  100.0   97.3     55      3      0
```

## Pattern layer alone, overlap matching

```
label             prec    rec     f1     tp     fp     fn
---------------------------------------------------------
account_number   100.0   94.4   97.1     17      0      1
private_address  100.0    7.7   14.3      1      0     12
private_date     100.0  100.0  100.0     15      0      0
private_email    100.0  100.0  100.0     21      0      0
private_person   100.0    0.0    0.0      0      0     37
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0    0.0    0.0      0      0      5
secret           100.0    0.0    0.0      0      0      5
TOTAL            100.0   53.5   69.7     69      0     60
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
private_phone    100.0  100.0  100.0     15      0      0
private_url      100.0  100.0  100.0      5      0      0
secret           100.0  100.0  100.0      5      0      0
TOTAL             97.0   99.2   98.1    128      4      1
```

## Reading it

**Precision and recall are both 95.3%.** They were 89.1 and 96.1 until the score floor moved
from 0.35 to 0.65 on 2026-08-11, which traded one true positive for nine false ones. An earlier
version of this file reported 60% precision; that was a flaw in the scorer, not the detector.
The model and the pattern layer both find the same email, and counting that as one hit and one
false alarm punished agreement. Predictions are merged by label before scoring now, which is
what happens before a rectangle is painted.

**`private_url` was never the hole it looked like.** It read 25% recall until the four URLs in
the corpus were re-examined on 2026-08-11. The model had found exactly one, the personal social
profile, and skipped a file-share link, an admin panel and a login page. Those are not personal
data, so the miss was the corpus being wrong rather than the model. The three were unlabelled
and four genuine profile links added; the model now reads 100% precision at 40% recall, and it
finds both URLs that sit in a sentence while missing all three that sit bare in a CSV column.

**What is left of both holes is bare values in structured files, which is what the structural
layer is for.** With it, `private_url` and `secret` are both 100/100 and overall recall is
99.2%. That is the division working as designed: a named-entity model reads prose, and field
names read tables.

**Portuguese now leads on recall and trails on precision.** 93.2 / 96.5 against English's
97.2 / 94.6. It carries the most spans in the corpus (55 of 123) so it also carries the most
absolute errors, but the language the project exists for is not the weak one.

**The pattern layer is the precise one and the model is the broad one**, which is the division
they were built for: 97.0% precision at 50.8% recall for patterns, against the model's wider
net. The pattern layer's only imprecision is 2 false positives on phones, both the same known
defect: `\b\d{3,4}-\d{4}\b` in `packages/redact-core/src/patterns.ts:154` claims invoice
numbers like `2024-0817`, and `isYearRange` does not catch it because the second half is not a
year. It is pinned in `packages/eval/src/corpus.test.ts` rather than fixed.

**The structural layer is free and closes both gaps.** Recall 95.3 to 99.2, precision 95.3 to
95.5, no label regressed. An earlier draft also mapped `city`, `cidade` and `ciudad` to
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

## Two thresholds, not one

The floor split on 2026-08-11. Detection returns everything down to `MIN_SCORE` (0.15) in
`packages/pii-detect/src/detector.ts`, and `APPLY_SCORE` (0.65) in
`packages/redact-core/src/detections.ts` decides what that means: at or above it a span is
covered unless somebody dismisses it, below it the span is a suggestion and is covered only if
somebody ticks it. Nothing under the apply floor reaches a file on its own, which is what makes
reading down to 0.15 affordable.

Every table above is scored at 0.65, so they describe what gets covered without a reviewer. The
suggestion band changes nothing about them.

## Vocabulary trimming works, once the word-initial marker survives

The premise held up: 192M of this checkpoint's 289M parameters are the embedding matrix
(250,105 rows by 768, measured). Trimming it to the scripts localveil reads is the only lever
left on the download after int8 was ruled out.

The first attempt kept 96,820 of 250,101 pieces and cost 5 F1, which looked like the literature
being wrong about pruning. It was a bug in the keep rule. `▁` is U+2581, in Block Elements, and
the rule only kept up to U+206F, so **every word-initial piece was deleted** and only the bare
form survived. `▁para` became `▁` plus `para`. Nothing hit an unknown token, so the tokenizer
looked healthy; what changed was segmentation.

```
sentence                                          original  broken trim  fixed trim
--------------------------------------------------------------------------------
Fatura para Mariana Duarte Rocha, CPF ...                22           31          22
Assinado por Joao Pereira em Niteroi                     12           19          12
Alejandra Ibarra Mendoza, Calle Alcala 214, ...          15           22          15
Eleanor Whitfield, 118 Marlow Street, Bristol            12           18          12
```

With U+2581 kept, 134,672 of 250,101 pieces survive, segmentation is identical on every sample,
and the cost is small. Compared like for like, against the same pipeline's untrimmed export
rather than against the shipped file, each at its own best floor:

```
export                        size      best floor   prec    rec     f1
-----------------------------------------------------------------------
self-exported fp32           1157 MB    0.80         93.2   96.1   94.6
trimmed fp32                  803 MB    0.80         93.2   95.3   94.3
```

**0.3 F1 and 0.8 recall for 31% fewer bytes** at fp32. Quantized the same way the shipped file
is, with `MatMulNBitsQuantizer` at 4 bits, it stops costing anything at all:

```
export                        size      floor   prec    rec     f1     pt f1
----------------------------------------------------------------------------
model_q4.onnx (shipped)      853 MB     0.65    95.3   95.3   95.3     96.5
trimmed, 4-bit               539 MB     0.65    95.3   95.3   95.3     96.5
```

Every label matches, every language matches, and all 30 corpus documents come back with
**identical spans**. 539 MB against 853 MB is 37% off the download for nothing measurable.

It survives the browser, which is the gate that killed int8. Scoring the name in the same probe
sentence `apps/web/wasm-check.html` uses:

```
runtime                       int8, per-channel    trimmed 4-bit
------------------------------------------------------------------
onnxruntime-node, native CPU             0.9972           0.9970
browser, WebGPU                          0.0911           0.9956
browser, wasm                            0.2084           0.9956
```

That difference is the point. Quantization changes the arithmetic and DeBERTa's attention does
not survive it in a browser; trimming only deletes rows the app never looks up, so there is
nothing for a wasm kernel to get wrong.

What is left before this ships is publishing: the weights and the trimmed `tokenizer.json` have
to sit at one pinned revision in a repo the project controls, because `detector.ts` loads the
tokenizer by `MODEL_ID` and revision and a trimmed model with the original tokenizer fails
loudly (`idx=250103 must be within the inclusive range [-134676,134675]`). Then three constants
change and the first run gets 314 MB shorter.

## An "api key" prompt looked right and measured wrong

`secret` reads 60% recall from the model alone, and the obvious move was the one free entity
prompt slot: the model is asked for `password` and never for a key, while the corpus holds
`sk_live_9f2b7c41ae55d0836b1e` and friends. Adding `api key` did what it was supposed to, in
isolation: the model's own `secret` recall went 60% to 80%.

End to end it was a loss. The structural layer already reads `apiKey` and `senha` as field names
and had `secret` at 100 precision and 100 recall; the extra prompt could only add
disagreement, and it did.

```
                       secret prec/rec/f1        overall prec/rec/f1
without the prompt     100.0 / 100.0 / 100.0     95.5 / 99.2 / 97.3
with the prompt         83.3 / 100.0 /  90.9     94.8 / 98.4 / 96.6
```

It also moved a detection from Portuguese to English: pt recall 100.0 to 98.2, en 89.7 to 92.3.
Reverted.

The lesson is about which number to read. `secret` at 60% is the model-alone column, and no user
ever sees that column, because the structural layer runs underneath every document. Tuning
against it optimises a component instead of the product.

## Viterbi decoding has nothing left to fix

The greedy score-ordered suppression in `packages/pii-detect/src/gliner-decode.ts` was flagged
early for replacement with constrained Viterbi decoding, on the model card's own advice, because
sub-threshold mid-token splits can leak the middle of a name.

There is no headroom for it. `private_person` reads 97.4 precision and 100 recall under overlap
matching, and **the same 97.4 / 100 under exact boundaries**: not one name span is off by a
character. Where boundaries do drift is `account_number`, 94.4 to 88.9 F1 between the two rules,
and `secret`, 75.0 to 50.0. Neither is a name, so neither is what Viterbi was proposed for, and
`secret` is already 100/100 once field names are read.

Rejected on the measurement rather than on effort. If boundary drift ever matters enough to
chase, the label to chase is `account_number`.

## A partial date survives the fixtures, and the verify pass caught it

Running `fixtures/sample.csv` end to end leaves `2 April ████` in the output: the year is
covered and the day and month are not. `warning.notFullyRedacted` fires, which is the pass doing
its job on real data for the first time rather than in a test.

The cause is not the verify pass. `private_date` spans can come back covering only part of a
written date, and nothing downstream widens them. It is a real gap, left open here because it
belongs to detection rather than to verification, and because the warning means a user is told.

The same run showed the pass crying wolf on structured files. A CSV header is never redacted, by
design, so a column called `email` came back as a surviving email on every CSV. Verification now
skips the header row for `.csv`, which drops two false alarms out of three on that fixture and
leaves the one that matters.

## Reading the PDF text layer instead of recognising it

A typed PDF used to pay full OCR: `readImageText` ran on every page and the file's own text
layer was only sampled to guess a language. That is the dominant cost of a PDF, spent to
re-derive, worse, text the file already holds.

A page whose text layer yields at least 12 words is now read from that layer. `fixtures/sample.pdf`
goes end to end in **550 ms** and never calls the recogniser; both target names are absent from
the output, checked with `strings`.

Word boxes come from splitting each run by character count and growing every box by one
character width on each side. That is the drift the README warned about, and the bleed is the
answer to it: over-covering by a character is a wider black rectangle, under-covering leaves the
first letter of a name showing. A page with a thin layer, or a viewport with no usable transform,
still goes to OCR, so the fallback is the safe direction.

## The pattern layer is now perfectly precise

Both defects this file had been recording got fixed on 2026-08-11, and they were mirror images
of each other: one leaked, one over-covered.

**`2 April ████`.** The date matcher only knew `dd/mm/yyyy`, so a written date reached the
pattern layer unmatched and the model covered its year alone. Written dates are now matched
whole, in all three languages, with and without the accent on `março`, because OCR drops accents
often enough that requiring one loses real dates. `fixtures/sample.csv` comes back with no
warnings.

**`2024-0817`.** `\b\d{3,4}-\d{4}\b` claimed order numbers as NANP phone numbers, and
`isYearRange` missed it because the second half is not a year. A first group that looks like a
year is now rejected, which keeps `555-0181` and drops `2024-0817`. The corpus test that pinned
this as a known false positive is now a regression guard asserting the pattern layer finds
nothing at all in negative material.

```
                        before              after
private_date     100.0 / 73.3 / 84.6   100.0 / 100.0 / 100.0
private_phone     88.2 / 100.0 / 93.8  100.0 / 100.0 / 100.0
pattern total     97.0 / 50.8 / 66.7   100.0 /  53.5 /  69.7
```

The pattern layer now runs at **100% precision with zero false positives**, which is what a
checksummed layer beneath a statistical one should look like. End to end that is F1 97.3 to 98.1
with recall unchanged at 99.2.
