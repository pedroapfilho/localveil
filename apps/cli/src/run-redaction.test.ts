/* oxlint-disable anti-slop/no-module-mocking -- @repo/pii-detect and workerpool wrap the model runtime and worker threads; the module seam is the only practical hermetic substitute */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelLoadEvent } from "@repo/pii-detect/models";
import type { FileStageKey, ProgressEvent } from "@repo/redact-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runRedaction } from "./run-redaction";

const { createDetector, redactFile } = vi.hoisted(() => ({
  createDetector: vi.fn(),
  redactFile: vi.fn(),
}));

vi.mock("@repo/pii-detect", () => ({ createDetector }));

vi.mock("workerpool", () => ({
  default: {
    pool: () => ({
      exec: (
        _method: string,
        [path]: [string],
        options: { on: (payload: ProgressEvent) => void },
      ) =>
        redactFile(path, (fraction: number, stage: FileStageKey) => {
          options.on({ fraction, stage, type: "progress" });
        }),
      terminate: () => Promise.resolve(),
    }),
  },
}));

const REDACTED = new TextEncoder().encode("[redacted]");

const makeWorkspace = async () => {
  const directory = await mkdtemp(join(tmpdir(), "localveil-run-"));
  const first = join(directory, "one.txt");
  const second = join(directory, "two.txt");

  await writeFile(first, "Ada Lovelace");
  await writeFile(second, "Alan Turing");

  return { directory, first, second };
};

const runOptions = (directory: string, files: Array<string>, signal: AbortSignal) => ({
  files,
  onFileProgress: vi.fn(),
  onModelLoad: vi.fn(),
  outputDirectory: directory,
  signal,
});

beforeEach(() => {
  createDetector.mockReset();
  redactFile.mockReset();
  createDetector.mockResolvedValue(() => Promise.resolve([]));
  redactFile.mockResolvedValue({ bytes: REDACTED, redactionCount: 2, warnings: [] });
});

