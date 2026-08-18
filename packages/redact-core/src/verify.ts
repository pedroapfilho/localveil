import { APPLY_SCORE } from "./detections.ts";
import type { Detect, PiiLabel } from "./types.ts";

const BLOCK = "█";

const PREVIEW_GRAPHEMES = 80;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type Survivor = { label: PiiLabel; score: number; text: string };

const isMasked = (value: string) => value.replaceAll(BLOCK, "").trim().length === 0;

const preview = (value: string) => {
  const segments = [...GRAPHEMES.segment(value)];

  if (segments.length <= PREVIEW_GRAPHEMES) {
    return value;
  }

  return segments
    .slice(0, PREVIEW_GRAPHEMES)
    .map((segment) => segment.segment)
    .join("");
};

const survivingSpans = async (text: string, detect: Detect): Promise<Array<Survivor>> => {
  if (text.trim().length === 0) {
    return [];
  }

  const spans = await detect(text);
  const survivors: Array<Survivor> = [];

  for (const span of spans) {
    if (span.score < APPLY_SCORE) {
      continue;
    }

    const covered = text.slice(span.start, span.end);

    if (isMasked(covered)) {
      continue;
    }

    survivors.push({ label: span.label, score: span.score, text: preview(covered) });
  }

  return survivors;
};

export { survivingSpans };
export type { Survivor };
