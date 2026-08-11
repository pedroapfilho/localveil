import { describe, expect, it } from "vitest";

import { batchInputs } from "./batch-inputs.ts";
import type { GlinerInput } from "./gliner-encode.ts";

const input = (tokens: number): GlinerInput => ({
  attentionMask: Array.from<number>({ length: tokens }).fill(1),
  inputIds: Array.from<number>({ length: tokens }).fill(1),
  keptWords: [0],
  spanIdx: [0, 0],
  spanMask: [1],
  wordsMask: Array.from<number>({ length: tokens }).fill(0),
});

describe("batchInputs", () => {
  it("fills a batch up to the size cap", () => {
    expect(batchInputs([1, 1, 1, 1, 1].map(input), 4, 10_000)).toEqual([[0, 1, 2, 3], [4]]);
  });

  it("puts everything in one batch when it fits", () => {
    expect(batchInputs([1, 1].map(input), 4, 10_000)).toEqual([[0, 1]]);
  });

  it("returns nothing for nothing", () => {
    expect(batchInputs([], 4, 10_000)).toEqual([]);
  });

  it("closes a batch early when padding would cost too much", () => {
    expect(batchInputs([100, 100, 100].map(input), 4, 250)).toEqual([[0, 1], [2]]);
  });

  it("charges padding at the widest input in the batch", () => {
    expect(batchInputs([10, 300].map(input), 4, 400)).toEqual([[0], [1]]);
  });

  it("never drops an input that cannot fit the budget on its own", () => {
    expect(batchInputs([5000, 5000].map(input), 4, 100)).toEqual([[0], [1]]);
  });

  it("keeps the inputs in the order they arrived", () => {
    expect(batchInputs([1, 1, 1, 1, 1, 1].map(input), 2, 10_000).flat()).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
});
