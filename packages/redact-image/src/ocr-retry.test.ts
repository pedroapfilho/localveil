import type { ImageReading } from "@repo/ocr";
import { describe, expect, it, vi } from "vitest";

import {
  betterReading,
  binarizeForOcr,
  binarizePixels,
  OCR_LUMINANCE_THRESHOLD,
  shouldRetryOcr,
} from "./ocr-retry";

const BOX = { x0: 0, x1: 10, y0: 0, y1: 10 };

const reading = (confidence: number, ...wordConfidences: Array<number>): ImageReading => ({
  confidence,
  language: "en",
  words: wordConfidences.map((wordConfidence, index) => ({
    bbox: BOX,
    confidence: wordConfidence,
    text: `word${index}`,
  })),
});

describe("shouldRetryOcr", () => {
  it("does not retry a readable image", () => {
    expect(shouldRetryOcr(reading(92, 95, 88, 74))).toBe(false);
  });

  it("retries an image from which no words were found", () => {
    expect(shouldRetryOcr(reading(0))).toBe(true);
  });

  it("retries when more than a quarter of the words were unreadable", () => {
    expect(shouldRetryOcr(reading(40, 95, 92, 12, 8))).toBe(true);
  });
});

describe("betterReading", () => {
  it("prefers the reading with more legible words", () => {
    const sparse = reading(80, 95, 12, 8);
    const recovered = reading(60, 90, 88, 74);

    expect(betterReading(sparse, recovered)).toBe(recovered);
  });

  it("uses page confidence to break a legible-word tie", () => {
    const first = reading(55, 95, 12);
    const second = reading(75, 90, 8);

    expect(betterReading(first, second)).toBe(second);
  });

  it("keeps the first reading when the retry is no better", () => {
    const first = reading(75, 95, 88);
    const second = reading(75, 92, 87);

    expect(betterReading(first, second)).toBe(first);
  });
});

describe("OCR binarization", () => {
  it("turns dark pixels black and light pixels white without changing alpha", () => {
    const pixels = new Uint8ClampedArray([
      119,
      119,
      119,
      17,
      OCR_LUMINANCE_THRESHOLD,
      OCR_LUMINANCE_THRESHOLD,
      OCR_LUMINANCE_THRESHOLD,
      203,
    ]);

    binarizePixels(pixels);

    expect([...pixels]).toEqual([0, 0, 0, 17, 255, 255, 255, 203]);
  });

  it("keeps the source dimensions and writes the prepared pixels", () => {
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const pixels = new Uint8ClampedArray([20, 20, 20, 255, 240, 240, 240, 255]);
    const context = {
      drawImage,
      getImageData: vi.fn(() => ({ data: pixels })),
      putImageData,
    };

    class CanvasStub {
      height: number;
      width: number;

      constructor(width: number, height: number) {
        this.height = height;
        this.width = width;
      }

      getContext() {
        return context;
      }
    }

    vi.stubGlobal("OffscreenCanvas", CanvasStub);

    const source = { height: 1, width: 2 } as ImageBitmap;
    const prepared = binarizeForOcr(source);

    expect(prepared).toMatchObject({ height: 1, width: 2 });
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
    expect([...pixels]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(putImageData).toHaveBeenCalledWith(expect.objectContaining({ data: pixels }), 0, 0);

    vi.unstubAllGlobals();
  });
});
