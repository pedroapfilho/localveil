# Plan 007: Redact CSV and JSON by their structure, not as prose

> **Executor instructions**: Follow this plan step by step. Run every verification command
> and confirm the expected result before moving to the next step. If anything in the "STOP
> conditions" section occurs, stop and report. Do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7fdfa30..HEAD -- packages/redact-text packages/redact-core`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-eval-harness.md` (BASELINE.md must exist)
- **Category**: correctness
- **Planned at**: commit `7fdfa30`, 2026-08-10

## Why this matters

`.csv` and `.json` go through the same path as `.txt` and `.md`: the whole file is read as one
string and handed to a named-entity model trained on prose. A CSV is not prose. A column headed
`email` guarantees that every cell beneath it is an email, and a JSON key named `cpf` guarantees
the same about its value, and neither fact is used at all today. Instead the model is asked to
recognise a bare value stripped of the sentence context it was trained on, which is the hardest
possible version of the job.

The failure is asymmetric and quiet. A name in a `nome` column with no surrounding sentence is
exactly the case a NER model walks past, and the README already says as much about a different
gap: "A model that catches a full name in one sentence will often walk past the bare first name
two lines down." A leaked column is worse than a leaked sentence, because it is every row.

Structure gives near-certainty for free, on the format most likely to hold a bulk export of
real people. The model still runs; this adds a layer beneath it, in the same spirit as the
existing checksum pattern layer.

## Current state

### One redactor for five formats

`packages/redact-text/src/index.ts:6-13`:

```ts
const TEXT_EXTENSIONS = new Set([".csv", ".json", ".log", ".md", ".txt"]);

const hasTextExtension = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
};
```

and its `redact` (`packages/redact-text/src/index.ts:16-49`) reads the file, detects over the
whole string, expands repeats, and masks. Nothing branches on the extension after `accepts`.

### The layer this parallels

`packages/redact-core/src/patterns.ts` is the precedent. It runs on every document beneath the
model and contributes spans that are verified rather than guessed, each with `score: 1`
(`packages/redact-core/src/patterns.ts:170`). A structural layer has the same shape: it produces
spans with high confidence from evidence the model does not have.

### The masking contract to preserve

`packages/redact-text/src/mask.ts` replaces each covered grapheme with `█` and leaves line
breaks intact, deliberately:

```ts
const covered = [...GRAPHEMES.segment(masked.slice(range.start, range.end))]
  .map((segment) => (isLineBreak(segment.segment) ? segment.segment : BLOCK))
  .join("");
```

The README explains why: "A span that runs off the end of one line would otherwise weld two
rows of a log or a CSV together." A structural layer must produce character ranges over the
**original string**, so this masking is unchanged. Do not add a second output path that
re-serialises the CSV or JSON; a reserialised JSON is not the user's file.

### Repo conventions to match

- Arrow functions, `const` over `let`, exports at the end, alphabetically sorted keys and union
  members.
- Hand-written parsing over a new dependency where the scope is small. `packages/redact-core/src/patterns.ts`
  is 177 lines of hand-written matchers with no library behind it. A CSV parser that handles
  quoting is a legitimate exception if it is small and has no transitive dependencies; a JSON
  parser is not, because the position information needed is obtainable without one (see step 3).
- **No comments that restate the code.**
- Max 400 lines per file. Put the CSV and JSON layers in separate modules.

## Commands you will need

| Purpose   | Command                                | Expected on success         |
| --------- | -------------------------------------- | --------------------------- |
| Install   | `pnpm install`                         | exit 0                      |
| Typecheck | `pnpm typecheck`                       | exit 0                      |
| Tests     | `pnpm --filter @repo/redact-text test` | all pass                    |
| All tests | `pnpm test`                            | all pass                    |
| Lint      | `pnpm lint`                            | exit 0                      |
| Score     | `pnpm --filter @repo/eval start`       | prints totals table, exit 0 |

## Scope

**In scope**:

- `packages/redact-text/src/structured-csv.ts` and `structured-csv.test.ts` (create)
- `packages/redact-text/src/structured-json.ts` and `structured-json.test.ts` (create)
- `packages/redact-text/src/field-labels.ts` and `field-labels.test.ts` (create): the
  key-name-to-label mapping, in English, Portuguese and Spanish.
- `packages/redact-text/src/index.ts`: dispatch to the right structural layer by extension.
- `packages/eval/corpus/`: add CSV and JSON documents if plan 001's corpus lacks them.
- `README.md`: the Formats table row for text and the "Text: read, detect, mask" block.

