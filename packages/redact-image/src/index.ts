import { legibleWords, muchWasUnreadable, readImageText } from "@repo/ocr";
import type { Rect, Redactor, WarningKey } from "@repo/redact-core";
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

const imageRedactor: Redactor = {
  accepts: (file) => file.type.startsWith("image/") || hasImageExtension(file.name),
  redact: async (file, detect, onProgress, options) => {
    onProgress(0, "stage.reading");

    const bitmap = await createImageBitmap(file);

    onProgress(0.1, "stage.recognising");

    let reading = await readImageText(
      file,
      options?.language === undefined ? {} : { known: options.language },
    );

    if (shouldRetryOcr(reading)) {
      const prepared = binarizeForOcr(bitmap);
      const retried = await readImageText(prepared, {
        known: options?.language ?? reading.language,
      });

      reading = betterReading(reading, retried);
    }

    const warnings: Array<WarningKey> = [];

    if (reading.words.length === 0) {
      warnings.push("warning.noText");
    } else if (muchWasUnreadable(reading)) {
      warnings.push("warning.lowConfidence");
    }

    onProgress(0.6, "stage.detecting");

    const { text, words } = buildWordIndex(legibleWords(reading));
    const detected = await detect(text);
    const spans = [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))];

    onProgress(0.85, "stage.redacting");

    const rects = spansToRects(spans, words);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);

    paint(canvas, bitmap, rects);
    bitmap.close();

    const type = ENCODABLE.has(file.type) ? file.type : "image/png";
    const blob = await canvas.convertToBlob({ type });

    onProgress(1, "stage.finished");

    return { blob, redactionCount: mergeOverlappingRanges(spans).length, warnings };
  },
};

export { imageRedactor };
