import { describe, expect, it } from "vitest";

import { spansToRects } from "./rects";
import type { Span } from "./types";
import { buildWordIndex } from "./word-index";

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, x1, y0, y1 });

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 0.99,
  start,
});

const sameLine = buildWordIndex([
  { bbox: box(0, 0, 10, 12), text: "Ana" },
  { bbox: box(14, 0, 40, 12), text: "Silva" },
  { bbox: box(44, 0, 60, 12), text: "mora" },
]);

const twoLines = buildWordIndex([
  { bbox: box(0, 0, 10, 12), text: "Ana" },
  { bbox: box(0, 40, 30, 52), text: "Silva" },
]);

describe("spansToRects", () => {
  it("produces one rect covering a single word", () => {
    expect(spansToRects([span(0, 3)], sameLine.words)).toEqual([
      { height: 12, width: 10, x: 0, y: 0 },
    ]);
  });

  it("merges two adjacent words on the same line into one rect", () => {
    expect(spansToRects([span(0, 9)], sameLine.words)).toEqual([
      { height: 12, width: 40, x: 0, y: 0 },
    ]);
  });

  it("splits a span crossing a line break into one rect per line", () => {
    const rects = spansToRects([span(0, 9)], twoLines.words);

    expect(rects).toEqual([
      { height: 12, width: 10, x: 0, y: 0 },
      { height: 12, width: 30, x: 0, y: 40 },
    ]);
  });

  it("ignores words the span does not touch", () => {
    expect(spansToRects([span(4, 9)], sameLine.words)).toEqual([
      { height: 12, width: 26, x: 14, y: 0 },
    ]);
  });

  it("returns no rects when the span matches no word", () => {
    expect(spansToRects([span(200, 210)], sameLine.words)).toEqual([]);
  });

  it("returns no rects for no spans", () => {
    expect(spansToRects([], sameLine.words)).toEqual([]);
  });
});