**Out of scope** (do NOT touch):

- `packages/redact-text/src/mask.ts` and `line-break.ts`. The masking contract is correct.
- `packages/redact-core/src/patterns.ts`. The structural layer is additive and lives in
  `@repo/redact-text`, not in core, because it is format-specific.
- `packages/pii-detect/**`. The model still runs over the whole file exactly as it does today.
  This plan **adds** spans; it never removes the model pass or narrows what it sees.
- `.log` and `.md` and `.txt`. They stay on the prose path.
- Any output that re-serialises the file. Character ranges over the original string only.

## Git workflow

- Branch: `advisor/007-structured-formats`
- Conventional commit, e.g. `feat(redact-text): redact csv and json by field name`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the field-name map

Create `packages/redact-text/src/field-labels.ts` exporting a function from a field name to a
`PiiLabel | undefined`. It must normalise the incoming name first: lowercase, strip diacritics,
and collapse `_`, `-`, `.` and spaces, so `Nome_Completo`, `nome completo` and `nomeCompleto`
all reach the same key.

Cover at minimum, in all three languages:

- `private_person`: name, full name, first name, last name, nome, sobrenome, nombre, apellido,
  usuario, username
- `private_email`: email, e-mail, correo, correio
- `private_phone`: phone, telephone, telefone, celular, telefono, movil, mobile
- `private_address`: address, endereco, logradouro, direccion, cep, zip, postal code, city,
  cidade, ciudad
- `private_date`: birth date, date of birth, data de nascimento, nascimento, fecha de nacimiento
- `account_number`: cpf, cnpj, rg, cnh, iban, ssn, tax id, account, conta, cuenta, card, cartao,
  tarjeta, passport, passaporte, pasaporte
- `secret`: password, senha, contrasena, token, api key, secret

Be conservative at the edges. `id`, `code`, `number`, `data` and `date` alone are too generic
and must **not** map to anything: `data` is Portuguese for date but also the most common
generic column name in the world, and mapping it would black out entire spreadsheets. Record
that decision in the test names rather than a comment.

**Verify**: `pnpm --filter @repo/redact-text test` passes with cases for each label, for the
three normalisation forms, and for every generic name in the do-not-map list returning
`undefined`.

### Step 2: The CSV layer

Create `packages/redact-text/src/structured-csv.ts` exporting a function from the file text to
`Array<Span>`. It must:

1. Parse the header row, mapping each column index to a label via step 1. Columns with no match
   contribute nothing.
2. For every subsequent row, emit a span covering the **cell value's character range in the
   original string** for each matched column.
3. Handle quoted fields, embedded commas, embedded newlines inside quotes, and `""` escapes,
   and emit ranges that cover the value **inside** the quotes, not the quotes themselves.
4. Detect the delimiter between `,` and `;`, since Portuguese and Spanish locale exports
   commonly use `;`.
5. Skip empty cells, so an empty value does not produce a zero-width span.
6. Bail out and return an empty array when the first row does not look like a header (no column
   matches, or the row count is 1). A CSV without headers falls back to the prose path with no
   loss.

Every span gets `score: 1`, matching the pattern layer's convention for evidence-based spans.

**Verify**: `pnpm --filter @repo/redact-text test` passes with cases for: a simple header match,
a quoted cell containing the delimiter, a quoted cell containing a newline, `;` delimited,
an empty cell, a headerless file returning empty, and a file where no column matches returning
empty.

### Step 3: The JSON layer

Create `packages/redact-text/src/structured-json.ts` exporting a function from the file text to
`Array<Span>`. Getting character positions out of `JSON.parse` is not possible directly; use the
reviver to learn which key paths hold matched labels, then locate those values in the source
text with a small scanner, **or** write a position-tracking scan over the source directly.
Either is acceptable; the second is fewer moving parts.

Requirements:

1. Match on the key name at any depth, including inside arrays of objects, which is the shape a
   bulk export takes.
2. Emit spans over the string value's characters **inside** its quotes, so the JSON stays
   parseable after masking. A masked `"█████"` is still valid JSON; a masked `█████████` is not.
3. Numbers and booleans under a matched key: emit the span over the literal. A masked bare
   number breaks the JSON, so for non-string values emit nothing and record it. State this
   limitation in the README rather than producing an invalid file.
4. Return an empty array when the text does not parse as JSON. A `.json` file that is actually
   JSON Lines must fall back cleanly rather than throwing.

