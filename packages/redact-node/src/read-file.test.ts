import { describe, expect, it } from "vitest";

import { readFileAsFile } from "./read-file";

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;

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
