type Logits = { data: ArrayLike<number>; dims: ReadonlyArray<number> };

type SpanCandidate = { end: number; entity: number; score: number; start: number };

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the model runtime returns untyped tensor data; this guard is its parser
const isNumberArray = (value: unknown): value is ArrayLike<number> => {
  if (typeof value !== "object" || value === null || !("length" in value)) {
    return false;
  }

  const { length } = value;

  if (typeof length !== "number") {
    return false;
  }

  return length === 0 || ("0" in value && typeof value[0] === "number");
};

const toLogits = (tensor: { data: unknown; dims: ReadonlyArray<number> }): Logits => {
  if (!isNumberArray(tensor.data)) {
    throw new TypeError("The model returned logits that are not numbers");
  }

  return { data: tensor.data, dims: [...tensor.dims] };
};

type DecodeOptions = {
  entityCount: number;
  item: number;
  logits: Logits;
  threshold: number;
  wordCount: number;
};

const decodeSpans = ({
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

  if (entities !== entityCount) {
    throw new TypeError(
      `The model scored ${String(entities)} entity types where ${String(entityCount)} were asked for`,
    );
  }

  if (batch * positions * widths * entities !== logits.data.length) {
    throw new TypeError("The model returned logits whose shape does not match their length");
  }

  if (item >= batch) {
    throw new RangeError(
      `The model returned ${String(batch)} results where item ${String(item)} was asked for`,
    );
  }

  const candidates: Array<SpanCandidate> = [];
  const offset = item * positions * widths * entities;

  for (let start = 0; start < positions; start += 1) {
    for (let width = 0; width < widths; width += 1) {
      const end = start + width;

      if (end >= wordCount) {
        continue;
      }

      const base = offset + (start * widths + width) * entities;

      for (let entity = 0; entity < entities; entity += 1) {
        const score = sigmoid(logits.data[base + entity]);

        if (score >= threshold) {
          candidates.push({ end, entity, score, start });
        }
      }
    }
  }

  return candidates;
};

type TokenDecodeOptions = DecodeOptions & { maxWidth: number };

const START = 0;
const END = 1;
const INSIDE = 2;
const ROLES = 3;

/* Token-level GLiNER scores each word three ways per entity, as a span's start, its end, and inside
   it, and leaves the spans to the caller. This follows GLiNER's own TokenDecoder: a span runs from
   a start to an end with every word between them scoring inside, and it is only as confident as
   its weakest word. Once one word falls below the threshold inside, no longer span from the same
   start can qualify, so the scan stops there. */
const decodeTokenSpans = ({
  entityCount,
  item,
  logits,
  maxWidth,
  threshold,
  wordCount,
}: TokenDecodeOptions): Array<SpanCandidate> => {
  const [batch = 1, positions = 0, entities = 0, roles = 0] =
    logits.dims.length === 4 ? logits.dims : [];

  if (roles !== ROLES) {
    throw new TypeError(
      `The model returned ${String(roles)} scores per word where start, end and inside were expected`,
    );
  }

  if (entities !== entityCount) {
    throw new TypeError(
      `The model scored ${String(entities)} entity types where ${String(entityCount)} were asked for`,
    );
  }

  if (batch * positions * entities * roles !== logits.data.length) {
    throw new TypeError("The model returned logits whose shape does not match their length");
  }

  if (item >= batch) {
    throw new RangeError(
      `The model returned ${String(batch)} results where item ${String(item)} was asked for`,
    );
  }

  const words = Math.min(positions, wordCount);
  const scoreOf = (word: number, entity: number, role: number) =>
    sigmoid(logits.data[((item * positions + word) * entities + entity) * ROLES + role]);

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

export { decodeSpans, decodeTokenSpans, suppressOverlaps, toLogits };
export type { DecodeOptions, Logits, SpanCandidate, TokenDecodeOptions };
