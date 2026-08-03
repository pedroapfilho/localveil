import type { ImageReading } from "@repo/ocr";
import { legibleWords, muchWasUnreadable, readImageText } from "@repo/ocr";
import type { Detect, Rect, Redactor, WarningKey } from "@repo/redact-core";
import {
  buildWordIndex,
  mergeOverlappingRanges,
  spansForTokens,
  spansToRects,
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

const findRedactions = async (reading: ImageReading, detect: Detect) => {
  const { text, words } = buildWordIndex(legibleWords(reading));

  if (text.length === 0) {
    return { keys: [], rects: [] };
  }

  const detected = await detect(text);
  const spans = [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))];
  const ranges = mergeOverlappingRanges(spans);

  return {
    keys: ranges.map((range) =>
      text
        .slice(range.start, range.end)
        .normalize("NFD")
        .replaceAll(/[^\p{Letter}\p{Number}]/gv, "")
        .toLowerCase(),
    ),
    rects: spansToRects(spans, words),
  };
};

const redactionCount = (results: Array<Awaited<ReturnType<typeof findRedactions>>>) => {
  const maximums = new Map<string, number>();

  for (const result of results) {
    const occurrences = new Map<string, number>();

    for (const key of result.keys) {
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }

    for (const [key, count] of occurrences) {
      maximums.set(key, Math.max(maximums.get(key) ?? 0, count));
    }
  }

  return [...maximums.values()].reduce((total, count) => total + count, 0);
};

const imageRedactor: Redactor = {
  accepts: (file) => file.type.startsWith("image/") || hasImageExtension(file.name),
  redact: async (file, detect, onProgress, options) => {
    onProgress(0, "stage.reading");

    const bitmap = await createImageBitmap(file);

    onProgress(0.1, "stage.recognising");

    const first = await readImageText(
      file,
      options?.language === undefined ? {} : { known: options.language },
    );
    const readings = [first];

    if (shouldRetryOcr(first)) {
      const prepared = binarizeForOcr(bitmap);
      const retried = await readImageText(
        prepared,
        options?.language === undefined ? {} : { known: options.language },
      );

      readings.push(retried);
    }

    const reading = readings.reduce((best, candidate) => betterReading(best, candidate));

    const warnings: Array<WarningKey> = [];

    if (reading.words.length === 0) {
      warnings.push("warning.noText");
    } else if (muchWasUnreadable(reading)) {
      warnings.push("warning.lowConfidence");
    }

    onProgress(0.6, "stage.detecting");

    const redactions = await Promise.all(
      readings.map((candidate) => findRedactions(candidate, detect)),
    );

    onProgress(0.85, "stage.redacting");

    const rects = redactions.flatMap((result) => result.rects);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);

    paint(canvas, bitmap, rects);
    bitmap.close();

    const type = ENCODABLE.has(file.type) ? file.type : "image/png";
    const blob = await canvas.convertToBlob({ type });

    onProgress(1, "stage.finished");

    return {
      blob,
      redactionCount: redactionCount(redactions),
      warnings,
    };
  },
};

export { imageRedactor };
