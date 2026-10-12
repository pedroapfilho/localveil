import { definedTerms, dropDefinedTerms } from "./defined-terms";
import { absorbNested, mergeOverlappingRanges } from "./merge-spans";
import { spansForTokens, tokensFromSpans } from "./repeats";
import { preview } from "./text";
import type { Decisions, Detect, DetectedText, Detection, Span } from "./types";

/* A file is one unit read whole and pages are the parts of one document, so only a page's
   detections say where in the document they sit. */
type UnitKind = "file" | "pages";

type Reading = { text: string };

/* A scan holds every OCR pass over one surface. A value on it is one decision whichever pass saw it
   and wherever it sat there, or dismissing it would still paint it from another pass. Typed text is
   read once, so a detection there is the span where it sits. */
type Scan<R extends Reading> = { readings: ReadonlyArray<R> };

type Unit<R extends Reading> = R | Scan<R>;

type Mark = Span & { id: string };

type AnalysedReading = { marks: Array<Mark>; text: string };

type UnitAnalysis<R extends Reading> = {
  detect: Detect;
  kind: UnitKind;
  units: ReadonlyArray<Unit<R>>;
};

type Identified = { detections: Array<Detection>; marks: Array<Array<Mark>> };

type Identify = (readings: ReadonlyArray<DetectedText>, page: number | undefined) => Identified;

const keyOf = (value: string) =>
  value
    .normalize("NFD")
    .replaceAll(/[^\p{Letter}\p{Number}]/gv, "")
    .toLowerCase();

const scopeOf = (page: number | undefined) => (page === undefined ? "" : String(page));

const describe = (span: Span, text: string, id: string, page: number | undefined): Detection => {
  const detection: Detection = {
    confidence: span.score,
    end: span.end,
    id,
    label: span.label,
    preview: preview(text.slice(span.start, span.end)),
    start: span.start,
  };

  if (page !== undefined) {
    detection.page = page;
  }

  return detection;
};

const byPosition: Identify = (readings, page) => {
  const detections: Array<Detection> = [];

  const marks = readings.map(({ spans, text }) => {
    const described = spans.map((span) =>
      describe(
        span,
        text,
        `${scopeOf(page)}:${String(span.start)}-${String(span.end)}:${span.label}`,
        page,
      ),
    );
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

const byValue: Identify = (readings, page) => {
  const byId = new Map<string, Detection>();

  /* A repeat lands on the very span the detector tagged, so marks are keyed by place as well as id
     to paint each place once. */
  const marks = readings.map(({ spans, text }) => {
    const placed = new Map<string, Mark>();

    for (const span of spans) {
      const id = `${scopeOf(page)}:${span.label}:${keyOf(text.slice(span.start, span.end))}`;
      const existing = byId.get(id);

      if (existing === undefined || existing.confidence < span.score) {
        byId.set(id, describe(span, text, id, page));
      }

      placed.set(`${String(span.start)}-${String(span.end)}:${id}`, { ...span, id });
    }

    return [...placed.values()];
  });

  return { detections: [...byId.values()], marks };
};

const isScan = <R extends Reading>(unit: Unit<R>): unit is Scan<R> => "readings" in unit;

/* Repeats and defined terms read every reading of every unit, so a name tagged on page 1 is covered
   on page 5 too. Defined terms drop after the repeats join, which would otherwise bring a role the
   document defined for itself, "Client", back wherever it recurs. */
const analyseUnits = async <R extends Reading>({ detect, kind, units }: UnitAnalysis<R>) => {
  const surfaces: Array<{
    found: Array<DetectedText>;
    identify: Identify;
    readings: ReadonlyArray<R>;
  }> = [];

  for (const unit of units) {
    const { identify, readings } = isScan(unit)
      ? { identify: byValue, readings: unit.readings }
      : { identify: byPosition, readings: [unit] };
    const found: Array<DetectedText> = [];

    for (const { text } of readings) {
      found.push({ spans: text.length === 0 ? [] : await detect(text), text });
    }

    surfaces.push({ found, identify, readings });
  }

  const everything = surfaces.flatMap(({ found }) => found);
  const tokens = tokensFromSpans(everything);
  const terms = definedTerms(everything);
  const detections: Array<Detection> = [];

  const analysed = surfaces.map(({ found, identify, readings }, at) => {
    const identified = identify(
      found.map(({ spans, text }) => ({
        spans: dropDefinedTerms([...spans, ...spansForTokens(text, tokens)], text, terms),
        text,
      })),
      kind === "pages" ? at : undefined,
    );

    detections.push(...identified.detections);

    return readings.map((reading, index) => ({ ...reading, marks: identified.marks[index] ?? [] }));
  });

  return { detections, units: analysed };
};

const isAnalysedReading = (value: unknown): value is AnalysedReading =>
  typeof value === "object" &&
  value !== null &&
  "marks" in value &&
  Array.isArray(value.marks) &&
  "text" in value &&
  typeof value.text === "string";

const keptSpans = (reading: AnalysedReading, decisions: Decisions): Array<Span> => {
  const covered = new Set(decisions.covered);

  return reading.marks.filter((mark) => covered.has(mark.id));
};

/* A unit's readings are alternatives, so a value counts as often as the one reading that shows it
   most. A unit read once therefore counts every redaction it shows. */
const countValues = (readings: ReadonlyArray<AnalysedReading>, decisions: Decisions) => {
  const maximums = new Map<string, number>();

  for (const reading of readings) {
    const occurrences = new Map<string, number>();

    for (const range of mergeOverlappingRanges(keptSpans(reading, decisions))) {
      const key = keyOf(reading.text.slice(range.start, range.end));

      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }

    for (const [key, count] of occurrences) {
      maximums.set(key, Math.max(maximums.get(key) ?? 0, count));
    }
  }

  return [...maximums.values()].reduce((total, count) => total + count, 0);
};

const redactionCount = (
  units: ReadonlyArray<ReadonlyArray<AnalysedReading>>,
  decisions: Decisions,
) => units.reduce((total, readings) => total + countValues(readings, decisions), 0);

export { analyseUnits, isAnalysedReading, keptSpans, redactionCount };
export type { AnalysedReading };
