import type { ReadText, TextReading } from "@repo/ocr";
import type { AnalysedUnit, PageSurface, Redactor, WarningKey } from "@repo/redact-core";
import {
  analyseUnits,
  contextOf,
  isAnalysedUnit,
  isPageSurface,
  keptSpans,
  paint,
  rectsFor,
  redactionCount,
  surfaceOf,
  uncovered,
  verifyOutput,
} from "@repo/redact-core";

const ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

type Reading = AnalysedUnit & PageSurface;

/* The first reading is the one the reader chose; the rest are the passes it passed over. */
type ImageHandle = { readings: Array<Reading> };

const canvasOf = async (file: Blob) => {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);

    contextOf(canvas).drawImage(bitmap, 0, 0);

    return canvas;
  } finally {
    bitmap.close();
  }
};

const warningsFor = ({ legibility }: TextReading): Array<WarningKey> => {
  if (legibility === "blank") {
    return ["warning.noText"];
  }

  return legibility === "unreadable" ? ["warning.lowConfidence"] : [];
};

const isHandle = (value: unknown): value is ImageHandle =>
  typeof value === "object" &&
  value !== null &&
  "readings" in value &&
  Array.isArray(value.readings) &&
  value.readings.every((reading) => isAnalysedUnit(reading) && isPageSurface(reading));

const createImageRedactor = (read: ReadText): Redactor => ({
  analyse: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");

    const page = await canvasOf(file);

    onProgress(0.1, "stage.recognising");

    const reading = await read(page);

    onProgress(0.6, "stage.detecting");

    const { detections, units } = await analyseUnits({
      detect,
      kind: "readings",
      units: [reading.words, ...reading.alternatives].map(surfaceOf),
    });

    onProgress(1, "stage.finished");

    return {
      detections,
      handle: { readings: units } satisfies ImageHandle,
      warnings: warningsFor(reading),
    };
  },
  apply: async ({ analysis, decisions, detect, file, onProgress }) => {
    if (!isHandle(analysis.handle)) {
      throw new TypeError("The image analysis carried no recognised readings to paint from");
    }

    const { readings } = analysis.handle;

    onProgress(0.85, "stage.redacting");

    const rects = readings.flatMap((reading) => rectsFor(reading, keptSpans(reading, decisions)));
    const canvas = await canvasOf(file);

    paint(canvas, rects);

    const [chosen] = readings;
    const warnings = await verifyOutput(
      chosen === undefined ? "" : uncovered(chosen, rects).text,
      detect,
      analysis.warnings,
    );
    const blob = await canvas.convertToBlob({
      type: ENCODABLE.has(file.type) ? file.type : "image/png",
    });

    onProgress(1, "stage.finished");

    return { blob, redactionCount: redactionCount("readings", readings, decisions), warnings };
  },
});

export { createImageRedactor };
