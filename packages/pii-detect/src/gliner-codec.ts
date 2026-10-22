import type { Span } from "@repo/redact-core";

import type { ModelDecoding, ModelSpec } from "./catalog";

type Tokenizer = {
  encode: (text: string, options: { add_special_tokens: boolean }) => Array<number>;
};

type SpanWord = { end: number; line?: number; start: number; text: string };

type GlinerInput = {
  attentionMask: Array<number>;
  inputIds: Array<number>;
  keptWords: Array<SpanWord>;
  spanIdx: Array<number>;
  spanMask: Array<number>;
  wordsMask: Array<number>;
};

type Logits = { data: ArrayLike<number>; dims: ReadonlyArray<number> };

type GlinerCodec = {
  decode: (inputs: ReadonlyArray<GlinerInput>, logits: Logits, threshold: number) => Array<Span>;
  encode: (words: ReadonlyArray<SpanWord>) => GlinerInput | undefined;
};

type SpanCandidate = { end: number; entity: number; score: number; start: number };

type DecodeOptions = {
  entityCount: number;
  item: number;
  logits: Logits;
  maxWidth: number;
  threshold: number;
  wordCount: number;
};

type SpanPairs = Pick<GlinerInput, "spanIdx" | "spanMask">;

type Decoding = {
  candidates: (options: DecodeOptions) => Array<SpanCandidate>;
  pairs: (count: number, maxWidth: number) => SpanPairs;
};

const ENT_TOKEN = "<<ENT>>";
const SEP_TOKEN = "<<SEP>>";

const CACHED_WORDS = 50_000;

const START = 0;
const END = 1;
const INSIDE = 2;
const ROLES = 3;

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const scoreAt = (data: ArrayLike<number>, at: number) => {
  const value = data[at];

  if (value === undefined) {
    throw new RangeError(`The model returned no logit at ${String(at)} of ${String(data.length)}`);
  }

  return sigmoid(value);
};

const checkEntities = (entities: number, entityCount: number) => {
  if (entities !== entityCount) {
    throw new TypeError(
      `The model scored ${String(entities)} entity types where ${String(entityCount)} were asked for`,
    );
  }
};

const checkBatch = (logits: Logits, batch: number, perItem: number, item: number) => {
  if (batch * perItem !== logits.data.length) {
    throw new TypeError("The model returned logits whose shape does not match their length");
  }

  if (item >= batch) {
    throw new RangeError(
      `The model returned ${String(batch)} results where item ${String(item)} was asked for`,
    );
  }
};

const spanPairs = (count: number, maxWidth: number): SpanPairs => {
  const spanIdx: Array<number> = [];
  const spanMask: Array<number> = [];

  for (let start = 0; start < count; start += 1) {
    for (let width = 0; width < maxWidth; width += 1) {
      spanIdx.push(start, Math.min(start + width, count - 1));
      spanMask.push(start + width < count ? 1 : 0);
    }
  }

  return { spanIdx, spanMask };
};

const spanCandidates = ({
  entityCount,
  item,
  logits,
  threshold,
  wordCount,
}: DecodeOptions): Array<SpanCandidate> => {
  const entities = logits.dims.at(-1) ?? 0;
  const widths = logits.dims.at(-2) ?? 0;
  const positions = logits.dims.at(-3) ?? 0;
  const batch = logits.dims.length > 3 ? (logits.dims.at(-4) ?? 1) : 1;

  const perItem = positions * widths * entities;

  checkEntities(entities, entityCount);
  checkBatch(logits, batch, perItem, item);

  const candidates: Array<SpanCandidate> = [];
  const offset = item * perItem;

  for (let start = 0; start < positions; start += 1) {
    for (let width = 0; width < widths; width += 1) {
      const end = start + width;

      if (end >= wordCount) {
        continue;
      }

      const base = offset + (start * widths + width) * entities;

      for (let entity = 0; entity < entities; entity += 1) {
        const score = scoreAt(logits.data, base + entity);

        if (score >= threshold) {
          candidates.push({ end, entity, score, start });
        }
      }
    }
  }

  return candidates;
};

/* Token-level GLiNER scores each word three ways per entity, as a span's start, its end, and inside
   it, and leaves the spans to the caller. This follows GLiNER's own TokenDecoder: a span runs from
   a start to an end with every word between them scoring inside, and it is only as confident as
   its weakest word. Once one word falls below the threshold inside, no longer span from the same
   start can qualify, so the scan stops there. */
