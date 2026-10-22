import type { ReadText, TextReading } from "@repo/ocr";
import type { Detect, FileProgress, WordInput } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImageRedactor } from "./index";

const bitmap = { close: vi.fn(), height: 1, width: 2 };

class CanvasStub {
  static contextless = false;

  static made: Array<CanvasStub> = [];

  readonly context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "" };

  constructor(
    public width: number,
    public height: number,
  ) {
    CanvasStub.made.push(this);
  }

  convertToBlob({ type }: { type: string }) {
    return Promise.resolve(new Blob(["redacted"], { type }));
  }

  getContext() {
    return CanvasStub.contextless ? null : this.context;
  }
}

const placed = (...texts: Array<string>): Array<WordInput> =>
  texts.map((text, index) => ({
    bbox: { x0: index * 12, x1: index * 12 + 10, y0: 0, y1: 10 },
    text,
  }));

/* A fixed-words reader: it hands back the same reading whatever image it is given. */
const reads = (words: Array<WordInput>, rest: Partial<TextReading> = {}) =>
  vi.fn<ReadText>(() =>
    Promise.resolve({ alternatives: [], language: "en", legibility: "legible", words, ...rest }),
  );

const naming =
  (target: string): Detect =>
  (text) => {
    const spans = [];

    for (let start = text.indexOf(target); start !== -1; start = text.indexOf(target, start + 1)) {
      spans.push({
        end: start + target.length,
        label: "private_person" as const,
        score: 0.9,
        start,
      });
    }

    return Promise.resolve(spans);
  };

const nothing: Detect = () => Promise.resolve([]);

const onProgress: FileProgress = () => undefined;

const file = (type = "image/jpeg") => new File(["image"], "identity.jpg", { type });

const redact = (read: ReadText, detect = nothing, input = file()) =>
  redactFile({ detect, file: input, onProgress, redactor: createImageRedactor(read) });

const painter = () => CanvasStub.made.at(-1)?.context.fillRect;

beforeEach(() => {
  CanvasStub.contextless = false;
  CanvasStub.made = [];
  bitmap.close.mockClear();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve(bitmap)),
  );
  vi.stubGlobal("OffscreenCanvas", CanvasStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imageRedactor", () => {
  it("hands the reader the decoded image at its own size", async () => {
    const read = reads(placed("Alice"));

    await redact(read);

    expect(read.mock.calls[0]?.[0]).toMatchObject({ height: 1, width: 2 });
    expect(CanvasStub.made[0]?.context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it("says nothing about an image that read cleanly", async () => {
    const { warnings } = await redact(reads(placed("Alice")));

    expect(warnings).toEqual([]);
  });

  it("warns that there was no text when the reader found none", async () => {
    const { warnings } = await redact(reads([], { legibility: "blank" }));

    expect(warnings).toEqual(["warning.noText"]);
  });

  it("warns when the reader could not make most of the image out", async () => {
    const { warnings } = await redact(reads(placed("CPF"), { legibility: "unreadable" }));

    expect(warnings).toEqual(["warning.lowConfidence"]);
  });

  it("paints over a value only a reading the reader passed over could see", async () => {
    const read = reads(placed("NOME", "JOSE", "SILVA"), {
      alternatives: [placed("CPF", "108.467.036-45")],
    });

    const { redactionCount } = await redact(read, naming("108.467.036-45"));

    expect(painter()).toHaveBeenCalledWith(12, 0, 10, 10);
    expect(painter()).not.toHaveBeenCalledWith(0, 0, 10, 10);
    expect(redactionCount).toBe(1);
  });

  it("warns when the detector still finds personal data in what stayed visible", async () => {
    const answers = [[], [{ end: 5, label: "private_person" as const, score: 0.9, start: 0 }]];

    const { warnings } = await redact(reads(placed("Alice")), () =>
      Promise.resolve(answers.shift() ?? []),
    );

    expect(warnings).toEqual(["warning.notFullyRedacted"]);
  });

  it("checks only the words left showing", async () => {
    const detect = vi.fn(naming("Alice"));

    const { warnings } = await redact(reads(placed("Alice", "Smith")), detect);

    expect(detect).toHaveBeenLastCalledWith("Smith");
    expect(warnings).toEqual([]);
  });

  it("paints nothing once its one detection is dismissed", async () => {
    const redactor = createImageRedactor(reads(placed("Alice")));
    const analysis = await redactor.analyse(file(), naming("Alice"), onProgress);

    const result = await redactor.apply({
      analysis,
      decisions: { covered: [] },
      detect: nothing,
      file: file(),
      onProgress,
    });

    expect(painter()).not.toHaveBeenCalled();
    expect(result.redactionCount).toBe(0);
  });

  it("keeps a type the encoder takes and falls back to PNG for one it does not", async () => {
    const read = reads(placed("Alice"));

    const webp = await redact(read, nothing, file("image/webp"));
    const gif = await redact(read, nothing, file("image/gif"));

    expect(webp.blob.type).toBe("image/webp");
    expect(gif.blob.type).toBe("image/png");
  });

  it("closes the bitmap when painting throws", async () => {
    const redactor = createImageRedactor(reads(placed("Ana")));
    const analysis = await redactor.analyse(file(), nothing, onProgress);

    bitmap.close.mockClear();
    CanvasStub.contextless = true;

    await expect(
      redactor.apply({
        analysis,
        decisions: { covered: [] },
        detect: nothing,
        file: file(),
        onProgress,
      }),
    ).rejects.toThrow(/no 2d canvas/v);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("refuses a handle whose readings carry no words", async () => {
    const redactor = createImageRedactor(reads(placed("Ana")));
    const analysis = await redactor.analyse(file(), nothing, onProgress);

    await expect(
      redactor.apply({
        analysis: { ...analysis, handle: { readings: [{ marks: [], text: "Ana" }] } },
        decisions: { covered: [] },
        detect: nothing,
        file: file(),
        onProgress,
      }),
    ).rejects.toThrow(/no recognised readings/v);
  });
});
