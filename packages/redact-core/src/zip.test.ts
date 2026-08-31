import type { Unzipped } from "fflate";
import { unzip } from "fflate";
import { describe, expect, it } from "vitest";

import { buildZip, uniqueFilename } from "./zip";

const entryNames = async (archive: Blob) => {
  const bytes = new Uint8Array(await archive.arrayBuffer());

  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });

  return Object.keys(entries);
};

describe("uniqueFilename", () => {
  it("returns the name unchanged when it is free", () => {
    expect(uniqueFilename("report.pdf", new Set())).toBe("report.pdf");
  });

  it("appends a numbered suffix before the extension on collision", () => {
    expect(uniqueFilename("report.pdf", new Set(["report.pdf"]))).toBe("report (2).pdf");
  });

  it("keeps counting past the first collision", () => {
    expect(uniqueFilename("report.pdf", new Set(["report.pdf", "report (2).pdf"]))).toBe(
      "report (3).pdf",
    );
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(uniqueFilename(".env", new Set([".env"]))).toBe(".env (2)");
  });

  it("does not mutate the taken set", () => {
    const taken = new Set(["report.pdf"]);

    uniqueFilename("report.pdf", taken);

    expect(taken).toEqual(new Set(["report.pdf"]));
  });
});

describe("buildZip", () => {
  it("writes one entry per file", async () => {
    const zip = await buildZip([
      { blob: new Blob(["one"]), name: "a.txt" },
      { blob: new Blob(["two"]), name: "b.txt" },
    ]);

    await expect(entryNames(zip)).resolves.toEqual(["a.txt", "b.txt"]);
  });

  it("renames a duplicate name rather than overwriting the first entry", async () => {
    const zip = await buildZip([
      { blob: new Blob(["one"]), name: "a.txt" },
      { blob: new Blob(["two"]), name: "a.txt" },
    ]);

    await expect(entryNames(zip)).resolves.toEqual(["a.txt", "a (2).txt"]);
  });

  it("rejects an empty input array rather than producing an empty zip", async () => {
    await expect(buildZip([])).rejects.toThrow(/no files/v);
  });
});
