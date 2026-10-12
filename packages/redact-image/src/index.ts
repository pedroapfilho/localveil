import { assessReading, readImageText } from "@repo/ocr";
import type { AnalysedUnit, PositionedWord, Rect, Redactor, WarningKey } from "@repo/redact-core";
import {
  analyseUnits,
  buildWordIndex,
  isAnalysedUnit,
  isCovered,
  keptSpans,
  redactionCount,
  spansToRects,
  survivingSpans,
} from "@repo/redact-core";

import { betterReading, binarizeForOcr, shouldRetryOcr } from "./ocr-retry";

const ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

type Reading = AnalysedUnit & { words: Array<PositionedWord> };

type ImageHandle = { best: number; readings: Array<Reading> };

const paint = (canvas: OffscreenCanvas, bitmap: ImageBitmap, rects: Array<Rect>) => {
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("This browser gave no 2d canvas to draw the redactions on");
  }

  context.drawImage(bitmap, 0, 0);
  context.fillStyle = "#000000";

  for (const rect of rects) {
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
};

const withBitmap = async <T>(file: Blob, body: (bitmap: ImageBitmap) => Promise<T>): Promise<T> => {
  const bitmap = await createImageBitmap(file);

  try {
    return await body(bitmap);
  } finally {
    bitmap.close();
  }
};

const isHandle = (value: unknown): value is ImageHandle =>
  typeof value === "object" &&
  value !== null &&
  "readings" in value &&
  Array.isArray(value.readings) &&
  value.readings.every(isAnalysedUnit) &&
  "best" in value &&
  typeof value.best === "number";

const imageRedactor: Redactor = {
  analyse: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");
    onProgress(0.1, "stage.recognising");

    const first = await readImageText(file);
    const readings = [first];

    if (shouldRetryOcr(first)) {
      readings.push(await withBitmap(file, (bitmap) => readImageText(binarizeForOcr(bitmap))));
    }

    const chosen = readings.reduce((kept, candidate) => betterReading(kept, candidate));
    const warnings: Array<WarningKey> = [];

    if (chosen.words.length === 0) {
      warnings.push("warning.noText");
    } else if (assessReading(chosen).unreadable) {
      warnings.push("warning.lowConfidence");
    }

    onProgress(0.6, "stage.detecting");

    const { detections, units } = await analyseUnits({
      detect,
      kind: "readings",
      units: readings.map((candidate) => buildWordIndex(assessReading(candidate).legible)),
    });

    onProgress(1, "stage.finished");

    return {
      detections,
      handle: { best: readings.indexOf(chosen), readings: units } satisfies ImageHandle,
      warnings,
    };
  },
  apply: async ({ analysis, decisions, detect, file, onProgress }) => {
    if (!isHandle(analysis.handle)) {
      throw new TypeError("The image analysis carried no recognised readings to paint from");
    }

    const { best, readings } = analysis.handle;

    onProgress(0.85, "stage.redacting");

    const rects = readings.flatMap((reading) =>
      spansToRects(keptSpans(reading, decisions), reading.words),
    );

    const canvas = await withBitmap(file, (bitmap) => {
      const target = new OffscreenCanvas(bitmap.width, bitmap.height);

      paint(target, bitmap, rects);

      return Promise.resolve(target);
    });

    const showing = (readings[best]?.words ?? []).filter((word) => !isCovered(word.bbox, rects));
    const survivors = await survivingSpans(showing.map((word) => word.text).join(" "), detect);
    const warnings: Array<WarningKey> = [...analysis.warnings];

    if (survivors.length > 0) {
      warnings.push("warning.notFullyRedacted");
    }

    const type = ENCODABLE.has(file.type) ? file.type : "image/png";
    const blob = await canvas.convertToBlob({ type });

    onProgress(1, "stage.finished");

    return { blob, redactionCount: redactionCount("readings", readings, decisions), warnings };
  },
};

export { imageRedactor };
