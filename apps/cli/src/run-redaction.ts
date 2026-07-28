import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { buildZip, toArrayBuffer, uniqueFilename } from "@repo/redact-core";
import type { ZipEntry } from "@repo/redact-core";
import { createNodeRedactor } from "@repo/redact-node";

import { reasonFrom } from "./errors";

const ZIP_NAME = "localveil.zip";

type FileFailure = {
  name: string;
  reason: string;
};

type FileWarnings = {
  keys: Array<string>;
  name: string;
};

type RunProgress = {
  fraction: number;
  index: number;
  stage: string;
};

type RunResult = {
  cancelled: boolean;
  failures: Array<FileFailure>;
  fileCount: number;
  redactionCount: number;
  warnings: Array<FileWarnings>;
  zipPath: string | null;
};

type RunOptions = {
  files: ReadonlyArray<string>;
  onFileProgress: (progress: RunProgress) => void;
  onModelProgress: (fraction: number) => void;
  outputDirectory: string;
  signal: AbortSignal;
};

const availableName = async (directory: string): Promise<string> => {
  const taken = new Set(await readdir(directory));

  return uniqueFilename(ZIP_NAME, taken);
};

// The archive lands under a temporary name and is renamed into place, so a Ctrl+C
// halfway through the write leaves nothing that looks like a finished result. The
// rename itself is atomic within a directory, which is why both names live there.
const writeArchive = async (
  blob: Blob,
  directory: string,
  signal: AbortSignal,
): Promise<string> => {
  const target = join(directory, await availableName(directory));
  const temporary = `${target}.${process.pid}.part`;
  const bytes = new Uint8Array(await blob.arrayBuffer());

  try {
    await writeFile(temporary, bytes, { signal });
    signal.throwIfAborted();
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  return target;
};

const runRedaction = async ({
  files,
  onFileProgress,
  onModelProgress,
  outputDirectory,
  signal,
}: RunOptions): Promise<RunResult> => {
  const redactor = await createNodeRedactor({ onModelProgress });

  const entries: Array<ZipEntry> = [];
  const failures: Array<FileFailure> = [];
  const warnings: Array<FileWarnings> = [];
  const counts: Array<number> = [];

  for (const [index, file] of files.entries()) {
    if (signal.aborted) {
      break;
    }

    const name = basename(file);

    try {
      // Deliberately one at a time: the detection model is a single resident copy and
      // running files through it in parallel only trades throughput for memory.
      // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
      const result = await redactor.redactFile(file, (fraction, stage) => {
        onFileProgress({ fraction, index, stage });
      });

      entries.push({ blob: new Blob([toArrayBuffer(result.bytes)]), name });
      counts.push(result.redactionCount);

      if (result.warnings.length > 0) {
        warnings.push({ keys: result.warnings, name });
      }
    } catch (error) {
      failures.push({ name, reason: reasonFrom(error) });
    }
  }

  const redactionCount = counts.reduce((total, value) => total + value, 0);
  const cancelled = signal.aborted;

  if (cancelled || entries.length === 0) {
    return {
      cancelled,
      failures,
      fileCount: entries.length,
      redactionCount,
      warnings,
      zipPath: null,
    };
  }

  const zipPath = await writeArchive(await buildZip(entries), outputDirectory, signal);

  return {
    cancelled: false,
    failures,
    fileCount: entries.length,
    redactionCount,
    warnings,
    zipPath,
  };
};

export { runRedaction };
export type { RunResult };
