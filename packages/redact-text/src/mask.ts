import type { Detect, Range } from "@repo/redact-core";

import { isLineBreak } from "./line-break";

const BLOCK = "█";

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const assertInside = (range: Range, length: number) => {
  if (range.start < 0 || range.end > length) {
    throw new RangeError(
      `Span ${range.start}-${range.end} falls outside the text (length ${length}); refusing to mask a guessed position`,
    );
  }
};

const blocksFor = (covered: string) =>
  [...GRAPHEMES.segment(covered)]
    .map((segment) => (isLineBreak(segment.segment) ? segment.segment : BLOCK))
    .join("");

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

const isMasked = (value: string) => value.replaceAll(BLOCK, "").trim().length === 0;

/* A detector shown the masked output can tag a run of blocks as a name, and a span over nothing
   but mask has leaked nothing. */
const ignoringMasks =
  (detect: Detect): Detect =>
  async (text) => {
    const spans = await detect(text);

    return spans.filter((span) => !isMasked(text.slice(span.start, span.end)));
  };

export { ignoringMasks, maskRanges };
