import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createRedactorRegistry, UnsupportedFileError } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";
import { describe, expect, it } from "vitest";

const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

const FIXTURES = join(process.cwd(), "../../fixtures");

const bytesOf = (name: string) =>
  // oxlint-disable-next-line node/no-sync
  readFileSync(join(FIXTURES, name));

const fixture = (name: string, type: string) => new File([bytesOf(name)], name, { type });

const SAMPLES = [
  { handler: "text", name: "sample.txt", type: "text/plain" },
  { handler: "text", name: "sample.md", type: "text/markdown" },
  { handler: "text", name: "sample.csv", type: "text/csv" },
  { handler: "text", name: "sample.json", type: "application/json" },
  { handler: "text", name: "sample.log", type: "" },
  { handler: "pdf", name: "sample.pdf", type: "application/pdf" },
  { handler: "image", name: "sample.png", type: "image/png" },
] as const;

const HANDLERS = { image: imageRedactor, pdf: pdfRedactor, text: textRedactor };

describe("the registry the worker builds", () => {
  it.each(SAMPLES)("sends $name to the $handler redactor", ({ handler, name, type }) => {
    expect(registry.resolve(fixture(name, type))).toBe(HANDLERS[handler]);
  });

  it.each(SAMPLES)("resolves $name from its name alone", ({ handler, name }) => {
    expect(registry.resolve(fixture(name, ""))).toBe(HANDLERS[handler]);
  });

  it("refuses a format nothing handles", () => {
    expect(() =>
      registry.resolve(new File(["MZ"], "setup.exe", { type: "application/x-msdos" })),
    ).toThrow(UnsupportedFileError);
  });

  it("names the file it could not take", () => {
    expect(() => registry.resolve(new File([""], "clip.mp4", { type: "video/mp4" }))).toThrow(
      /clip\.mp4/v,
    );
  });
});

describe("each fixture", () => {
  it.each(SAMPLES)("$name is on disk and not empty", ({ name, type }) => {
    expect(fixture(name, type).size).toBeGreaterThan(0);
  });
});
