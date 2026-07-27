import { describe, expect, it } from "vitest";

import { createRedactorRegistry } from "./registry.ts";
import type { Redactor } from "./types.ts";
import { UnsupportedFileError } from "./unsupported-file-error.ts";

const stub = (accepts: (file: File) => boolean): Redactor => ({
  accepts,
  redact: () => Promise.resolve({ blob: new Blob(), redactionCount: 0, warnings: [] }),
});

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("createRedactorRegistry", () => {
  it("resolves the redactor whose accepts returns true", () => {
    const target = stub((f) => f.type === "text/plain");
    const registry = createRedactorRegistry([stub(() => false), target]);

    expect(registry.resolve(file("a.txt", "text/plain"))).toBe(target);
  });

  it("resolves the first matching redactor when several accept the file", () => {
    const first = stub(() => true);
    const second = stub(() => true);
    const registry = createRedactorRegistry([first, second]);

    expect(registry.resolve(file("a.txt", "text/plain"))).toBe(first);
  });

  it("throws UnsupportedFileError naming the file when nothing accepts it", () => {
    const registry = createRedactorRegistry([stub(() => false)]);

    expect(() => registry.resolve(file("archive.zip", "application/zip"))).toThrow(
      UnsupportedFileError,
    );
    expect(() => registry.resolve(file("archive.zip", "application/zip"))).toThrow(/archive\.zip/v);
  });
});