describe("runRedaction", () => {
  it("keeps both completed runs when they publish into the same directory", async () => {
    const { directory, first, second } = await makeWorkspace();
    const signal = new AbortController().signal;
    const results = await Promise.all([
      runRedaction(runOptions(directory, [first], signal)),
      runRedaction(runOptions(directory, [second], signal)),
    ]);
    const paths = results.map((result) => result.zipPath);

    expect(new Set(paths).size).toBe(2);

    for (const [at, path] of paths.entries()) {
      expect(path).not.toBeNull();
      const archive = await readFile(path ?? "");

      expect(archive.subarray(0, 2)).toStrictEqual(Buffer.from("PK"));
      expect(archive.includes(Buffer.from(at === 0 ? "one.txt" : "two.txt"))).toBe(true);
    }

    const left = await readdir(directory);

    expect(left.filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  it("writes one archive holding every file it redacted", async () => {
    const { directory, first, second } = await makeWorkspace();
    const options = runOptions(directory, [first, second], new AbortController().signal);

    const result = await runRedaction(options);

    expect(result.zipPath).toBe(join(directory, "localveil.zip"));
    expect(result.fileCount).toBe(2);

    const archive = await readFile(join(directory, "localveil.zip"));

    expect(archive.subarray(0, 2)).toStrictEqual(Buffer.from("PK"));
  });

  it("adds up the redactions across every file it handled", async () => {
    const { directory, first, second } = await makeWorkspace();
    const options = runOptions(directory, [first, second], new AbortController().signal);

    const result = await runRedaction(options);

    expect(result.redactionCount).toBe(4);
  });

  it("passes the model load along so the caller can show it", async () => {
    const { directory, first } = await makeWorkspace();
    const options = runOptions(directory, [first], new AbortController().signal);

    createDetector.mockImplementation(({ onLoad }: { onLoad: (event: ModelLoadEvent) => void }) => {
      onLoad({ downloaded: 0.25, kind: "loading" });

      return Promise.resolve(() => []);
    });

    await runRedaction(options);

    expect(options.onModelLoad).toHaveBeenCalledWith({ downloaded: 0.25, kind: "loading" });
  });

  it("hands the model load the run's signal, so a stop ends the download", async () => {
    const { directory, first } = await makeWorkspace();
    const controller = new AbortController();

    await runRedaction(runOptions(directory, [first], controller.signal));

    expect(createDetector).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("returns cancelled when a stop makes the model load reject", async () => {
    const { directory, first, second } = await makeWorkspace();
    const controller = new AbortController();
    const options = runOptions(directory, [first, second], controller.signal);

    createDetector.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The model load was stopped", "AbortError"));
          });
        }),
    );

    const running = runRedaction(options);

    controller.abort();

    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(redactFile).not.toHaveBeenCalled();
  });

  it("fails the run when the model cannot load", async () => {
    const { directory, first } = await makeWorkspace();
    const options = runOptions(directory, [first], new AbortController().signal);

    createDetector.mockRejectedValue(new Error("network down"));

    await expect(runRedaction(options)).rejects.toThrow("network down");
    expect(redactFile).not.toHaveBeenCalled();
  });

  it("reports which file each stage belongs to while it works", async () => {
    const { directory, first, second } = await makeWorkspace();
    const options = runOptions(directory, [first, second], new AbortController().signal);

    redactFile.mockImplementation(
      (_path: string, onProgress: (fraction: number, stage: string) => void) => {
        onProgress(0.5, "stage.detecting");

        return Promise.resolve({ bytes: REDACTED, redactionCount: 1, warnings: [] });
      },
    );

    await runRedaction(options);

    expect(options.onFileProgress).toHaveBeenCalledWith({
      fraction: 0.5,
      index: 1,
      stage: "stage.detecting",
    });
  });

  it("redacts the rest of the run when one file throws and lists what failed", async () => {
    const { directory, first, second } = await makeWorkspace();
    const options = runOptions(directory, [first, second], new AbortController().signal);

    redactFile.mockImplementation((path: string) => {
      if (path === first) {
        return Promise.reject(new Error("The page tree could not be read"));
      }

      return Promise.resolve({ bytes: REDACTED, redactionCount: 3, warnings: [] });
    });

    const result = await runRedaction(options);

    expect(result.failures).toStrictEqual([
      { name: "one.txt", reason: "The page tree could not be read" },
    ]);

    expect(result.fileCount).toBe(1);
    expect(result.redactionCount).toBe(3);
    expect(result.zipPath).not.toBeNull();
  });

  it("keeps the warnings a file came back with next to its name", async () => {
    const { directory, first } = await makeWorkspace();
    const options = runOptions(directory, [first], new AbortController().signal);

    redactFile.mockResolvedValue({
      bytes: REDACTED,
      redactionCount: 0,
      warnings: ["warning.lowConfidence"],
    });

    const result = await runRedaction(options);

    expect(result.warnings).toStrictEqual([{ keys: ["warning.lowConfidence"], name: "one.txt" }]);
  });

  it("leaves no archive behind when the run is stopped part way", async () => {
    const { directory, first, second } = await makeWorkspace();
    const controller = new AbortController();
    const options = runOptions(directory, [first, second], controller.signal);

    redactFile.mockImplementation(() => {
      controller.abort();

      return Promise.resolve({ bytes: REDACTED, redactionCount: 2, warnings: [] });
    });

    const result = await runRedaction(options);

    expect(result.cancelled).toBe(true);
    expect(result.zipPath).toBeNull();

    const left = await readdir(directory);

    expect(left.filter((name) => name.startsWith("localveil"))).toStrictEqual([]);
  });

  it("stops during the model load at once, without waiting for the load", async () => {
    const { directory, first, second } = await makeWorkspace();
    const controller = new AbortController();
    const options = runOptions(directory, [first, second], controller.signal);

    createDetector.mockReturnValue(new Promise(() => {}));

    const running = runRedaction(options);

    controller.abort();

    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(result.zipPath).toBeNull();
    expect(redactFile).not.toHaveBeenCalled();
    expect(await readdir(directory)).toStrictEqual(["one.txt", "two.txt"]);
  });

  it("redacts nothing when the load finishes in the same moment the run is stopped", async () => {
    const { directory, first, second } = await makeWorkspace();
    const controller = new AbortController();
    const options = runOptions(directory, [first, second], controller.signal);

    createDetector.mockReturnValue(
      new Promise((resolve) => {
        controller.signal.addEventListener("abort", () => {
          resolve(() => Promise.resolve([]));
        });
      }),
    );

    const running = runRedaction(options);

    controller.abort();

    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(redactFile).not.toHaveBeenCalled();
    expect(await readdir(directory)).toStrictEqual(["one.txt", "two.txt"]);
  });

  it("writes nothing at all when every file failed", async () => {
    const { directory, first } = await makeWorkspace();
    const options = runOptions(directory, [first], new AbortController().signal);

    redactFile.mockRejectedValue(new Error("Unsupported file"));

    const result = await runRedaction(options);

    expect(result.zipPath).toBeNull();
    expect(result.fileCount).toBe(0);
    expect(await readdir(directory)).toStrictEqual(["one.txt", "two.txt"]);
  });

  it("picks a fresh name rather than writing over an archive already there", async () => {
    const { directory, first } = await makeWorkspace();

    await writeFile(join(directory, "localveil.zip"), "older run");

    const options = runOptions(directory, [first], new AbortController().signal);

    const result = await runRedaction(options);

    expect(result.zipPath).toBe(join(directory, "localveil (2).zip"));
  });
});
