import { describe, expect, it } from "vitest";

import { batchInputs } from "./batch-inputs";
import type { GlinerInput } from "./gliner-codec";

const input = (tokens: number): GlinerInput => ({
  attentionMask: Array.from<number>({ length: tokens }).fill(1),
  inputIds: Array.from<number>({ length: tokens }).fill(1),
  keptWords: [{ end: 1, start: 0, text: "a" }],
  spanIdx: [0, 0],
  spanMask: [1],
  wordsMask: Array.from<number>({ length: tokens }).fill(0),
});

const batched = (tokens: Array<number>, size: number, budget: number) => {
  const inputs = tokens.map(input);

  return batchInputs(inputs, size, budget).map((batch) =>
    batch.map((entry) => inputs.indexOf(entry)),
  );
};

describe("batchInputs", () => {
  it("fills a batch up to the size cap", () => {
    expect(batched([1, 1, 1, 1, 1], 4, 10_000)).toEqual([[0, 1, 2, 3], [4]]);
  });

  it("puts everything in one batch when it fits", () => {
    expect(batched([1, 1], 4, 10_000)).toEqual([[0, 1]]);
  });

  it("returns nothing for nothing", () => {
    expect(batchInputs([], 4, 10_000)).toEqual([]);
  });

  it("closes a batch early when padding would cost too much", () => {
    expect(batched([100, 100, 100], 4, 250)).toEqual([[0, 1], [2]]);
  });

  it("charges padding at the widest input in the batch", () => {
    expect(batched([10, 300], 4, 400)).toEqual([[0], [1]]);
  });

  it("never drops an input that cannot fit the budget on its own", () => {
    expect(batched([5000, 5000], 4, 100)).toEqual([[0], [1]]);
  });

  it("hands back the inputs themselves, in the order they arrived", () => {
    expect(batched([1, 1, 1, 1, 1, 1], 2, 10_000).flat()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
