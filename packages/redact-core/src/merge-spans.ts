import type { Span } from "./types.ts";

type ChunkSpans = { offset: number; spans: Array<Span> };

type Range = { end: number; start: number };

const spanKey = (span: Span) => `${span.start}:${span.end}:${span.label}`;

const mergeChunkSpans = (parts: Array<ChunkSpans>): Array<Span> => {
  const byKey = new Map<string, Span>();

  for (const part of parts) {
    for (const span of part.spans) {
      const shifted: Span = {
        ...span,
        end: span.end + part.offset,
        start: span.start + part.offset,
      };
      const key = spanKey(shifted);
      const existing = byKey.get(key);

      // The overlap region is scanned twice; keep the more confident verdict.
      if (!existing || existing.score < shifted.score) {
        byKey.set(key, shifted);
      }
    }
  }

  return [...byKey.values()].toSorted((a, b) => a.start - b.start || a.end - b.end);
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

export { mergeChunkSpans, mergeOverlappingRanges };
export type { ChunkSpans, Range };
