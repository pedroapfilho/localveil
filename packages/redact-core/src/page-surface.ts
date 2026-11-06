import { isAnalysedReading, keptSpans } from "./analysis";
import { extentOf, runsOf, unitOf } from "./reading-order";
import type {
  AnalysedReading,
  Analysis,
  Bbox,
  Decisions,
  PositionedWord,
  Rect,
  Span,
  WordInput,
} from "./types";

type PageSurface = { text: string; words: Array<PositionedWord> };

type SurfaceReading = AnalysedReading & PageSurface;

type Passes = { chosen: PageSurface; passedOver: ReadonlyArray<PageSurface> };

const JOINER = " ";

const surfaceOf = (words: ReadonlyArray<WordInput>): PageSurface => {
  const positioned: Array<PositionedWord> = [];
  let cursor = 0;

  for (const { bbox, text } of words) {
    positioned.push({ bbox, charEnd: cursor + text.length, charStart: cursor, text });
    cursor += text.length + JOINER.length;
  }

  return { text: words.map((word) => word.text).join(JOINER), words: positioned };
};

const isSurfaceReading = (value: unknown): value is SurfaceReading =>
  isAnalysedReading(value) && "words" in value && Array.isArray(value.words);

/* An analysis comes back from the review as plain data, so a redactor that paints checks it still
   carries the words it placed its boxes by. */
const surfaceUnits = (analysis: Analysis): Array<Array<SurfaceReading>> =>
  analysis.units.map((readings) =>
    readings.map((reading) => {
      if (!isSurfaceReading(reading)) {
        throw new TypeError("The analysis carried no recognised words to paint from");
      }

      return reading;
    }),
  );

const rectOf = ({ x0, x1, y0, y1 }: Bbox): Rect => ({
  height: y1 - y0,
  width: x1 - x0,
  x: x0,
  y: y0,
});

const rectsFor = (surface: PageSurface, spans: ReadonlyArray<Span>): Array<Rect> => {
  const unit = unitOf(surface.words);

  if (unit === undefined) {
    return [];
  }

  return spans.flatMap((span) =>
    runsOf(
      surface.words.filter((word) => word.charStart < span.end && word.charEnd > span.start),
      unit,
    ).map((run) => rectOf(extentOf(run))),
  );
};

const overlaps = (bbox: Bbox, rect: Rect) =>
  bbox.x0 < rect.x + rect.width &&
  bbox.x1 > rect.x &&
  bbox.y0 < rect.y + rect.height &&
  bbox.y1 > rect.y;

const uncovered = (surface: PageSurface, rects: ReadonlyArray<Rect>): PageSurface =>
  surfaceOf(surface.words.filter((word) => !rects.some((rect) => overlaps(word.bbox, rect))));

const scanOf = ({ chosen, passedOver }: Passes) => ({ readings: [chosen, ...passedOver] });

/* Every reading of a unit paints, since a value only one OCR pass read is still on the page, but
   only the chosen reading, which scanOf puts first, says what stays visible. */
const coverUnit = (readings: ReadonlyArray<SurfaceReading>, decisions: Decisions) => {
  const rects = readings.flatMap((reading) => rectsFor(reading, keptSpans(reading, decisions)));
  const [chosen] = readings;

  return { rects, visible: chosen === undefined ? [] : uncovered(chosen, rects).words };
};

const contextOf = (canvas: OffscreenCanvas) => {
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("This browser gave no 2d canvas to draw on");
  }

  return context;
};

const paint = (canvas: OffscreenCanvas, rects: ReadonlyArray<Rect>) => {
  const context = contextOf(canvas);

  context.fillStyle = "#000000";

  for (const { height, width, x, y } of rects) {
    context.fillRect(x, y, width, height);
  }
};

export { contextOf, coverUnit, paint, rectsFor, scanOf, surfaceOf, surfaceUnits, uncovered };

export type { PageSurface };
