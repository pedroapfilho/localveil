import type { Span } from "@repo/redact-core";

const encloses = (outer: Span, inner: Span) => outer.start <= inner.start && outer.end >= inner.end;

const digitsIn = (value: string) => /\d/v.test(value);

const tightenToVerified = (
  found: Array<Span>,
  verified: Array<Span>,
  text: string,
): Array<Span> => [
  ...found.filter(
    (span) =>
      !verified.some(
        (exact) =>
          exact.label === span.label &&
          encloses(span, exact) &&
          !digitsIn(text.slice(span.start, exact.start)) &&
          !digitsIn(text.slice(exact.end, span.end)),
      ),
  ),
  ...verified,
];

export { tightenToVerified };
