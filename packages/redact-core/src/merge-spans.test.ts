import { describe, expect, it } from "vitest";

import { mergeOverlappingRanges } from "./merge-spans";
import type { Span } from "./types";

const span = (start: number, end: number, score = 0.9): Span => ({
  end,
  label: "private_person",
  score,
  start,
});

describe("mergeOverlappingRanges", () => {
  it("merges two overlapping spans into one covering both", () => {
    const merged = mergeOverlappingRanges([span(0, 10), span(5, 15)]);

    expect(merged).toEqual([{ end: 15, start: 0 }]);
  });

  it("keeps disjoint spans separate", () => {
    const merged = mergeOverlappingRanges([span(0, 5), span(10, 15)]);

    expect(merged).toEqual([
      { end: 5, start: 0 },
      { end: 15, start: 10 },
    ]);
  });

  it("merges spans that touch at a boundary", () => {
    expect(mergeOverlappingRanges([span(0, 5), span(5, 9)])).toEqual([{ end: 9, start: 0 }]);
  });

  it("returns an empty array for no input", () => {
    expect(mergeOverlappingRanges([])).toEqual([]);
  });
});
