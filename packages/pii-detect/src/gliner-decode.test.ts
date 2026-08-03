import { describe, expect, it } from "vitest";

import type { SpanCandidate } from "./gliner-decode.ts";
import { decodeSpans, suppressOverlaps, toLogits } from "./gliner-decode.ts";

const logitsOf = (words: number, widths: number, entities: number, values: Array<number>) => ({
  data: values,
  dims: [1, words, widths, entities],
});

describe("decodeSpans", () => {
  it("keeps a span at or above the threshold and drops the rest", () => {
    const logits = logitsOf(2, 1, 1, [5, -5]);

    expect(decodeSpans(logits, 2, 1, 0.5)).toEqual([
      { end: 0, entity: 0, score: 1 / (1 + Math.exp(-5)), start: 0 },
    ]);
  });

  it("ignores spans that run past the last word", () => {
    const logits = logitsOf(1, 2, 1, [5, 5]);

    expect(decodeSpans(logits, 1, 1, 0.5).length).toBe(1);
  });

  it("refuses logits scored against the wrong number of entities", () => {
    expect(() => decodeSpans(logitsOf(1, 1, 2, [5, 5]), 1, 3, 0.5)).toThrow(/entity types/v);
  });

  it("refuses logits whose shape does not match their length", () => {
    expect(() => decodeSpans(logitsOf(2, 2, 1, [5]), 2, 1, 0.5)).toThrow(/shape/v);
  });
});

const candidate = (start: number, end: number, score: number): SpanCandidate => ({
  end,
  entity: 0,
  score,
  start,
});

describe("suppressOverlaps", () => {
  it("lets the strongest claim win its words", () => {
    const kept = suppressOverlaps([candidate(0, 1, 0.6), candidate(1, 2, 0.9)]);

    expect(kept).toEqual([candidate(1, 2, 0.9)]);
  });

  it("keeps spans that do not touch, ordered by position", () => {
    const kept = suppressOverlaps([candidate(3, 4, 0.9), candidate(0, 1, 0.6)]);

    expect(kept).toEqual([candidate(0, 1, 0.6), candidate(3, 4, 0.9)]);
  });
});

describe("toLogits", () => {
  it("rejects a tensor whose values are not numbers", () => {
    expect(() => toLogits({ data: BigInt64Array.from([1n]), dims: [1] })).toThrow(/not numbers/v);
  });

  it("passes numeric data through with its shape", () => {
    expect(toLogits({ data: Float32Array.from([1]), dims: [1, 1, 1, 1] })).toEqual({
      data: Float32Array.from([1]),
      dims: [1, 1, 1, 1],
    });
  });
});
