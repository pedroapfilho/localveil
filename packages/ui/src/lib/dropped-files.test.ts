import { afterEach, describe, expect, it, vi } from "vitest";

import { droppedFiles, MOST_FILES, pickedDirectoryFiles, selectedFiles } from "./dropped-files";

type TestEntry = {
  createReader?: () => {
    readEntries: (onEntries: (entries: Array<TestEntry>) => void) => void;
  };
  file: (onFile: (file: File) => void) => void;
  fullPath?: string;
  isDirectory: boolean;
  isFile: boolean;
  name: string;
};

const textFile = (name: string) => new File([name], name, { type: "text/plain" });

const fileEntry = (name: string, path?: string): TestEntry => ({
  file: (done) => {
    done(textFile(name));
  },
  fullPath: path,
  isDirectory: false,
  isFile: true,
  name,
});

const directoryEntry = (name: string, pages: Array<Array<TestEntry>>): TestEntry => {
  let page = 0;

  return {
    createReader: () => ({
      readEntries: (done) => {
        done(pages[page] ?? []);
        page += 1;
      },
    }),
    file: () => undefined,
    isDirectory: true,
    isFile: false,
    name,
  };
};

const transferOf = (entries: Array<TestEntry>, files: Array<File> = []) =>
  ({
    files,
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
    })),
  }) as unknown as DataTransfer;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectedFiles", () => {
  it("keeps the path supplied by a directory input", () => {
    const file = textFile("invoice.txt");

    Object.defineProperty(file, "webkitRelativePath", { value: "records/2026/invoice.txt" });

    expect(selectedFiles([file])).toEqual({
      files: [{ file, path: "records/2026/invoice.txt" }],
      limited: false,
    });
  });

  it("caps a folder before it can fill the browser with jobs", () => {
    const files = Array.from({ length: MOST_FILES + 1 }, (_, index) => textFile(`${index}.txt`));
    const result = selectedFiles(files);

    expect(result.files).toHaveLength(MOST_FILES);
    expect(result.limited).toBe(true);
  });
});

describe("droppedFiles", () => {
  it("keeps flat file drops working in browsers without directory entries", async () => {
    const file = textFile("notes.txt");

    await expect(droppedFiles(transferOf([], [file]))).resolves.toEqual({
      files: [{ file, path: "notes.txt" }],
      limited: false,
    });
  });

  it("walks nested directories and reads every directory page", async () => {
    const nested = directoryEntry("2026", [[fileEntry("a.txt")], [fileEntry("b.txt")], []]);
    const root = directoryEntry("records", [[nested], []]);

    const result = await droppedFiles(transferOf([root]));

    expect(result.files.map(({ path }) => path)).toEqual([
      "records/2026/a.txt",
      "records/2026/b.txt",
    ]);
  });

  it("uses a dropped entry's full path when the File object does not carry one", async () => {
    const result = await droppedFiles(transferOf([fileEntry("scan.pdf", "/cases/one/scan.pdf")]));

    expect(result.files[0]?.path).toBe("cases/one/scan.pdf");
  });
});

describe("pickedDirectoryFiles", () => {
  it("returns undefined when the browser needs the directory-input fallback", async () => {
    vi.stubGlobal("showDirectoryPicker", undefined);

    await expect(pickedDirectoryFiles()).resolves.toBeUndefined();
  });

  it("walks a directory handle and retains its path", async () => {
    const file = textFile("report.txt");
    const fileHandle = {
      getFile: () => Promise.resolve(file),
      kind: "file",
      name: "report.txt",
    } as unknown as FileSystemFileHandle;
    const nested = {
      kind: "directory",
      name: "august",
      async *values() {
        yield await Promise.resolve(fileHandle);
      },
    } as unknown as FileSystemDirectoryHandle;
    const root = {
      kind: "directory",
      name: "records",
      async *values() {
        yield await Promise.resolve(nested);
      },
    } as unknown as FileSystemDirectoryHandle;

    vi.stubGlobal("showDirectoryPicker", () => Promise.resolve(root));

    await expect(pickedDirectoryFiles()).resolves.toEqual({
      files: [{ file, path: "records/august/report.txt" }],
      limited: false,
    });
  });
});
