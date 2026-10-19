import { assert, describe, expect, it, vi } from "vitest";

import type { ModelSpec } from "./catalog";
import { modelById } from "./catalog";
import type { GlinerInput, SpanWord } from "./gliner-codec";
import { createGlinerCodec } from "./gliner-codec";

const CLS = 1;
const SEP = 2;
const ENT_ID = 8;
const SEP_ID = 9;

// Each word encodes to its code points, so a test can tell every token apart.
const tokenizer = {
  encode: vi.fn((text: string, { add_special_tokens }: { add_special_tokens: boolean }) => {
    if (add_special_tokens) {
      return [CLS, SEP];
    }

    if (text === "<<ENT>>") {
      return [ENT_ID];
    }

    if (text === "<<SEP>>") {
      return [SEP_ID];
    }

    return Array.from(text, (piece) => piece.codePointAt(0) ?? 0);
  }),
};

const PROMPTS: ModelSpec["prompts"] = [
  { label: "private_person", prompt: "p" },
  { label: "private_person", prompt: "u" },
  { label: "private_email", prompt: "e" },
];

const SPAN_SPEC: ModelSpec = { ...modelById("gliner-multi-pii"), maxWidth: 2, prompts: PROMPTS };

const TOKEN_SPEC: ModelSpec = { ...modelById("gliner-pii-edge"), maxWidth: 3, prompts: PROMPTS };

const ENTITIES = PROMPTS.length;

const words = (...texts: Array<string>): Array<SpanWord> => {
  let start = 0;

  return texts.map((text) => {
    const word = { end: start + text.length, start, text };

    start = word.end + 1;

    return word;
  });
};

const encoded = (spec: ModelSpec, ...texts: Array<string>): GlinerInput => {
  const input = createGlinerCodec(spec, tokenizer).encode(words(...texts));

  if (input === undefined) {
    throw new TypeError(`nothing in ${texts.join(" ")} was encoded`);
  }

  return input;
};

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const HIGH = 5;
const LOW = -5;

describe("encoding", () => {
  it("frames the prompts and the words between CLS and SEP", () => {
    const input = encoded(SPAN_SPEC, "ab", "c");

    expect(input.inputIds).toEqual([
      CLS,
      ENT_ID,
      112,
      ENT_ID,
      117,
      ENT_ID,
      101,
      SEP_ID,
      97,
      98,
      99,
      SEP,
    ]);
    expect(input.attentionMask).toEqual(input.inputIds.map(() => 1));
  });

  it("masks the prompts to zero and numbers only the first token of each word", () => {
    expect(encoded(SPAN_SPEC, "ab", "c").wordsMask).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0]);
  });

  it("skips a word with no tokens and keeps its neighbours where they sit", () => {
    const input = encoded(SPAN_SPEC, "ab", "", "c");

    expect(input.keptWords).toEqual([
      { end: 2, start: 0, text: "ab" },
      { end: 5, start: 4, text: "c" },
    ]);
    expect(input.wordsMask.slice(-4)).toEqual([1, 0, 2, 0]);
  });

  it("pairs every word with each width the model reads and masks the pairs past the last word", () => {
    const input = encoded(SPAN_SPEC, "a", "b");

    expect(input.spanIdx).toEqual([0, 0, 0, 1, 1, 1, 1, 1]);
    expect(input.spanMask).toEqual([1, 1, 1, 0]);
  });

  it("builds no span pairs for a token-level model", () => {
    const input = encoded(TOKEN_SPEC, "a", "b");

    expect(input.spanIdx).toEqual([]);
    expect(input.spanMask).toEqual([]);
  });

  it("has nothing to send when no word has a token", () => {
    const codec = createGlinerCodec(SPAN_SPEC, tokenizer);

    expect(codec.encode(words(""))).toBeUndefined();
    expect(codec.encode([])).toBeUndefined();
  });

  it("asks the tokenizer once for a word it has seen", () => {
    const codec = createGlinerCodec(SPAN_SPEC, tokenizer);

    tokenizer.encode.mockClear();
    codec.encode(words("ab", "ab"));
    codec.encode(words("ab"));

    expect(tokenizer.encode.mock.calls.map(([text]) => text)).toEqual(["ab"]);
  });

  it("refuses a tokenizer that does not frame text with CLS and SEP", () => {
    expect(() => createGlinerCodec(SPAN_SPEC, { encode: () => [CLS] })).toThrow(/CLS and SEP/v);
  });
});

type SpanScore = { end: number; entity: number; logit: number; start: number };

