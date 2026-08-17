import type * as OcrModule from "@repo/ocr";
import type { ImageReading } from "@repo/ocr";
import type { Detect, FileProgress } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
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
  static contextless = false;

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
    return CanvasStub.contextless ? null : this.context;
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

const detectCpf: Detect = (text) => {
  const start = text.indexOf("108");

  return Promise.resolve(
    start === -1 ? [] : [{ end: start + 14, label: "account_number" as const, score: 1, start }],
  );
};
const onProgress: FileProgress = () => undefined;

const redact = (detect: Detect = noSpans) =>
  redactFile({ detect, file: file(), onProgress, redactor: imageRedactor });

beforeEach(() => {
  CanvasStub.contextless = false;
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

  it("warns when the detector still finds personal data in what stayed visible", async () => {
    mocks.readImageText.mockResolvedValue(reading("en", 90, [["Alice", 95]]));

    const answers = [[], [{ end: 5, label: "private_person" as const, score: 0.9, start: 0 }]];
    const { warnings } = await redact(() => Promise.resolve(answers.shift() ?? []));

    expect(warnings).toContain("warning.notFullyRedacted");
  });

  it("says nothing when the words left showing carry no personal data", async () => {
    mocks.readImageText.mockResolvedValue(reading("en", 90, [["Alice", 95]]));

    const { warnings } = await redact();

    expect(warnings).not.toContain("warning.notFullyRedacted");
  });

  it("redetects language when an automatic reading is retried", async () => {
    mocks.readImageText.mockResolvedValueOnce(reading("en", 0, [])).mockResolvedValueOnce(
      reading("pt", 70, [
        ["Maria", 92],
        ["Silva", 88],
      ]),
    );

    const detect = vi.fn<Detect>(() => Promise.resolve([]));

    await redact(detect);

    expect(mocks.readImageText).toHaveBeenCalledTimes(2);
    expect(mocks.readImageText.mock.calls.map((call) => call[1])).toEqual([{}, {}]);
    expect(detect.mock.calls.map(([text]) => text)).toEqual(["Maria Silva", "Maria Silva"]);
    expect(contexts).toHaveLength(2);
    expect(contexts.at(-1)?.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it("redacts PII found only by the original low-confidence reading", async () => {
    mocks.readImageText
      .mockResolvedValueOnce(
        reading("pt", 40, [
          ["CPF", 95],
          ["108.467.036-45", 92],
          ["ruido", 10],
          ["texto", 15],
        ]),
      )
      .mockResolvedValueOnce(
        reading("pt", 80, [
          ["NOME", 95],
          ["JOSE", 94],
          ["DA", 93],
          ["SILVA", 92],
          ["VALIDADE", 91],
        ]),
      );

    const detect = vi.fn<Detect>((text) =>
      Promise.resolve(
        text === "CPF 108.467.036-45"
          ? [{ end: 18, label: "account_number", score: 1, start: 4 }]
          : [],
      ),
    );

    const result = await redact(detect);

    expect(detect.mock.calls.map(([text]) => text)).toEqual([
      "CPF 108.467.036-45",
      "NOME JOSE DA SILVA VALIDADE",
      "NOME DA SILVA VALIDADE",
    ]);
    expect(contexts.at(-1)?.fillRect).toHaveBeenCalledWith(12, 0, 10, 10);
    expect(result.redactionCount).toBe(1);
  });

  it("does not count the same PII twice when both readings find it", async () => {
    const first = reading("pt", 40, [
      ["CPF", 95],
      ["108.467.036-45", 92],
      ["ruido", 10],
      ["texto", 15],
    ]);
    const retry = reading("pt", 80, [
      ["CPF", 96],
      ["10846703645", 94],
      ["NOME", 93],
      ["JOSE", 92],
      ["SILVA", 91],
    ]);

    mocks.readImageText.mockResolvedValueOnce(first).mockResolvedValueOnce(retry);

    const detect = vi.fn<Detect>((text) => {
      const start = text.indexOf("108");

      return Promise.resolve([
        { end: start + (text.includes(".") ? 14 : 11), label: "account_number", score: 1, start },
      ]);
    });

    const result = await redact(detect);

    expect(result.redactionCount).toBe(1);
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

    await redactFile({
      detect,
      file: file(),
      onProgress,
      options: { language: "pt" },
      redactor: imageRedactor,
    });

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

  it("reports one detection when both readings find the same value", async () => {
    const first = reading("pt", 40, [
      ["CPF", 95],
      ["108.467.036-45", 92],
    ]);
    const retry = reading("pt", 80, [
      ["CPF", 96],
      ["108.467.036-45", 94],
      ["NOME", 93],
    ]);

    mocks.readImageText.mockResolvedValueOnce(first).mockResolvedValueOnce(retry);

    const analysis = await imageRedactor.analyse(file(), detectCpf, onProgress);

    expect(analysis.detections).toHaveLength(1);
  });

  it("paints nothing once that single detection is dismissed", async () => {
    const first = reading("pt", 40, [
      ["CPF", 95],
      ["108.467.036-45", 92],
    ]);
    const retry = reading("pt", 80, [
      ["CPF", 96],
      ["108.467.036-45", 94],
      ["NOME", 93],
    ]);

    mocks.readImageText.mockResolvedValueOnce(first).mockResolvedValueOnce(retry);

    const analysis = await imageRedactor.analyse(file(), detectCpf, onProgress);

    contexts.length = 0;

    const result = await imageRedactor.apply({
      analysis,
      decisions: { covered: [] },
      detect: noSpans,
      file: file(),
      onProgress,
    });

    expect(contexts.at(-1)?.fillRect).not.toHaveBeenCalled();
    expect(result.redactionCount).toBe(0);
  });

  it("closes the bitmap when painting throws", async () => {
    mocks.readImageText.mockResolvedValue(reading("en", 90, [["Ana", 95]]));

    const analysis = await imageRedactor.analyse(file(), noSpans, onProgress);

    bitmap.close.mockClear();
    CanvasStub.contextless = true;

    await expect(
      imageRedactor.apply({
        analysis,
        decisions: { covered: [] },
        detect: noSpans,
        file: file(),
        onProgress,
      }),
    ).rejects.toThrow(/no 2d canvas/v);
    expect(bitmap.close).toHaveBeenCalled();
  });
});
