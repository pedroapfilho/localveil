import { readImageText } from "@repo/ocr";
import type { Rect, Redactor, WarningKey } from "@repo/redact-core";
import {
  buildWordIndex,
  mergeOverlappingRanges,
  spansForTokens,
  spansToRects,
  tokensFromSpans,
} from "@repo/redact-core";

// Tesseract reports its confidence out of 100. Below this the page is legible
// enough to produce words but not enough to trust that it produced all of them.
const MIN_CONFIDENCE = 70;

const ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

// A file dragged out of some archives and file managers arrives with no type at
// all, so the name has to be able to answer on its own.
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
  redact: async (file, detect, onProgress) => {
    onProgress(0, "stage.reading");

    const bitmap = await createImageBitmap(file);

    onProgress(0.1, "stage.recognising");

    // The file goes to the recogniser rather than the bitmap: Tesseract decodes it
    // itself, and its boxes come back in the image's own pixels, which is the space
    // the canvas draws in.
    const reading = await readImageText(file);
    const warnings: Array<WarningKey> = [];

    if (reading.words.length === 0) {
      warnings.push("warning.noText");
    } else if (reading.confidence < MIN_CONFIDENCE) {
      warnings.push("warning.lowConfidence");
    }

    onProgress(0.6, "stage.detecting");

    const { text, words } = buildWordIndex(reading.words);
    const detected = text.length === 0 ? [] : await detect(text);
    // A name the model tagged once but missed later is still that name.
    const spans = [...detected, ...spansForTokens(text, tokensFromSpans(text, detected))];

    onProgress(0.85, "stage.redacting");

    const rects = spansToRects(spans, words);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);

    paint(canvas, bitmap, rects);
    bitmap.close();

    // An animated GIF or an SVG cannot be written back out, so the redacted copy
    // becomes a PNG rather than failing the file.
    const type = ENCODABLE.has(file.type) ? file.type : "image/png";
    const blob = await canvas.convertToBlob({ type });

    onProgress(1, "stage.finished");

    return { blob, redactionCount: mergeOverlappingRanges(spans).length, warnings };
  },
};

export { imageRedactor, MIN_CONFIDENCE };