const tokenCandidates = ({
  entityCount,
  item,
  logits,
  maxWidth,
  threshold,
  wordCount,
}: DecodeOptions): Array<SpanCandidate> => {
  const [batch = 1, positions = 0, entities = 0, roles = 0] =
    logits.dims.length === 4 ? logits.dims : [];

  if (roles !== ROLES) {
    throw new TypeError(
      `The model returned ${String(roles)} scores per word where start, end and inside were expected`,
    );
  }

  checkEntities(entities, entityCount);
  checkBatch(logits, batch, positions * entities * ROLES, item);

  const words = Math.min(positions, wordCount);

  const scoreOf = (word: number, entity: number, role: number) =>
    scoreAt(logits.data, ((item * positions + word) * entities + entity) * ROLES + role);

  const candidates: Array<SpanCandidate> = [];

  for (let entity = 0; entity < entities; entity += 1) {
    for (let start = 0; start < words; start += 1) {
      let weakest = scoreOf(start, entity, START);

      if (weakest < threshold) {
        continue;
      }

      for (let end = start; end < Math.min(words, start + maxWidth); end += 1) {
        const inside = scoreOf(end, entity, INSIDE);

        if (inside < threshold) {
          break;
        }

        weakest = Math.min(weakest, inside);

        const closing = scoreOf(end, entity, END);

        if (closing >= threshold) {
          candidates.push({ end, entity, score: Math.min(weakest, closing), start });
        }
      }
    }
  }

  return candidates;
};

/* Span-level graphs score every span up to maxWidth words, so they take a start and end for each.
   Token-level graphs score words and take no span inputs at all. */
const DECODINGS = {
  span: { candidates: spanCandidates, pairs: spanPairs },
  token: { candidates: tokenCandidates, pairs: () => ({ spanIdx: [], spanMask: [] }) },
} satisfies Record<ModelDecoding, Decoding>;

const suppressOverlaps = (candidates: Array<SpanCandidate>): Array<SpanCandidate> => {
  const byScore = candidates.toSorted((a, b) => b.score - a.score);
  const kept: Array<SpanCandidate> = [];

  for (const candidate of byScore) {
    const overlaps = kept.some(
      (other) => candidate.start <= other.end && other.start <= candidate.end,
    );

    if (!overlaps) {
      kept.push(candidate);
    }
  }

  return kept.toSorted((a, b) => a.start - b.start);
};

const frameOf = (tokenizer: Tokenizer) => {
  const frame = tokenizer.encode("", { add_special_tokens: true });

  const [cls, sep] = frame;

  if (frame.length !== 2 || cls === undefined || sep === undefined) {
    throw new TypeError("The tokenizer did not frame an empty text with CLS and SEP");
  }

  return { cls, sep };
};

const createGlinerCodec = (spec: ModelSpec, tokenizer: Tokenizer): GlinerCodec => {
  const decoding: Decoding = DECODINGS[spec.decoding];
  const frame = frameOf(tokenizer);
  const cache = new Map<string, Array<number>>();

  const idsOf = (word: string) => {
    const cached = cache.get(word);

    if (cached !== undefined) {
      return cached;
    }

    if (cache.size > CACHED_WORDS) {
      cache.clear();
    }

    const ids = tokenizer.encode(word, { add_special_tokens: false });

    cache.set(word, ids);

    return ids;
  };

  const prompt = [
    ...spec.prompts.flatMap((entity) => [...idsOf(ENT_TOKEN), ...idsOf(entity.prompt)]),
    ...idsOf(SEP_TOKEN),
  ];

  const encode = (words: ReadonlyArray<SpanWord>): GlinerInput | undefined => {
    const inputIds = [frame.cls, ...prompt];
    const wordsMask = inputIds.map(() => 0);
    const keptWords: Array<SpanWord> = [];

    for (const word of words) {
      const ids = idsOf(word.text);

      if (ids.length === 0) {
        continue;
      }

      keptWords.push(word);

      ids.forEach((id, at) => {
        inputIds.push(id);
        wordsMask.push(at === 0 ? keptWords.length : 0);
      });
    }

    if (keptWords.length === 0) {
      return undefined;
    }

    inputIds.push(frame.sep);
    wordsMask.push(0);

    return {
      attentionMask: inputIds.map(() => 1),
      inputIds,
      keptWords,
      ...decoding.pairs(keptWords.length, spec.maxWidth),
      wordsMask,
    };
  };

  // The shouted pass joins lines that sit apart in the source, so a span keeps to its first word's line.
  const spanOf = (words: ReadonlyArray<SpanWord>, candidate: SpanCandidate): Span => {
    const covered = words.slice(candidate.start, candidate.end + 1);
    const [first] = covered;
    const entity = spec.prompts[candidate.entity];

    if (first === undefined || entity === undefined) {
      throw new RangeError(
        `decoded entity ${String(candidate.entity)} over words ${String(candidate.start)}-${String(candidate.end)} is outside the input`,
      );
    }

    const last = covered.findLast((word) => word.line === first.line) ?? first;

    return { end: last.end, label: entity.label, score: candidate.score, start: first.start };
  };

  const decode = (inputs: ReadonlyArray<GlinerInput>, logits: Logits, threshold: number) =>
    inputs.flatMap(({ keptWords }, item) =>
      suppressOverlaps(
        decoding.candidates({
          entityCount: spec.prompts.length,
          item,
          logits,
          maxWidth: spec.maxWidth,
          threshold,
          wordCount: keptWords.length,
        }),
      ).map((candidate) => spanOf(keptWords, candidate)),
    );

  return { decode, encode };
};

export { createGlinerCodec };

export type { GlinerInput, Logits, SpanWord };
