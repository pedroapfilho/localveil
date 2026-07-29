import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { isSupported, parentEntry, readDirectory, resolveArguments } from "./entries";

vi.mock("@repo/redact-node", () => ({
  createNodeRedactor: vi.fn(),
  SUPPORTED_EXTENSIONS: [".txt", ".md"],
}));

const makeDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "localveil-entries-"));

  await mkdir(join(directory, "photos"));
  await writeFile(join(directory, "notes.txt"), "hello");
  await writeFile(join(directory, "capture.raw"), "hello");

  return directory;
};

describe("isSupported", () => {
  it("accepts an extension the redactor knows, whatever its case", () => {
    expect(isSupported("Report.TXT")).toBe(true);
  });

  it("turns down an extension the redactor has never heard of", () => {
    expect(isSupported("capture.raw")).toBe(false);
  });

  it("turns down a file with no extension at all", () => {
    expect(isSupported("Makefile")).toBe(false);
  });
});

describe("readDirectory", () => {
  it("puts folders above files and marks which files can be redacted", async () => {
    const directory = await makeDirectory();

    const entries = await readDirectory(directory);

    expect(entries.map((entry) => entry.name)).toStrictEqual([
      "photos",
      "capture.raw",
      "notes.txt",
    ]);

    expect(entries.map((entry) => entry.supported)).toStrictEqual([false, false, true]);
  });

  it("gives every entry the path it can be opened with", async () => {
    const directory = await makeDirectory();

    const entries = await readDirectory(directory);

    expect(entries.map((entry) => entry.path)).toContain(join(directory, "notes.txt"));
  });
});

describe("parentEntry", () => {
  it("offers a way back out of a nested folder", () => {
    expect(parentEntry("/one/two")).toStrictEqual({
      isDirectory: true,
      name: "..",
      path: "/one",
      supported: false,
    });
  });

  it("offers nothing above the root of the filesystem", () => {
    expect(parentEntry("/")).toBeNull();
  });
});

describe("resolveArguments", () => {
  it("starts in the working directory when it is given nothing", async () => {
    const directory = await makeDirectory();

    await expect(resolveArguments([], directory)).resolves.toStrictEqual({
      directory,
      selection: [],
    });
  });

  it("ticks the files it was named and opens the folder they live in", async () => {
    const directory = await makeDirectory();

    const point = await resolveArguments(["notes.txt"], directory);

    expect(point).toStrictEqual({ directory, selection: [join(directory, "notes.txt")] });
  });

  it("leaves out a named file the redactor cannot read", async () => {
    const directory = await makeDirectory();

    const point = await resolveArguments(["capture.raw"], directory);

    expect(point.selection).toStrictEqual([]);
  });

  it("ignores a path that is not there rather than refusing to start", async () => {
    const directory = await makeDirectory();

    const point = await resolveArguments(["nowhere.txt", "notes.txt"], directory);

    expect(point.selection).toStrictEqual([join(directory, "notes.txt")]);
  });

  it("reads a forced document language off the flag", async () => {
    const directory = await makeDirectory();

    const point = await resolveArguments(["--lang", "pt", "notes.txt"], directory);

    expect(point.language).toBe("pt");
    expect(point.selection).toStrictEqual([join(directory, "notes.txt")]);
  });

  it("reads the flag in its equals form", async () => {
    const directory = await makeDirectory();

    const point = await resolveArguments(["--lang=es"], directory);

    expect(point).toStrictEqual({ directory, language: "es", selection: [] });
  });

  it("refuses a language the redactor does not speak", async () => {
    const directory = await makeDirectory();

    await expect(resolveArguments(["--lang", "de"], directory)).rejects.toThrow(/en, es, pt/v);
  });

  it("refuses a dangling flag with nothing after it", async () => {
    const directory = await makeDirectory();

    await expect(resolveArguments(["notes.txt", "--lang"], directory)).rejects.toThrow(/nothing/v);
  });

  it("opens a folder it was handed instead of picking anything", async () => {
    const directory = await makeDirectory();

    const point = await resolveArguments(["photos"], directory);

    expect(point).toStrictEqual({ directory: join(directory, "photos"), selection: [] });
  });
});