// Span-level logits are [batch, words, widths, entities]: one score per start, width and entity.
const spanLogits = (count: number, items: Array<Array<SpanScore>>) => {
  const widths = SPAN_SPEC.maxWidth;
  const data = new Float32Array(items.length * count * widths * ENTITIES).fill(LOW);

  items.forEach((scores, item) => {
    for (const { end, entity, logit, start } of scores) {
      data[((item * count + start) * widths + end - start) * ENTITIES + entity] = logit;
    }
  });

  return { data, dims: [items.length, count, widths, ENTITIES] };
};

const spanDecoded = (inputs: Array<GlinerInput>, items: Array<Array<SpanScore>>) => {
  const count = Math.max(...inputs.map((input) => input.keptWords.length));

  return createGlinerCodec(SPAN_SPEC, tokenizer).decode(inputs, spanLogits(count, items), 0.5);
};

describe("decoding a span-level model", () => {
  it("reads a span at or above the threshold as the characters of its words", () => {
    const input = encoded(SPAN_SPEC, "Ana", "Lima", "x");

    expect(spanDecoded([input], [[{ end: 1, entity: 0, logit: HIGH, start: 0 }]])).toEqual([
      { end: 8, label: "private_person", score: sigmoid(HIGH), start: 0 },
    ]);
  });

  it("drops a span below the threshold", () => {
    const input = encoded(SPAN_SPEC, "Ana");

    expect(spanDecoded([input], [[{ end: 0, entity: 0, logit: -1, start: 0 }]])).toEqual([]);
  });

  it("labels a span by the entity its prompt stands for", () => {
    const input = encoded(SPAN_SPEC, "jo", "x", "a@b.co");
    const spans = spanDecoded(
      [input],
      [
        [
          { end: 0, entity: 1, logit: HIGH, start: 0 },
          { end: 2, entity: 2, logit: HIGH, start: 2 },
        ],
      ],
    );

    expect(spans.map((span) => span.label)).toEqual(["private_person", "private_email"]);
  });

  it("lets the strongest of overlapping claims take the words", () => {
    const input = encoded(SPAN_SPEC, "a", "b", "c");
    const spans = spanDecoded(
      [input],
      [
        [
          { end: 1, entity: 0, logit: 1, start: 0 },
          { end: 2, entity: 2, logit: 3, start: 1 },
        ],
      ],
    );

    expect(spans).toEqual([{ end: 5, label: "private_email", score: sigmoid(3), start: 2 }]);
  });

  it("reads each item of a batch against its own words and ignores its padding", () => {
    const short = encoded(SPAN_SPEC, "a");
    const long = encoded(SPAN_SPEC, "bb", "cc");
    const spans = spanDecoded(
      [short, long],
      [
        [{ end: 1, entity: 0, logit: HIGH, start: 0 }],
        [{ end: 1, entity: 0, logit: HIGH, start: 1 }],
      ],
    );

    expect(spans).toEqual([{ end: 5, label: "private_person", score: sigmoid(HIGH), start: 3 }]);
  });

  it("keeps a span on the line its first word sits on", () => {
    const codec = createGlinerCodec(SPAN_SPEC, tokenizer);
    const input = codec.encode([
      { end: 3, line: 0, start: 0, text: "Rua" },
      { end: 20, line: 1, start: 15, text: "Ana" },
    ]);

    assert.isDefined(input);
    expect(
      codec.decode([input], spanLogits(2, [[{ end: 1, entity: 0, logit: HIGH, start: 0 }]]), 0.5),
    ).toEqual([{ end: 3, label: "private_person", score: sigmoid(HIGH), start: 0 }]);
  });

  it("refuses logits scored against another number of entities", () => {
    const codec = createGlinerCodec(SPAN_SPEC, tokenizer);
    const input = encoded(SPAN_SPEC, "a");

    expect(() => codec.decode([input], { data: [HIGH, HIGH], dims: [1, 1, 1, 2] }, 0.5)).toThrow(
      /entity types/v,
    );
  });

  it("refuses logits whose shape does not match their length", () => {
    const codec = createGlinerCodec(SPAN_SPEC, tokenizer);
    const input = encoded(SPAN_SPEC, "a");

    expect(() => codec.decode([input], { data: [HIGH], dims: [1, 1, 2, ENTITIES] }, 0.5)).toThrow(
      /shape/v,
    );
  });

  it("refuses logits that hold fewer items than were sent", () => {
    const codec = createGlinerCodec(SPAN_SPEC, tokenizer);
    const input = encoded(SPAN_SPEC, "a");

    expect(() => codec.decode([input, input], spanLogits(1, [[]]), 0.5)).toThrow(/asked for/v);
  });
});

type WordScores = [start: number, end: number, inside: number];

// Token-level logits are [batch, words, entities, 3]: each word scored as start, end and inside.
const tokenLogits = (items: Array<Array<WordScores>>, entity = 0) => {
  const count = Math.max(...items.map((item) => item.length));
  const data = new Float32Array(items.length * count * ENTITIES * 3).fill(LOW);

  items.forEach((scores, item) => {
    scores.forEach((roles, word) => {
      data.set(roles, ((item * count + word) * ENTITIES + entity) * 3);
    });
  });

  return { data, dims: [items.length, count, ENTITIES, 3] };
};

