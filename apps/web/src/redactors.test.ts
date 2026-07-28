import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createRedactorRegistry, UnsupportedFileError } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";
import { describe, expect, it } from "vitest";

// The same list the worker builds, so this is the routing the app actually does.
const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

// Resolved from the package root rather than `import.meta.url`: under Vite that is
// an `/@fs/` URL, which is not a path anything can open.
const FIXTURES = join(process.cwd(), "../../fixtures");

const bytesOf = (name: string) =>
  // Sync on purpose: a test that has to await its own fixtures reads worse than one
  // that does not, and there is no event loop to keep free here.
  // oxlint-disable-next-line node/no-sync
  readFileSync(join(FIXTURES, name));

const fixture = (name: string, type: string) => new File([bytesOf(name)], name, { type });

// One of every format the dropzone advertises, each carrying the same personal data.
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
