import type { Range } from "@repo/redact-core";

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

// One block per grapheme, so an emoji or an accented letter takes one box rather than two. A line
// break inside a covered run survives: without it a span running off the end of a line would weld
// two rows of a log or a CSV together.
const blocksFor = (covered: string) =>
  [...GRAPHEMES.segment(covered)]
    .map((segment) => (isLineBreak(segment.segment) ? segment.segment : BLOCK))
    .join("");

/**
 * Takes the merged, sorted, non-overlapping ranges the caller already computed. Every index is
 * read against the original text in one forward pass, so a run that collapses to fewer graphemes
 * cannot shift the ranges behind it.
 */
const maskRanges = (text: string, ranges: ReadonlyArray<Range>): string => {
  const parts: Array<string> = [];
  let cursor = 0;

  for (const range of ranges) {
    assertInside(range, text.length);

    parts.push(text.slice(cursor, range.start), blocksFor(text.slice(range.start, range.end)));
    cursor = range.end;
  }

  parts.push(text.slice(cursor));

  return parts.join("");
};

export { maskRanges };
