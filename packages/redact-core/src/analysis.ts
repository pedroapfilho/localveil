import { definedTerms, dropDefinedTerms } from "./defined-terms";
import { absorbNested, mergeOverlappingRanges } from "./merge-spans";
import { spansForTokens, tokensFromSpans } from "./repeats";
import { preview } from "./text";
import type { Decisions, Detect, DetectedText, Detection, Span } from "./types";

/* A file is one unit read whole and pages are the parts of one document, so either addresses a
   detection by where it sits. Readings are alternative transcriptions of one surface: a value is
   one decision whichever reading saw it and wherever it sat there, or dismissing it would still
   paint it from another reading. */
type UnitKind = "file" | "pages" | "readings";

type Mark = Span & { id: string };

type AnalysedUnit = { marks: Array<Mark>; text: string };

type UnitAnalysis<Unit> = { detect: Detect; kind: UnitKind; units: ReadonlyArray<Unit> };

type Identified = { detections: Array<Detection>; marks: Array<Array<Mark>> };

const keyOf = (value: string) =>
  value
    .normalize("NFD")
    .replaceAll(/[^\p{Letter}\p{Number}]/gv, "")
    .toLowerCase();

const describe = (span: Span, text: string, id: string): Detection => ({
  confidence: span.score,
  end: span.end,
  id,
  label: span.label,
  preview: preview(text.slice(span.start, span.end)),
  start: span.start,
});

const byPosition = (units: ReadonlyArray<DetectedText>, paged: boolean): Identified => {
  const detections: Array<Detection> = [];

  const marks = units.map(({ spans, text }, page) => {
    const prefix = paged ? String(page) : "";
    const described = spans.map((span) => {
      const detection = describe(
        span,
        text,
        `${prefix}:${String(span.start)}-${String(span.end)}:${span.label}`,
      );

      if (paged) {
        detection.page = page;
      }

      return detection;
    });
    const kept = absorbNested(
      described,
      (detection) => detection.label,
      (detection) => detection.confidence,
      (detection, confidence) => ({ ...detection, confidence }),
    ).toSorted((left, right) => left.start - right.start);

    detections.push(...kept);

    return kept.map(({ confidence, end, id, label, start }) => ({
      end,
      id,
      label,
      score: confidence,
      start,
    }));
  });

  return { detections, marks };
};

const byValue = (units: ReadonlyArray<DetectedText>): Identified => {
  const byId = new Map<string, Detection>();

  const marks = units.map(({ spans, text }) =>
    spans.map((span) => {
      const id = `${span.label}:${keyOf(text.slice(span.start, span.end))}`;
      const existing = byId.get(id);

      if (existing === undefined || existing.confidence < span.score) {
        byId.set(id, describe(span, text, id));
      }

      return { ...span, id };
    }),
  );

  return { detections: [...byId.values()], marks };
};

/* Repeats and defined terms read every unit, so a name tagged on page 1 is covered on page 5 too.
   Defined terms drop after the repeats join, which would otherwise bring a role the document
   defined for itself, "Client", back wherever it recurs. */
const analyseUnits = async <Unit extends { text: string }>({
  detect,
  kind,
  units,
}: UnitAnalysis<Unit>) => {
  const found: Array<DetectedText> = [];

  for (const { text } of units) {
    found.push({ spans: text.length === 0 ? [] : await detect(text), text });
  }

  const tokens = tokensFromSpans(found);
  const terms = definedTerms(found);
  const analysed = found.map(({ spans, text }) => ({
    spans: dropDefinedTerms([...spans, ...spansForTokens(text, tokens)], text, terms),
    text,
  }));
  const { detections, marks } =
    kind === "readings" ? byValue(analysed) : byPosition(analysed, kind === "pages");

  return { detections, units: units.map((unit, at) => ({ ...unit, marks: marks[at] ?? [] })) };
};

const isAnalysedUnit = (value: unknown): value is AnalysedUnit =>
  typeof value === "object" &&
  value !== null &&
  "marks" in value &&
  Array.isArray(value.marks) &&
  "text" in value &&
  typeof value.text === "string";

const keptSpans = (unit: AnalysedUnit, decisions: Decisions): Array<Span> => {
  const covered = new Set(decisions.covered);

  return unit.marks.filter((mark) => covered.has(mark.id));
};

/* Readings are alternatives, so a value counts as often as the one reading that shows it most. */
const countValues = (kept: ReadonlyArray<DetectedText>) => {
  const maximums = new Map<string, number>();

  for (const { spans, text } of kept) {
    const occurrences = new Map<string, number>();

    for (const range of mergeOverlappingRanges(spans)) {
      const key = keyOf(text.slice(range.start, range.end));

      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }

    for (const [key, count] of occurrences) {
      maximums.set(key, Math.max(maximums.get(key) ?? 0, count));
    }
  }

  return [...maximums.values()].reduce((total, count) => total + count, 0);
};

const redactionCount = (
  kind: UnitKind,
  units: ReadonlyArray<AnalysedUnit>,
  decisions: Decisions,
) => {
  const kept = units.map((unit) => ({ spans: keptSpans(unit, decisions), text: unit.text }));

  return kind === "readings"
    ? countValues(kept)
    : kept.reduce((total, { spans }) => total + mergeOverlappingRanges(spans).length, 0);
};

export { analyseUnits, isAnalysedUnit, keptSpans, redactionCount };
export type { AnalysedUnit };
