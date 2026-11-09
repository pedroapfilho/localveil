import type { PiiLabel } from "./labels";
import type { Span } from "./types";

type Range = { end: number; start: number };

const widestFirst = (left: Range, right: Range) => left.start - right.start || right.end - left.end;

const encloses = (outer: Range, inner: Range) =>
  outer.start <= inner.start && outer.end >= inner.end;

// A span nested in another of its label folds into it, and the container keeps the stronger score.
const absorbNested = (spans: ReadonlyArray<Span>): Array<Span> => {
  const kept: Array<Span> = [];
  const containers = new Map<PiiLabel, number>();

  for (const span of spans.toSorted(widestFirst)) {
    const at = containers.get(span.label);
    const container = at === undefined ? undefined : kept[at];

    if (at !== undefined && container !== undefined && encloses(container, span)) {
      kept[at] = { ...container, score: Math.max(container.score, span.score) };
      continue;
    }

    containers.set(span.label, kept.length);
    kept.push(span);
  }

  return kept;
};

const mergeOverlappingRanges = (spans: Array<Span>): Array<Range> => {
  const sorted = spans.toSorted((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<Range> = [];

  for (const span of sorted) {
    const last = merged.at(-1);

    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }

    merged.push({ end: span.end, start: span.start });
  }

  return merged;
};

export { absorbNested, mergeOverlappingRanges };

export type { Range };
