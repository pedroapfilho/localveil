import type { ImageReading } from "@repo/ocr";
import { assessReading, readImageText } from "@repo/ocr";
import type {
  Decisions,
  Detect,
  Detection,
  PositionedWord,
  Rect,
  Redactor,
  Span,
  WarningKey,
} from "@repo/redact-core";
import {
  buildWordIndex,
  dedupeDetections,
  describeSpans,
  isCovered,
  mergeOverlappingRanges,
  spansForTokens,
  spansToRects,
  survivingSpans,
  tokensFromSpans,
} from "@repo/redact-core";

import { betterReading, binarizeForOcr, shouldRetryOcr } from "./ocr-retry.ts";

const ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

type Reading = { spans: Array<Span>; text: string; words: Array<PositionedWord> };

type ImageHandle = { best: number; readings: Array<Reading> };

const hasImageExtension = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
};

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

const readingOf = async (reading: ImageReading, detect: Detect): Promise<Reading> => {
  const { text, words } = buildWordIndex(assessReading(reading).legible);

  if (text.length === 0) {
    return { spans: [], text, words };
  }

  const detected = await detect(text);

  return {
    spans: [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))],
    text,
    words,
  };
};

const keyOf = (value: string) =>
  value
    .normalize("NFD")
    .replaceAll(/[^\p{Letter}\p{Number}]/gv, "")
    .toLowerCase();

const idFor = (label: string, value: string) => `${label}:${keyOf(value)}`;

const valueDetections = (readings: Array<Reading>): Array<Detection> => {
  const byId = new Map<string, Detection>();

  for (const reading of readings) {
    for (const detection of describeSpans(reading.spans, reading.text)) {
      const id = idFor(detection.label, reading.text.slice(detection.start, detection.end));
      const existing = byId.get(id);

      if (existing === undefined || existing.confidence < detection.confidence) {
        byId.set(id, Object.assign(detection, { id }));
      }
    }
  }

  return dedupeDetections([...byId.values()]);
};

const coveredSpans = (reading: Reading, decisions: Decisions) => {
  const covered = new Set(decisions.covered);

  return reading.spans.filter((span) =>
    covered.has(idFor(span.label, reading.text.slice(span.start, span.end))),
  );
};

const countRedactions = (readings: Array<Reading>, spansFor: (at: number) => Array<Span>) => {
  const maximums = new Map<string, number>();

  readings.forEach((reading, at) => {
    const occurrences = new Map<string, number>();

    for (const range of mergeOverlappingRanges(spansFor(at))) {
      const key = keyOf(reading.text.slice(range.start, range.end));

      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }

    for (const [key, count] of occurrences) {
      maximums.set(key, Math.max(maximums.get(key) ?? 0, count));
    }
  });

  return [...maximums.values()].reduce((total, count) => total + count, 0);
};

const isHandle = (value: unknown): value is ImageHandle =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray(Reflect.get(value, "readings")) &&
  typeof Reflect.get(value, "best") === "number";

const imageRedactor: Redactor = {
  accepts: (file) => file.type.startsWith("image/") || hasImageExtension(file.name),
  analyse: async (file, detect, onProgress, options) => {
    onProgress(0, "stage.reading");
    onProgress(0.1, "stage.recognising");

    const known = options?.language === undefined ? {} : { known: options.language };
    const first = await readImageText(file, known);
    const readings = [first];

    if (shouldRetryOcr(first)) {
      readings.push(
        await withBitmap(file, (bitmap) => readImageText(binarizeForOcr(bitmap), known)),
      );
    }

    const chosen = readings.reduce((kept, candidate) => betterReading(kept, candidate));
    const warnings: Array<WarningKey> = [];

    if (chosen.words.length === 0) {
      warnings.push("warning.noText");
    } else if (assessReading(chosen).unreadable) {
      warnings.push("warning.lowConfidence");
    }

    onProgress(0.6, "stage.detecting");

    const read = await Promise.all(readings.map((candidate) => readingOf(candidate, detect)));

    onProgress(1, "stage.finished");

    return {
      detections: valueDetections(read),
      handle: { best: readings.indexOf(chosen), readings: read } satisfies ImageHandle,
      warnings,
    };
  },
  apply: async ({ analysis, decisions, detect, file, onProgress }) => {
    if (!isHandle(analysis.handle)) {
      throw new TypeError("The image analysis carried no recognised readings to paint from");
    }

    const { best, readings } = analysis.handle;

    onProgress(0.85, "stage.redacting");

    const spansFor = (at: number) => coveredSpans(readings[at], decisions);
    const rects = readings.flatMap((reading, at) => spansToRects(spansFor(at), reading.words));

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

    return { blob, redactionCount: countRedactions(readings, spansFor), warnings };
  },
};

export { imageRedactor };
