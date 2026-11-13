import { describe, expect, it } from "vitest";

import { absorbNested, mergeOverlappingRanges } from "./merge-spans";
import type { Span } from "./types";

const span = (start: number, end: number, score = 0.9): Span => ({
  end,
  label: "private_person",
  score,
  start,
});

describe("absorbNested", () => {
  it("folds a span into the one of its label that encloses it, keeping the stronger score", () => {
    expect(absorbNested([span(4, 9, 0.9), span(0, 12, 0.7)])).toEqual([span(0, 12, 0.9)]);
  });

  it("keeps a nested span that carries another label", () => {
    const email: Span = { end: 9, label: "private_email", score: 0.8, start: 4 };

    expect(absorbNested([span(0, 12), email])).toEqual([span(0, 12), email]);
  });

  it("keeps two spans of one label that only overlap", () => {
    expect(absorbNested([span(0, 8), span(5, 12)])).toEqual([span(0, 8), span(5, 12)]);
  });
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
