import { describe, expect, it } from "vitest";

import { UnsupportedFileError } from "../pipeline/unsupported-file-error";

import { readFileAsFile } from "./read-file";

const FIXTURES = new URL("../../../../fixtures/", import.meta.url).pathname;

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

  it("refuses a format Node cannot decode before reading it", async () => {
    await expect(readFileAsFile(`${FIXTURES}photo.heic`)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
    await expect(readFileAsFile(new URL(import.meta.url).pathname)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });

  it("carries the bytes on disk", async () => {
    const file = await readFileAsFile(`${FIXTURES}sample.txt`);

    await expect(file.text()).resolves.toContain("John Smith");
  });
});
