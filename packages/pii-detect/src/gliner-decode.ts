type Logits = { data: ArrayLike<number>; dims: ReadonlyArray<number> };

type SpanCandidate = { end: number; entity: number; score: number; start: number };

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const isNumberArray = (value: unknown): value is ArrayLike<number> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const length: unknown = Reflect.get(value, "length");

  if (typeof length !== "number") {
    return false;
  }

  return length === 0 || typeof Reflect.get(value, 0) === "number";
};

const toLogits = (tensor: { data: unknown; dims: ReadonlyArray<number> }): Logits => {
  if (!isNumberArray(tensor.data)) {
    throw new TypeError("The model returned logits that are not numbers");
  }

  return { data: tensor.data, dims: [...tensor.dims] };
};

const decodeSpans = (
  logits: Logits,
  wordCount: number,
  entityCount: number,
  threshold: number,
): Array<SpanCandidate> => {
  const entities = logits.dims.at(-1) ?? 0;
  const widths = logits.dims.at(-2) ?? 0;
  const positions = logits.dims.at(-3) ?? 0;

  if (entities !== entityCount) {
    throw new TypeError(
      `The model scored ${String(entities)} entity types where ${String(entityCount)} were asked for`,
    );
  }

  if (positions * widths * entities !== logits.data.length) {
    throw new TypeError("The model returned logits whose shape does not match their length");
  }

  const candidates: Array<SpanCandidate> = [];

  for (let start = 0; start < positions; start += 1) {
    for (let width = 0; width < widths; width += 1) {
      const end = start + width;

      if (end >= wordCount) {
        continue;
      }

      const base = (start * widths + width) * entities;

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

export { decodeSpans, suppressOverlaps, toLogits };
export type { Logits, SpanCandidate };
