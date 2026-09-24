import { describe, expect, it } from "vitest";

import type { SpanCandidate } from "./gliner-decode";
import { decodeSpans, decodeTokenSpans, suppressOverlaps, toLogits } from "./gliner-decode";

type LogitsDims = { batch?: number; entities: number; widths: number; words: number };

const logitsOf = ({ batch = 1, entities, widths, words }: LogitsDims, values: Array<number>) => ({
  data: values,
  dims: [batch, words, widths, entities],
});

const decoding = (
  logits: { data: Array<number>; dims: Array<number> },
  wordCount: number,
  entityCount: number,
  { item = 0, threshold = 0.5 }: { item?: number; threshold?: number } = {},
) => decodeSpans({ entityCount, item, logits, threshold, wordCount });

describe("decodeSpans", () => {
  it("keeps a span at or above the threshold and drops the rest", () => {
    const logits = logitsOf({ entities: 1, widths: 1, words: 2 }, [5, -5]);

    expect(decoding(logits, 2, 1)).toEqual([
      { end: 0, entity: 0, score: 1 / (1 + Math.exp(-5)), start: 0 },
    ]);
  });

  it("ignores spans that run past the last word", () => {
    const logits = logitsOf({ entities: 1, widths: 2, words: 1 }, [5, 5]);

    expect(decoding(logits, 1, 1).length).toBe(1);
  });

  it("refuses logits scored against the wrong number of entities", () => {
    expect(() => decoding(logitsOf({ entities: 2, widths: 1, words: 1 }, [5, 5]), 1, 3)).toThrow(
      /entity types/v,
    );
  });

  it("refuses logits whose shape does not match their length", () => {
    expect(() => decoding(logitsOf({ entities: 1, widths: 2, words: 2 }, [5]), 2, 1)).toThrow(
      /shape/v,
    );
  });

  it("reads one item out of a batch", () => {
    const logits = logitsOf({ batch: 3, entities: 1, widths: 1, words: 1 }, [-5, 5, -5]);

    expect(decoding(logits, 1, 1, { item: 0 })).toEqual([]);
    expect(decoding(logits, 1, 1, { item: 1 })).toHaveLength(1);
    expect(decoding(logits, 1, 1, { item: 2 })).toEqual([]);
  });

  it("counts the whole batch when it checks the shape", () => {
    expect(() =>
      decoding(logitsOf({ batch: 3, entities: 1, widths: 1, words: 1 }, [5, 5]), 1, 1),
    ).toThrow(/shape/v);
  });

  it("refuses an item the batch does not hold", () => {
    expect(() =>
      decoding(logitsOf({ batch: 2, entities: 1, widths: 1, words: 1 }, [5, 5]), 1, 1, { item: 2 }),
    ).toThrow(/asked for/v);
  });
});

const HIGH = 5;
const LOW = -5;
const sure = 1 / (1 + Math.exp(-HIGH));

type WordScores = [start: number, end: number, inside: number];

// One entity, one item: each word's start, end and inside logits in the order the graph emits them.
const tokenLogits = (words: Array<WordScores>, { batch = 1, entities = 1 } = {}) => ({
  data: Array.from({ length: batch * entities }, () => words.flat()).flat(),
  dims: [batch, words.length, entities, 3],
});

const tokenDecoding = (
  logits: { data: Array<number>; dims: Array<number> },
  { entityCount = 1, item = 0, maxWidth = 12, threshold = 0.5, wordCount = 99 } = {},
) => decodeTokenSpans({ entityCount, item, logits, maxWidth, threshold, wordCount });

describe("decodeTokenSpans", () => {
  it("joins a start to the end that follows it across words scored inside", () => {
    const logits = tokenLogits([
      [LOW, LOW, LOW],
      [HIGH, LOW, HIGH],
      [LOW, HIGH, HIGH],
      [LOW, LOW, LOW],
    ]);

    expect(tokenDecoding(logits)).toEqual([{ end: 2, entity: 0, score: sure, start: 1 }]);
  });

  it("takes a one-word span when the same word starts and ends it", () => {
    const logits = tokenLogits([[HIGH, HIGH, HIGH]]);

    expect(tokenDecoding(logits)).toEqual([{ end: 0, entity: 0, score: sure, start: 0 }]);
  });

  it("scores a span by its weakest word", () => {
    const logits = tokenLogits([
      [HIGH, LOW, HIGH],
      [LOW, LOW, 1],
      [LOW, HIGH, HIGH],
    ]);
    const [span] = tokenDecoding(logits);

    expect(span?.score).toBeCloseTo(1 / (1 + Math.exp(-1)));
  });

  it("does not bridge a word that falls below the threshold inside", () => {
    const logits = tokenLogits([
      [HIGH, LOW, HIGH],
      [LOW, LOW, LOW],
      [LOW, HIGH, HIGH],
    ]);

    expect(tokenDecoding(logits)).toEqual([]);
  });

  it("offers every start and end pairing and leaves the choice to overlap suppression", () => {
    const logits = tokenLogits([
      [HIGH, HIGH, HIGH],
      [LOW, HIGH, HIGH],
    ]);

    expect(tokenDecoding(logits).map(({ end, start }) => [start, end])).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("stops a span at the widest the model was trained on", () => {
    const logits = tokenLogits([
      [HIGH, LOW, HIGH],
      [LOW, LOW, HIGH],
      [LOW, HIGH, HIGH],
    ]);

    expect(tokenDecoding(logits, { maxWidth: 2 })).toEqual([]);
    expect(tokenDecoding(logits, { maxWidth: 3 })).toHaveLength(1);
  });

  it("ignores the padding past an item's own words", () => {
    const logits = tokenLogits([
      [HIGH, LOW, HIGH],
      [LOW, HIGH, HIGH],
    ]);

    expect(tokenDecoding(logits, { wordCount: 1 })).toEqual([]);
  });

  it("reads one item out of a batch", () => {
    const logits = {
      data: [LOW, LOW, LOW, HIGH, HIGH, HIGH],
      dims: [2, 1, 1, 3],
    };

    expect(tokenDecoding(logits, { item: 0 })).toEqual([]);
    expect(tokenDecoding(logits, { item: 1 })).toHaveLength(1);
  });

  it("refuses logits that are not start, end and inside per word", () => {
    expect(() => tokenDecoding({ data: [1, 2], dims: [1, 1, 1, 2] })).toThrow(/start, end/v);
  });

  it("refuses logits scored against the wrong number of entities", () => {
    expect(() =>
      tokenDecoding(tokenLogits([[HIGH, HIGH, HIGH]], { entities: 2 }), { entityCount: 3 }),
    ).toThrow(/entity types/v);
  });

  it("refuses an item the batch does not hold", () => {
    expect(() => tokenDecoding(tokenLogits([[HIGH, HIGH, HIGH]]), { item: 1 })).toThrow(
      /asked for/v,
    );
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
