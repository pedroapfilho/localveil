import type { ImageReading, Recognition } from "@repo/ocr";
import { legibleWords, muchWasUnreadable } from "@repo/ocr";

const OCR_LUMINANCE_THRESHOLD = 120;

const binarizePixels = (pixels: Uint8ClampedArray, threshold: number = OCR_LUMINANCE_THRESHOLD) => {
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
    const value = luminance < threshold ? 0 : 255;

    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
};

const binarizeForOcr = (source: ImageBitmap) => {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("This browser gave no 2d canvas to prepare the image for recognition");
  }

  context.drawImage(source, 0, 0);

  const pixels = context.getImageData(0, 0, source.width, source.height);

  binarizePixels(pixels.data);
  context.putImageData(pixels, 0, 0);

  return canvas;
};

const shouldRetryOcr = (reading: Recognition) =>
  reading.words.length === 0 || muchWasUnreadable(reading);

const betterReading = (first: ImageReading, second: ImageReading) => {
  const firstLegible = legibleWords(first).length;
  const secondLegible = legibleWords(second).length;

  if (firstLegible !== secondLegible) {
    return secondLegible > firstLegible ? second : first;
  }

  return second.confidence > first.confidence ? second : first;
};

export { betterReading, binarizeForOcr, binarizePixels, OCR_LUMINANCE_THRESHOLD, shouldRetryOcr };
