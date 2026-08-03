import type { Range, Span } from "@repo/redact-core";
import { mergeOverlappingRanges } from "@repo/redact-core";

import { isLineBreak } from "./line-break.ts";

const BLOCK = "█";

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const assertInside = (range: Range, length: number) => {
  if (range.start < 0 || range.end > length) {
    throw new RangeError(
      `Span ${range.start}-${range.end} falls outside the text (length ${length}); refusing to mask a guessed position`,
    );
  }
};

const maskSpans = (text: string, spans: Array<Span>): string => {
  const ranges = mergeOverlappingRanges(spans);

  for (const range of ranges) {
    assertInside(range, text.length);
  }

  return ranges.toReversed().reduce((masked, range) => {
    const covered = [...GRAPHEMES.segment(masked.slice(range.start, range.end))]
      .map((segment) => (isLineBreak(segment.segment) ? segment.segment : BLOCK))
      .join("");

    return masked.slice(0, range.start) + covered + masked.slice(range.end);
  }, text);
};

export { maskSpans };
