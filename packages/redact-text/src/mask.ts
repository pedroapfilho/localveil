import type { Range, Span } from "@repo/redact-core";
import { mergeOverlappingRanges } from "@repo/redact-core";

const BLOCK = "█";

// Graphemes, not UTF-16 units: an emoji or an accented letter is one block, so the
// mask keeps the visual width of what it hides.
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

  // Right to left, so the offsets of the ranges still ahead stay valid even when a
  // replacement changes length (an emoji is two units but one block).
  return ranges.toReversed().reduce((masked, range) => {
    const covered = [...GRAPHEMES.segment(masked.slice(range.start, range.end))];

    return masked.slice(0, range.start) + BLOCK.repeat(covered.length) + masked.slice(range.end);
  }, text);
};

export { maskSpans };
