import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runRedaction } from "./run-redaction";

const { createNodeDetector, redactFile } = vi.hoisted(() => ({
  createNodeDetector: vi.fn(),
  redactFile: vi.fn(),
}));

vi.mock("@repo/redact-node", () => ({
  createNodeDetector,
  SUPPORTED_EXTENSIONS: [".txt", ".md"],
}));

vi.mock("workerpool", () => ({
  default: {
    pool: () => ({
      exec: (_method: string, [path]: [string], options: { on: (payload: unknown) => void }) =>
        redactFile(path, (fraction: number, stage: string) => {
          options.on({ fraction, stage });
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
  onModelProgress: vi.fn(),
  outputDirectory: directory,
  signal,
});

beforeEach(() => {
  createNodeDetector.mockReset();
  redactFile.mockReset();
  createNodeDetector.mockResolvedValue(() => Promise.resolve([]));
  redactFile.mockResolvedValue({ bytes: REDACTED, redactionCount: 2, warnings: [] });
});

describe("runRedaction", () => {
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

  it("passes the model download along so the caller can show it", async () => {
    const { directory, first } = await makeWorkspace();
    const options = runOptions(directory, [first], new AbortController().signal);

    createNodeDetector.mockImplementation(
      ({ onModelProgress }: { onModelProgress: (fraction: number) => void }) => {
        onModelProgress(0.25);

        return Promise.resolve(() => []);
      },
    );

    await runRedaction(options);

    expect(options.onModelProgress).toHaveBeenCalledWith(0.25);
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
