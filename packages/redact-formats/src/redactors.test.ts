import { readFileSync } from "node:fs";

import type { FileStageKey } from "@repo/redact-core";
import { UnsupportedFileError } from "@repo/redact-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveRedactor } from "./redactors";

import { BROWSER_ACCEPT, NODE_FORMATS } from "./index";

/* What each redactor does once it has the file in hand: text goes straight to the detector, a PDF
   is taken apart page by page, an image goes to the recogniser. */
const NEXT_STAGE = {
  image: "stage.recognising",
  pdf: "stage.extracting",
  text: "stage.detecting",
} as const satisfies Record<string, FileStageKey>;

const SAMPLES = [
  { handler: "text", name: "sample.txt", type: "text/plain" },
  { handler: "text", name: "sample.md", type: "text/markdown" },
  { handler: "text", name: "sample.csv", type: "text/csv" },
  { handler: "text", name: "sample.json", type: "application/json" },
  { handler: "text", name: "sample.log", type: "" },
  { handler: "pdf", name: "sample.pdf", type: "application/pdf" },
  { handler: "image", name: "sample.png", type: "image/png" },
] as const;

const OFFERED = BROWSER_ACCEPT.split(",");

const OFFERED_EXTENSIONS = OFFERED.filter((token) => token.startsWith("."));

const named = (name: string, type = "") => new File([], name, { type });

const fixture = (name: string, type: string) =>
  new File([readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url))], name, { type });

const STOPPED = new Error("stopped at the second stage");

/* The run stops at the second stage, before any model or recogniser is needed. */
const stagesOf = async (file: File) => {
  const stages: Array<FileStageKey> = [];

  const run = resolveRedactor(file).analyse(
    file,
    () => Promise.resolve([]),
    (_fraction, stage) => {
      stages.push(stage);

      if (stages.length === 2) {
        throw STOPPED;
      }
    },
  );

  await expect(run).rejects.toBe(STOPPED);

  return stages;
};

beforeEach(() => {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve({ close: vi.fn(), height: 1, width: 1 })),
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return { drawImage: vi.fn() };
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveRedactor", () => {
  it.each(SAMPLES)("sends $name to the $handler redactor", async ({ handler, name, type }) => {
    expect(await stagesOf(fixture(name, type))).toEqual(["stage.reading", NEXT_STAGE[handler]]);
  });

  it.each(SAMPLES)("resolves $name from its name alone", ({ name, type }) => {
    expect(resolveRedactor(named(name))).toBe(resolveRedactor(named(name, type)));
  });

  it("goes by the type when the name has no extension", () => {
    expect(resolveRedactor(named("notes", "text/x-python"))).toBe(
      resolveRedactor(named("sample.txt")),
    );
    expect(resolveRedactor(named("export", "application/json"))).toBe(
      resolveRedactor(named("sample.txt")),
    );
    expect(resolveRedactor(named("download", "application/pdf"))).toBe(
      resolveRedactor(named("sample.pdf")),
    );
    expect(resolveRedactor(named("photo", "image/heic"))).toBe(
      resolveRedactor(named("sample.png")),
    );
  });

  it("ignores the case of an extension", () => {
    expect(resolveRedactor(named("SCAN.PDF"))).toBe(resolveRedactor(named("scan.pdf")));
    expect(resolveRedactor(named("REPORT.TXT"))).toBe(resolveRedactor(named("report.txt")));
  });

  it("refuses a format nothing handles", () => {
    expect(() => resolveRedactor(named("setup.exe", "application/x-msdos"))).toThrow(
      UnsupportedFileError,
    );
  });

  it("names the file it could not take", () => {
    expect(() => resolveRedactor(named("clip.mp4", "video/mp4"))).toThrow(/clip\.mp4/v);
  });
});

describe("the lists drawn from the same declarations", () => {
  it("offers the dropzone every format a redactor declares", () => {
    expect(BROWSER_ACCEPT).toBe(
      ".csv,.json,.log,.md,.txt,text/*,application/json,.pdf,application/pdf,.avif,.bmp,.gif,.heic,.jpeg,.jpg,.png,.tif,.tiff,.webp,image/*",
    );
  });

  it.each(OFFERED)("resolves %s, which the dropzone lets through", (token) => {
    const file = token.startsWith(".")
      ? named(`sample${token}`)
      : named("sample", token.replace("/*", "/x-any"));

    expect(() => resolveRedactor(file)).not.toThrow();
  });

  it("lists for Node what the dropzone offers, less HEIC and TIFF, which Node cannot decode", () => {
    expect([...NODE_FORMATS.keys()]).toStrictEqual(
      OFFERED_EXTENSIONS.filter((extension) => ![".heic", ".tif", ".tiff"].includes(extension)),
    );
  });

  it.each([...NODE_FORMATS])("types %s as %s, which the same redactor takes", (extension, type) => {
    expect(resolveRedactor(named("sample", type))).toBe(
      resolveRedactor(named(`sample${extension}`)),
    );
  });
});

describe("each fixture", () => {
  it.each(SAMPLES)("$name is on disk and not empty", ({ name, type }) => {
    expect(fixture(name, type).size).toBeGreaterThan(0);
  });
});
