import type { ReadText } from "@repo/ocr";
import type { Detect } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
import { createPdfRedactor } from "@repo/redact-pdf";
import { beforeEach, describe, expect, it } from "vitest";

import { installCanvas } from "./canvas";
import { readFileAsFile } from "./read-file";

const IDENTITY_CARD = new URL("../fixtures/identity-card.pdf", import.meta.url).pathname;
const PLAIN = new URL("../../../fixtures/sample.pdf", import.meta.url).pathname;

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71]);

const pages: Array<OffscreenCanvas> = [];

const recordingPages: ReadText = (page) => {
  pages.push(page);

  return Promise.resolve({ alternatives: [], language: "en", legibility: "blank", words: [] });
};

const nothing: Detect = () => Promise.resolve([]);

const run = async (path: string) => {
  const { blob } = await redactFile({
    detect: nothing,
    file: await readFileAsFile(path),
    onProgress: () => undefined,
    redactor: createPdfRedactor(recordingPages),
  });

  return new Uint8Array(await blob.arrayBuffer());
};

installCanvas();

beforeEach(() => {
  pages.length = 0;
});

describe("rendering a PDF through the node canvas", () => {
  it("rebuilds a PDF that paints images", async () => {
    const bytes = await run(IDENTITY_CARD);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("rebuilds a PDF that paints none", async () => {
    const bytes = await run(PLAIN);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("hands the reader a rendered page that encodes as an image", async () => {
    await run(IDENTITY_CARD);

    const [page] = pages;

    const encoded =
      page === undefined ? new Blob() : await page.convertToBlob({ type: "image/png" });

    const bytes = new Uint8Array(await encoded.arrayBuffer());

    expect(bytes.slice(0, 4)).toEqual(PNG_MAGIC);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
