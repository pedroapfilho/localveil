# Corpus

**Every value in this directory is invented.** No document is a copy of a real one, and no
name, address, phone number, email, account number or credential belongs to anybody. The
identifiers that carry check digits (CPF, CNPJ, IBAN, card numbers) were generated to satisfy
their own arithmetic, so they are valid in form and attached to nobody.

Do not add a document containing real personal data, and do not import a dataset that might.

## Format

One JSON file per document:

```json
{
  "id": "pt-01-fatura-servicos",
  "language": "pt",
  "source": "synthetic",
  "marked": "Cliente: [[private_person|Mariana Duarte Rocha]]"
}
```

`marked` carries the text with `[[label|value]]` around every span that should be covered. The
loader strips the markers and derives character offsets from where each value landed, so
offsets are never written by hand and cannot drift when the surrounding text is edited.

`label` is one of the eight in `PiiLabel`. `language` is `en`, `es` or `pt`. `source` is
`synthetic` for generated material and `handwritten` for documents written to probe a specific
failure.

## Adding a document

1. Write the file, wrapping each span in `[[label|value]]`. A value may not contain `]`.
2. If it needs a CPF, CNPJ, IBAN or card number, generate one whose check digits agree. The
   verifiers are exported from `packages/redact-core/src/patterns.ts`.
3. Run `pnpm --filter @repo/eval test`. The suite asserts every span is in bounds, every label
   is used enough, and that nothing the pattern layer finds is left unlabelled.
4. Run `pnpm --filter @repo/eval start` to see what it does to the scores.

## Negative material

Documents whose id ends in `negatives` or `negativos` carry no spans at all. They exist to
catch over-redaction: an invoice number shaped like a CPF but failing its check digits, a year
range like `2019-2024`, acronym-heavy log lines, and common Portuguese and Spanish nouns that
a name detector over-predicts on. A corpus without them rates an over-eager model as excellent.
