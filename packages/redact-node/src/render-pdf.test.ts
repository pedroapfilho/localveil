import type { Detect } from "@repo/redact-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the recogniser is stood down. pdf.js, skia and the canvas shim all run for
// real, because the bug this file exists for was a real render throwing on a real
// page, and a faked canvas would have sailed straight past it.
const recognised: Array<Uint8Array> = [];

vi.mock("@repo/ocr", () => ({
  detectLanguage: () => ({ confidence: 0.9, language: "en" }),
  droppedAnyWords: () => false,
  legibleWords: () => [],
  readImageText: (image: Iterable<number>) => {
    recognised.push(new Uint8Array(image));

    return Promise.resolve({ confidence: 90, language: "en", words: [] });
  },
}));

const { redactPath } = await import("./redact-path.ts");

const IDENTITY_CARD = new URL("../fixtures/identity-card.pdf", import.meta.url).pathname;
const PLAIN = new URL("../../../fixtures/sample.pdf", import.meta.url).pathname;

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71]);

const nothing: Detect = () => Promise.resolve([]);

const run = (path: string) => redactPath(path, nothing, () => undefined);

beforeEach(() => {
  recognised.length = 0;
});

describe("rendering a PDF through the node canvas", () => {
  // identity-card.pdf is invented, built with pdf-lib, and carries two PNGs drawn at a
  // fifth of their natural size. That last part is the whole point: pdf.js reaches for
  // its CanvasFactory only when an image has to shrink by more than half, and skia
  // refused the surface it got back. sample.pdf paints no images at all, which is why
  // the first round of this package looked fine.
  it("rebuilds a PDF that paints images", async () => {
    const { bytes } = await run(IDENTITY_CARD);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("rebuilds a PDF that paints none", async () => {
    const { bytes } = await run(PLAIN);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  // tesseract's node loader reads nothing but bytes, and a page it cannot decode comes
  // back as an empty reading rather than an error, so nothing downstream would notice.
  it("hands the recogniser a page it can actually decode", async () => {
    await run(IDENTITY_CARD);

    expect(recognised.length).toBeGreaterThan(0);
    expect(recognised[0].slice(0, 4)).toEqual(PNG_MAGIC);
    expect(recognised[0].length).toBeGreaterThan(1000);
  });
});
