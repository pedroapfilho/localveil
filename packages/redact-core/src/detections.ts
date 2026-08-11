import type { Decisions, Detection, DetectionSource, Span } from "./types.ts";

// Spans at or above this are covered unless somebody dismisses them; spans below it are
// offered as suggestions and covered only if somebody ticks them. Swept in packages/eval:
// see BASELINE.md for what each floor costs.
const APPLY_SCORE = 0.65;

const PREVIEW_GRAPHEMES = 80;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type Described = {
  applyAbove: number;
  page?: number;
  source: DetectionSource;
  spans: Array<Span>;
  text: string;
};

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

const describeSpans = ({ applyAbove, page, source, spans, text }: Described): Array<Detection> =>
  spans.map((span) => ({
    confidence: span.score,
    end: span.end,
    id: idFor(span, page),
    label: span.label,
    ...(page === undefined ? {} : { page }),
    preview: preview(text.slice(span.start, span.end)),
    source,
    start: span.start,
    suggested: span.score < applyAbove,
  }));

const dedupeDetections = (detections: Array<Detection>): Array<Detection> => {
  const byId = new Map<string, Detection>();

  for (const detection of detections) {
    const existing = byId.get(detection.id);

    if (existing === undefined || existing.confidence < detection.confidence) {
      byId.set(detection.id, detection);
    }
  }

  return [...byId.values()].toSorted(
    (left, right) => (left.page ?? 0) - (right.page ?? 0) || left.start - right.start,
  );
};

const keptSpans = (detections: Array<Detection>, decisions: Decisions, page?: number) => {
  const dismissed = new Set(decisions.dismissed);
  const chosen = new Set(decisions.kept);
  const kept: Array<Span> = [];

  for (const detection of detections) {
    if (detection.page !== page || dismissed.has(detection.id)) {
      continue;
    }

    if (detection.suggested && !chosen.has(detection.id)) {
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

export { APPLY_SCORE, dedupeDetections, describeSpans, keptSpans };
export type { Described };
