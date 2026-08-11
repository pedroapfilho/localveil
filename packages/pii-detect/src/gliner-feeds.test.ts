import { describe, expect, it } from "vitest";

import type { GlinerInput } from "./gliner-encode.ts";
import { toFeeds } from "./gliner-feeds.ts";

type Tensor = { data: Array<number>; dims: Array<number>; type: string };

const tensor = (
  type: "bool" | "int64",
  data: BigInt64Array | Uint8Array,
  dims: Array<number>,
): Tensor => ({ data: [...data].map(Number), dims, type });

const input = (tokens: number, spans: number, kept = tokens): GlinerInput => ({
  attentionMask: Array.from<number>({ length: tokens }).fill(1),
  inputIds: Array.from<number>({ length: tokens }).fill(7),
  keptWords: Array.from({ length: kept }, (_unused, at) => at),
  spanIdx: Array.from({ length: spans * 2 }, () => 3),
  spanMask: Array.from<number>({ length: spans }).fill(1),
  wordsMask: Array.from<number>({ length: tokens }).fill(2),
});

const feed = (inputs: Array<GlinerInput>) => toFeeds(inputs, tensor);

describe("toFeeds", () => {
  it("shapes a single input with a leading batch of one", () => {
    const feeds = feed([input(3, 2)]);

    expect(feeds.input_ids.dims).toEqual([1, 3]);
    expect(feeds.span_idx.dims).toEqual([1, 2, 2]);
    expect(feeds.text_lengths.dims).toEqual([1, 1]);
  });

  it("pads every token tensor to the longest input", () => {
    const feeds = feed([input(2, 1), input(5, 1)]);

    expect(feeds.input_ids.dims).toEqual([2, 5]);
    expect(feeds.input_ids.data).toEqual([7, 7, 0, 0, 0, 7, 7, 7, 7, 7]);
  });

  it("pads the attention mask with zeroes so padding is ignored", () => {
    const feeds = feed([input(2, 1), input(4, 1)]);

    expect(feeds.attention_mask.data).toEqual([1, 1, 0, 0, 1, 1, 1, 1]);
  });

  it("pads the words mask with zeroes so padding names no word", () => {
    const feeds = feed([input(2, 1), input(4, 1)]);

    expect(feeds.words_mask.data).toEqual([2, 2, 0, 0, 2, 2, 2, 2]);
  });

  it("pads the span mask with zeroes so padding scores no span", () => {
    const feeds = feed([input(2, 1), input(2, 3)]);

    expect(feeds.span_mask.dims).toEqual([2, 3]);
    expect(feeds.span_mask.data).toEqual([1, 0, 0, 1, 1, 1]);
  });

  it("pads span indices in pairs", () => {
    const feeds = feed([input(2, 1), input(2, 2)]);

    expect(feeds.span_idx.dims).toEqual([2, 2, 2]);
    expect(feeds.span_idx.data).toEqual([3, 3, 0, 0, 3, 3, 3, 3]);
  });

  it("gives each item its own word count rather than the padded one", () => {
    const feeds = feed([input(2, 1, 2), input(6, 1, 6)]);

    expect(feeds.text_lengths.data).toEqual([2, 6]);
    expect(feeds.text_lengths.dims).toEqual([2, 1]);
  });

  it("sends the span mask as booleans and the rest as integers", () => {
    const feeds = feed([input(2, 1)]);

    expect(feeds.span_mask.type).toBe("bool");
    expect(feeds.input_ids.type).toBe("int64");
  });
});