**Verify**: `pnpm --filter @repo/redact-text test` passes with cases for: a flat object, a
nested object, an array of objects, a key with a non-string value, invalid JSON returning empty,
JSON Lines returning empty, and a masked output that still parses with `JSON.parse`.

### Step 4: Dispatch by extension

In `packages/redact-text/src/index.ts`, after `detect` returns and before the repeat expansion,
add the structural spans for `.csv` and `.json` only. Order matters for the repeat pass: the
structural spans must be part of the input to `tokensFromSpans`, so a name found structurally
in one column also gets covered where it appears in free text elsewhere in the same file.

The model pass is unchanged and still runs over the whole file.

**Verify**: `pnpm --filter @repo/redact-text test` passes. `redactionCount` must not decrease
for any existing fixture; assert that on `fixtures/sample.csv` and `fixtures/sample.json`.

### Step 5: Prove it finds strictly more

Run `pnpm --filter @repo/eval start` and compare against `packages/eval/BASELINE.md`.

The bar:

- Recall on CSV and JSON corpus documents must rise.
- Precision on those documents must not fall by more than 0.02.
- Scores on prose, PDF-derived and log documents must be **identical**, since nothing on those
  paths changed. Any movement there means the dispatch is leaking into formats it should not
  touch.

Add CSV and JSON documents to the corpus if plan 001 did not include enough of them, including a
negative case: a CSV with a column named `data` holding invoice dates, which must not be
redacted by the structural layer.

**Verify**: the comparison table, with the three conditions above stated as pass or fail.

### Step 6: Update the README

The Formats table lists `.csv` and `.json` under "Read as text". Correct it, and add a short
paragraph to the "Text: read, detect, mask" block describing the field-name layer and its two
stated limits: numeric JSON values are left alone to keep the file parseable, and a headerless
CSV falls back to the prose path. Keep the existing voice; never use an em dash.

**Verify**: `pnpm format:check` exits 0, `pnpm lint` exits 0.

## Test plan

New test files beside their subjects, modelled on `packages/redact-core/src/patterns.test.ts`
(flat, table-driven, no mocks):

- `field-labels.test.ts`: per-label cases in three languages, three normalisation forms, and the
  full do-not-map list.
- `structured-csv.test.ts`: the seven cases from step 2.
- `structured-json.test.ts`: the seven cases from step 3, including the parse-after-mask
  assertion.
- `packages/redact-text/src/index.test.ts`: dispatch fires for `.csv` and `.json` and does not
  fire for `.txt`, `.md` or `.log`; structural spans reach the repeat expansion.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `pnpm test` exits 0 with at least 25 new tests in `packages/redact-text`
- [ ] A masked JSON file still parses with `JSON.parse`
- [ ] `pnpm --filter @repo/eval start` shows higher CSV/JSON recall and **identical** scores on
      prose, log and PDF-derived documents
- [ ] `redactionCount` did not decrease on `fixtures/sample.csv` or `fixtures/sample.json`
- [ ] `git status` shows no changes under `packages/pii-detect/` or
      `packages/redact-core/src/patterns.ts`
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Scores move on prose, log or PDF-derived documents. The dispatch is leaking.
- The CSV parser needs a dependency with transitive dependencies. Report what you need and why.
- Masking a JSON value produces text that `JSON.parse` rejects.
- Precision on CSV documents falls by more than 0.02. That means the field-name map is too
  aggressive; report which key caused it rather than silently narrowing the map.
- You find yourself wanting to re-serialise the file to make masking easier. Out of scope: the
  output must be the user's file with characters replaced.

## Maintenance notes

- The field-name map is the part that will grow. It is a translation asset as much as a code
  one, and every addition needs the same conservatism as step 1: a name that is generic in any
  of the three languages must not map, however useful it looks in the other two.
- The scoped survivor of a previously refuted idea belongs here: **always index digit-bearing
  OCR words even below the confidence floor**, so check-digit patterns can fire on them. The
  blanket version was refuted because it breaks the tofu-page protection in
  `packages/ocr/src/readable.ts`; the digit-only version does not. It is a separate small plan
  in `@repo/ocr`, not this one, but it is the natural neighbour of this work.
- A reviewer should scrutinise: that quoted CSV cells produce ranges inside the quotes, that the
  do-not-map list is actually enforced rather than merely documented, and that the model pass
  still sees the whole file.
- If XLSX or DOCX support is ever added, this layer generalises to them and the field-name map
  is the reusable part. The parsers are not.
