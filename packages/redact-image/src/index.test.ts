import type * as OcrModule from "@repo/ocr";
import type { ImageReading } from "@repo/ocr";
import type { Detect, FileProgress } from "@repo/redact-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readImageText: vi.fn() }));

vi.mock("@repo/ocr", async (importOriginal) => ({
  ...(await importOriginal<typeof OcrModule>()),
  readImageText: mocks.readImageText,
}));

import { imageRedactor } from "./index.ts";

const bitmap = { close: vi.fn(), height: 1, width: 2 };
const contexts: Array<{
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
}> = [];

class CanvasStub {
  height: number;
  width: number;

  private readonly context;

  constructor(width: number, height: number) {
    this.height = height;
    this.width = width;
    this.context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(width * height * 4).fill(255),
      })),
      putImageData: vi.fn(),
    };
    contexts.push(this.context);
  }

  convertToBlob({ type }: { type: string }) {
    return Promise.resolve(new Blob(["redacted"], { type }));
  }

  getContext() {
    return this.context;
  }
}

const BOX = { x0: 0, x1: 10, y0: 0, y1: 10 };

const reading = (
  language: ImageReading["language"],
  confidence: number,
  words: Array<[text: string, confidence: number]>,
): ImageReading => ({
  confidence,
  language,
  words: words.map(([text, wordConfidence], index) => ({
    bbox: { ...BOX, x0: index * 12, x1: index * 12 + 10 },
    confidence: wordConfidence,
    text,
  })),
});

const file = () => new File(["image"], "identity.jpg", { type: "image/jpeg" });

const noSpans: Detect = () => Promise.resolve([]);
const onProgress: FileProgress = () => undefined;

const redact = (detect: Detect = noSpans) => imageRedactor.redact(file(), detect, onProgress);

beforeEach(() => {
  contexts.length = 0;
  bitmap.close.mockClear();
  mocks.readImageText.mockReset();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve(bitmap)),
  );
  vi.stubGlobal("OffscreenCanvas", CanvasStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image OCR retry", () => {
  it("does not prepare or reread a legible image", async () => {
    mocks.readImageText.mockResolvedValue(reading("en", 90, [["Alice", 95]]));

    const detect = vi.fn<Detect>(() => Promise.resolve([]));

    await redact(detect);

    expect(mocks.readImageText).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith("Alice");
    expect(contexts).toHaveLength(1);
  });

  it("retries an empty result and paints the original bitmap", async () => {
    mocks.readImageText.mockResolvedValueOnce(reading("en", 0, [])).mockResolvedValueOnce(
      reading("en", 70, [
        ["Maria", 92],
        ["Silva", 88],
      ]),
    );

    const detect = vi.fn<Detect>(() => Promise.resolve([]));

    await redact(detect);

    expect(mocks.readImageText).toHaveBeenCalledTimes(2);
    expect(mocks.readImageText.mock.calls[1]?.[1]).toEqual({ known: "en" });
    expect(detect).toHaveBeenCalledWith("Maria Silva");
    expect(contexts).toHaveLength(2);
    expect(contexts.at(-1)?.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it("uses an improved Portuguese retry", async () => {
    mocks.readImageText
      .mockResolvedValueOnce(
        reading("pt", 30, [
          ["ruido", 10],
          ["texto", 15],
          ["Pedro", 90],
        ]),
      )
      .mockResolvedValueOnce(
        reading("pt", 70, [
          ["Pedro", 92],
          ["Afonso", 90],
          ["Pedrosa", 88],
        ]),
      );

    const detect = vi.fn<Detect>(() => Promise.resolve([]));

    await imageRedactor.redact(file(), detect, onProgress, { language: "pt" });

    expect(mocks.readImageText.mock.calls.map((call) => call[1])).toEqual([
      { known: "pt" },
      { known: "pt" },
    ]);
    expect(detect).toHaveBeenCalledWith("Pedro Afonso Pedrosa");
  });

  it("keeps the original reading when the retry recovers fewer words", async () => {
    mocks.readImageText
      .mockResolvedValueOnce(
        reading("en", 60, [
          ["Alice", 95],
          ["Smith", 92],
          ["London", 90],
          ["noise", 10],
          ["mark", 5],
        ]),
      )
      .mockResolvedValueOnce(
        reading("en", 80, [
          ["Alice", 95],
          ["noise", 10],
        ]),
      );

    const detect = vi.fn<Detect>(() => Promise.resolve([]));

    await redact(detect);

    expect(detect).toHaveBeenCalledWith("Alice Smith London");
  });
});
