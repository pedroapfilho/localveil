import type { PositionedWord, Rect, Span } from "./types.ts";

const height = (word: PositionedWord) => word.bbox.y1 - word.bbox.y0;

const midpoint = (word: PositionedWord) => (word.bbox.y0 + word.bbox.y1) / 2;

// OCR baselines wobble by a few pixels, so equal `y0` is too strict a test for
// "same line". Two words share a line when their vertical centres are closer
// together than half the shorter word's height.
const onSameLine = (a: PositionedWord, b: PositionedWord) =>
  Math.abs(midpoint(a) - midpoint(b)) < Math.min(height(a), height(b)) / 2;

const toRect = (words: Array<PositionedWord>): Rect => {
  const x0 = Math.min(...words.map((word) => word.bbox.x0));
  const x1 = Math.max(...words.map((word) => word.bbox.x1));
  const y0 = Math.min(...words.map((word) => word.bbox.y0));
  const y1 = Math.max(...words.map((word) => word.bbox.y1));

  return { height: y1 - y0, width: x1 - x0, x: x0, y: y0 };
};

const spansToRects = (spans: Array<Span>, words: Array<PositionedWord>): Array<Rect> => {
  const rects: Array<Rect> = [];

  for (const span of spans) {
    const covered = words.filter((word) => word.charStart < span.end && word.charEnd > span.start);

    let line: Array<PositionedWord> = [];

    for (const word of covered) {
      const anchor = line.at(0);

      if (anchor !== undefined && !onSameLine(anchor, word)) {
        rects.push(toRect(line));
        line = [];
      }

      line.push(word);
    }

    if (line.length > 0) {
      rects.push(toRect(line));
    }
  }

  return rects;
};

export { spansToRects };
