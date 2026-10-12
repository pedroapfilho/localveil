import { describe, expect, it } from "vitest";

import { readFileAsFile } from "./read-file";

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;

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
});