const tokenDecoded = (inputs: Array<GlinerInput>, items: Array<Array<WordScores>>, entity = 0) =>
  createGlinerCodec(TOKEN_SPEC, tokenizer).decode(inputs, tokenLogits(items, entity), 0.5);

const tokenInput = (count: number) =>
  encoded(TOKEN_SPEC, ...Array.from({ length: count }, (_unused, at) => String(at)));

describe("decoding a token-level model", () => {
  it("joins a start to the end that follows it across words scored inside", () => {
    const spans = tokenDecoded(
      [tokenInput(4)],
      [
        [
          [LOW, LOW, LOW],
          [HIGH, LOW, HIGH],
          [LOW, HIGH, HIGH],
          [LOW, LOW, LOW],
        ],
      ],
    );

    expect(spans).toEqual([{ end: 5, label: "private_person", score: sigmoid(HIGH), start: 2 }]);
  });

  it("takes a one-word span when the same word starts and ends it", () => {
    const spans = tokenDecoded([tokenInput(1)], [[[HIGH, HIGH, HIGH]]]);

    expect(spans).toEqual([{ end: 1, label: "private_person", score: sigmoid(HIGH), start: 0 }]);
  });

  it("labels a span by the entity its prompt stands for", () => {
    const spans = tokenDecoded([tokenInput(1)], [[[HIGH, HIGH, HIGH]]], 2);

    expect(spans.map((span) => span.label)).toEqual(["private_email"]);
  });

  it("scores a span by its weakest word", () => {
    const [span] = tokenDecoded(
      [tokenInput(3)],
      [
        [
          [HIGH, LOW, HIGH],
          [LOW, LOW, 1],
          [LOW, HIGH, HIGH],
        ],
      ],
    );

    expect(span?.score).toBeCloseTo(sigmoid(1));
  });

  it("does not bridge a word that falls below the threshold inside", () => {
    const spans = tokenDecoded(
      [tokenInput(3)],
      [
        [
          [HIGH, LOW, HIGH],
          [LOW, LOW, LOW],
          [LOW, HIGH, HIGH],
        ],
      ],
    );

    expect(spans).toEqual([]);
  });

  it("picks the stronger end when two could close the same start", () => {
    const spans = tokenDecoded(
      [tokenInput(2)],
      [
        [
          [HIGH, 1, HIGH],
          [LOW, HIGH, HIGH],
        ],
      ],
    );

    expect(spans).toEqual([{ end: 3, label: "private_person", score: sigmoid(HIGH), start: 0 }]);
  });

  it("stops a span at the widest the model was trained on", () => {
    const scores: Array<WordScores> = [
      [HIGH, LOW, HIGH],
      [LOW, LOW, HIGH],
      [LOW, LOW, HIGH],
      [LOW, HIGH, HIGH],
    ];

    expect(tokenDecoded([tokenInput(4)], [scores])).toEqual([]);
    expect(tokenDecoded([tokenInput(3)], [scores.toSpliced(1, 1)])).toHaveLength(1);
  });

  it("reads each item of a batch against its own words and ignores its padding", () => {
    const spans = tokenDecoded(
      [tokenInput(1), tokenInput(2)],
      [
        [
          [HIGH, LOW, HIGH],
          [LOW, HIGH, HIGH],
        ],
        [
          [LOW, LOW, LOW],
          [HIGH, HIGH, HIGH],
        ],
      ],
    );

    expect(spans).toEqual([{ end: 3, label: "private_person", score: sigmoid(HIGH), start: 2 }]);
  });

  it("refuses logits that are not start, end and inside per word", () => {
    const codec = createGlinerCodec(TOKEN_SPEC, tokenizer);

    expect(() => codec.decode([tokenInput(1)], { data: [1, 2], dims: [1, 1, 1, 2] }, 0.5)).toThrow(
      /start, end/v,
    );
  });

  it("refuses logits scored against another number of entities", () => {
    const codec = createGlinerCodec(TOKEN_SPEC, tokenizer);

    expect(() =>
      codec.decode([tokenInput(1)], { data: [HIGH, HIGH, HIGH], dims: [1, 1, 1, 3] }, 0.5),
    ).toThrow(/entity types/v);
  });

  it("refuses logits that hold fewer items than were sent", () => {
    const codec = createGlinerCodec(TOKEN_SPEC, tokenizer);

    expect(() =>
      codec.decode([tokenInput(1), tokenInput(1)], tokenLogits([[[HIGH, HIGH, HIGH]]]), 0.5),
    ).toThrow(/asked for/v);
  });
});
