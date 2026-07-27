import { describe, expect, it } from "vitest";

import { mergeChunkSpans, mergeOverlappingRanges } from "./merge-spans.ts";
import type { Span } from "./types.ts";

const span = (start: number, end: number, score = 0.9): Span => ({
  end,
  label: "private_person",
  score,
  start,
});

describe("mergeChunkSpans", () => {
  it("shifts each chunk's spans by its offset", () => {
    const merged = mergeChunkSpans([
      { offset: 0, spans: [span(0, 4)] },
      { offset: 100, spans: [span(2, 6)] },
    ]);

    expect(merged).toEqual([span(0, 4), span(102, 106)]);
  });

  it("returns spans sorted by start", () => {
    const merged = mergeChunkSpans([
      { offset: 50, spans: [span(0, 3)] },
      { offset: 0, spans: [span(10, 12)] },
    ]);

    expect(merged.map((s) => s.start)).toEqual([10, 50]);
  });

  it("deduplicates identical spans produced by the overlap region", () => {
    const merged = mergeChunkSpans([
      { offset: 0, spans: [span(90, 95)] },
      { offset: 80, spans: [span(10, 15)] },
    ]);

    expect(merged).toEqual([span(90, 95)]);
  });

  it("returns an empty array when no chunk found anything", () => {
    expect(mergeChunkSpans([{ offset: 0, spans: [] }])).toEqual([]);
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
