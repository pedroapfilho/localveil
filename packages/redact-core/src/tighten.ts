import type { Span } from "./types";

const VERIFIED = 1;

const encloses = (outer: Span, inner: Span) => outer.start <= inner.start && outer.end >= inner.end;

const digitsIn = (value: string) => /\d/v.test(value);

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
