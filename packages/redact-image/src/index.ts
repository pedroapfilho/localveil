import type { ReadText, TextReading } from "@repo/ocr";
import type { Redactor, WarningKey } from "@repo/redact-core";
import {
  analyseUnits,
  contextOf,
  coverUnit,
  paint,
  scanOf,
  surfaceOf,
  surfaceUnits,
} from "@repo/redact-core";

const ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

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

const createImageRedactor = (read: ReadText): Redactor => ({
  analyse: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");

    const page = await canvasOf(file);

    onProgress(0.1, "stage.recognising");

    const reading = await read(page);

    onProgress(0.6, "stage.detecting");

    const { detections, units } = await analyseUnits({
      detect,
      kind: "file",
      units: [scanOf(reading)],
    });

    return { detections, units, warnings: warningsFor(reading) };
  },
  apply: async ({ analysis, decisions, file, onProgress }) => {
    const [readings = []] = surfaceUnits(analysis);

    onProgress(0.85, "stage.redacting");

    const { rects, visible } = coverUnit(readings, decisions);
    const canvas = await canvasOf(file);

    paint(canvas, rects);

    const blob = await canvas.convertToBlob({
      type: ENCODABLE.has(file.type) ? file.type : "image/png",
    });

    return { blob, visible: surfaceOf(visible).text, warnings: [] };
  },
});

export { createImageRedactor };
