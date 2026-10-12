import { APPLY_SCORE } from "./detections";
import { preview } from "./text";
import type { Detect, PiiLabel } from "./types";

const BLOCK = "█";

type Survivor = { label: PiiLabel; score: number; text: string };

const isMasked = (value: string) => value.replaceAll(BLOCK, "").trim().length === 0;

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
