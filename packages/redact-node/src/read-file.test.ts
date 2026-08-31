import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";
import { describe, expect, it } from "vitest";

import { readFileAsFile, SUPPORTED_EXTENSIONS } from "./read-file";

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;

const REDACTORS = [imageRedactor, pdfRedactor, textRedactor];

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71]);

describe("readFileAsFile", () => {
  it("names the file after the path it was read from", async () => {
    const file = await readFileAsFile(`${FIXTURES}sample.txt`);

    expect(file.name).toBe("sample.txt");
  });

  it("types the file from its extension, since a path off a disk carries no type", async () => {
    const csv = await readFileAsFile(`${FIXTURES}sample.csv`);
    const pdf = await readFileAsFile(`${FIXTURES}sample.pdf`);

    expect(csv.type).toBe("text/csv");
    expect(pdf.type).toBe("application/pdf");
  });

  it("leaves the type empty for an extension it does not know", async () => {
    const file = await readFileAsFile(new URL(import.meta.url).pathname);

    expect(file.type).toBe("");
  });

  it("carries the bytes on disk", async () => {
    const file = await readFileAsFile(`${FIXTURES}sample.txt`);

    await expect(file.text()).resolves.toContain("John Smith");
  });

  it("spells itself out as bytes for a recogniser that reads nothing else", async () => {
    const file = await readFileAsFile(`${FIXTURES}sample.png`);
    const bytes = new Uint8Array(file);

    expect(bytes.slice(0, 4)).toEqual(PNG_MAGIC);
    expect(bytes.length).toBe(file.size);
  });
});

describe("SUPPORTED_EXTENSIONS", () => {
  it("lists every extension lowercase and dot-prefixed", () => {
    for (const extension of SUPPORTED_EXTENSIONS) {
      expect(extension).toMatch(/^\.[a-z0-9]+$/v);
    }
  });

  it("advertises nothing the redactors would turn away", () => {
    for (const extension of SUPPORTED_EXTENSIONS) {
      const file = new File([], `sample${extension}`);
      const taken = REDACTORS.filter((redactor) => redactor.accepts(file));

      expect(taken.length, `no redactor takes ${extension}`).toBe(1);
    }
  });

  it("covers the fixtures this repo redacts", () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining([".csv", ".json", ".log", ".md", ".pdf", ".png", ".txt"]),
    );
  });
});
