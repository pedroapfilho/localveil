import type { Span } from "./types.ts";

type ChunkSpans = { offset: number; spans: Array<Span> };

type Range = { end: number; start: number };

const widestFirst = (left: Range, right: Range) => left.start - right.start || right.end - left.end;

const encloses = (outer: Range, inner: Range) =>
  outer.start <= inner.start && outer.end >= inner.end;

/**
 * Keeps the widest item of each group and folds anything nested inside it away, carrying the
 * best score of the pair forward. Exact duplicates are the degenerate case of nesting, so this
 * subsumes keying on the range. Partial overlaps are left alone: two account numbers under one
 * loose span are two findings, and only the apply step unions them into one painted range.
 *
 * Sorting widest first means the running container of a group is always the last one kept, so a
 * single pass suffices.
 */
const absorbNested = <T extends Range>(
  items: ReadonlyArray<T>,
  groupOf: (item: T) => string,
  scoreOf: (item: T) => number,
  rescore: (item: T, score: number) => T,
): Array<T> => {
  const kept: Array<T> = [];
  const containers = new Map<string, number>();

  for (const item of items.toSorted(widestFirst)) {
    const group = groupOf(item);
    const at = containers.get(group);

    if (at !== undefined && encloses(kept[at], item)) {
      kept[at] = rescore(kept[at], Math.max(scoreOf(kept[at]), scoreOf(item)));
      continue;
    }

    containers.set(group, kept.length);
    kept.push(item);
  }

  return kept;
};

const mergeChunkSpans = (parts: Array<ChunkSpans>): Array<Span> => {
  const shifted = parts.flatMap((part) =>
    part.spans.map((span) => ({
      ...span,
      end: span.end + part.offset,
      start: span.start + part.offset,
    })),
  );

  return absorbNested(
    shifted,
    (span) => span.label,
    (span) => span.score,
    (span, score) => ({ ...span, score }),
  ).toSorted((a, b) => a.start - b.start || a.end - b.end);
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

export { absorbNested, mergeChunkSpans, mergeOverlappingRanges };
export type { ChunkSpans, Range };
