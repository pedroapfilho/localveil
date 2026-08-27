/* oxlint-disable anti-slop/no-module-mocking -- @repo/ocr wraps a wasm OCR engine; the module seam is the only practical hermetic substitute */
import type * as Ocr from "@repo/ocr";
import type { Detect } from "@repo/redact-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recognised: Array<Uint8Array> = [];

vi.mock("@repo/ocr", async (importOriginal) => ({
  ...(await importOriginal<typeof Ocr>()),
  detectLanguage: () => ({ confidence: 0.9, language: "en" }),
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
  it("rebuilds a PDF that paints images", async () => {
    const { bytes } = await run(IDENTITY_CARD);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("rebuilds a PDF that paints none", async () => {
    const { bytes } = await run(PLAIN);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("hands the recogniser a page it can actually decode", async () => {
    await run(IDENTITY_CARD);

    expect(recognised.length).toBeGreaterThan(0);
    expect(recognised[0].slice(0, 4)).toEqual(PNG_MAGIC);
    expect(recognised[0].length).toBeGreaterThan(1000);
  });
});
