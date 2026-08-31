import { absorbNested } from "./merge-spans";
import type { Decisions, Detection, Span } from "./types";

const APPLY_SCORE = 0.65;

const PREVIEW_GRAPHEMES = 80;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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

const idFor = (span: Span, page?: number) =>
  `${page === undefined ? "" : String(page)}:${String(span.start)}-${String(span.end)}:${span.label}`;

const describeSpans = (spans: Array<Span>, text: string, page?: number): Array<Detection> =>
  spans.map((span) => {
    const detection: Detection = {
      confidence: span.score,
      end: span.end,
      id: idFor(span, page),
      label: span.label,
      preview: preview(text.slice(span.start, span.end)),
      start: span.start,
    };

    if (page !== undefined) {
      detection.page = page;
    }

    return detection;
  });

const dedupeDetections = (detections: Array<Detection>): Array<Detection> =>
  absorbNested(
    detections,
    (detection) =>
      `${detection.page === undefined ? "" : String(detection.page)}:${detection.label}`,
    (detection) => detection.confidence,
    (detection, confidence) => ({ ...detection, confidence }),
  ).toSorted((left, right) => (left.page ?? 0) - (right.page ?? 0) || left.start - right.start);

const defaultDecisions = (detections: ReadonlyArray<Detection>): Decisions => {
  const covered: Array<string> = [];

  for (const detection of detections) {
    if (detection.confidence >= APPLY_SCORE) {
      covered.push(detection.id);
    }
  }

  return { covered };
};

const keptSpans = (detections: Array<Detection>, decisions: Decisions, page?: number) => {
  const covered = new Set(decisions.covered);
  const kept: Array<Span> = [];

  for (const detection of detections) {
    if (detection.page !== page || !covered.has(detection.id)) {
      continue;
    }

    kept.push({
      end: detection.end,
      label: detection.label,
      score: detection.confidence,
      start: detection.start,
    });
  }

  return kept;
};

export { APPLY_SCORE, dedupeDetections, defaultDecisions, describeSpans, keptSpans };
