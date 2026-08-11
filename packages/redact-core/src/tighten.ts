import type { Span } from "./types.ts";

const VERIFIED = 1;

const encloses = (outer: Span, inner: Span) => outer.start <= inner.start && outer.end >= inner.end;

const digitsIn = (value: string) => /\d/v.test(value);

/**
 * A span whose check digits agree knows where it starts and ends; a span the model guessed at
 * does not. Where the model's span swallows a verified one, the extra text is almost always the
 * label a document prints beside the number, and the README is explicit that the label should
 * stay readable: a licence keeps the word RG next to the blacked-out number.
 *
 * The model's span is only dropped when everything it adds is free of digits, so no part of a
 * number can be lost to this. "CNPJ 45.448.325/0001-70" narrows to the number; two account
 * numbers under one loose span keep the loose span.
 */
const tightenToVerified = (spans: Array<Span>, text: string): Array<Span> => {
  const verified = spans.filter((span) => span.score === VERIFIED);

  if (verified.length === 0) {
    return spans;
  }

  return spans.filter((span) => {
    if (span.score === VERIFIED) {
      return true;
    }

    return !verified.some(
      (exact) =>
        exact.label === span.label &&
        encloses(span, exact) &&
        !digitsIn(text.slice(span.start, exact.start)) &&
        !digitsIn(text.slice(exact.end, span.end)),
    );
  });
};

export { tightenToVerified };
