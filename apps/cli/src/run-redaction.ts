import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel } from "node:worker_threads";

import {
  buildZip,
  describeError,
  serveDetect,
  toArrayBuffer,
  uniqueFilename,
} from "@repo/redact-core";
import type { ZipEntry } from "@repo/redact-core";
import type { DocumentLanguage, NodeRedactionOutput } from "@repo/redact-node";
import { createNodeDetector } from "@repo/redact-node";
import workerpool from "workerpool";

const ZIP_NAME = "localveil.zip";

// onnxruntime-node already spreads one inference across every core, so threads doing
// OCR here are competing with the model rather than filling idle time. Half the cores
// leaves it room; the cap is the same memory argument as the browser's.
const MAX_JOBS = 4;

const defaultJobs = () => {
  const half = Math.floor(cpus().length / 2);

  return Math.max(1, Math.min(half, MAX_JOBS));
};

const workerUrl = new URL("file-worker.ts", import.meta.url);
const WORKER_SCRIPT = fileURLToPath(workerUrl);

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
  jobs?: number;
  language?: DocumentLanguage;
  onFileProgress: (progress: RunProgress) => void;
  onModelProgress: (fraction: number) => void;
  outputDirectory: string;
  signal: AbortSignal;
};

const isProgress = (payload: unknown): payload is { fraction: number; stage: string } =>
  typeof payload === "object" && payload !== null && "fraction" in payload && "stage" in payload;

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
  jobs,
  language,
  onFileProgress,
  onModelProgress,
  outputDirectory,
  signal,
}: RunOptions): Promise<RunResult> => {
  // The weights are one resident copy on this thread. Every worker reaches them over a
  // port rather than loading its own, which is what makes running files side by side
  // affordable at all.
  const detect = await createNodeDetector({ onModelProgress });

  const pool = workerpool.pool(WORKER_SCRIPT, {
    maxWorkers: jobs ?? defaultJobs(),
    minWorkers: "max",
    // Fires for a respawned thread too, so a replacement never comes back portless.
    onCreateWorker: () => {
      const channel = new MessageChannel();

      serveDetect(channel.port1, detect);

      return {
        workerThreadOpts: { transferList: [channel.port2], workerData: { port: channel.port2 } },
      };
    },
    workerType: "thread",
  });

  const entries: Array<ZipEntry> = [];
  const failures: Array<FileFailure> = [];
  const warnings: Array<FileWarnings> = [];
  const counts: Array<number> = [];

  // Between files the old loop checked `signal.aborted`, which could not interrupt one
  // already running. Terminating the pool reaches into the file itself.
  const stop = () => {
    void pool.terminate(true);
  };

  signal.addEventListener("abort", stop, { once: true });

  const redactOne = (file: string, index: number) =>
    pool.exec<(path: string, forced: DocumentLanguage | undefined) => NodeRedactionOutput>(
      "redact",
      [file, language],
      {
        on: (payload: unknown) => {
          if (isProgress(payload)) {
            onFileProgress({ fraction: payload.fraction, index, stage: payload.stage });
          }
        },
      },
    );

  const settled = await Promise.allSettled(files.map(redactOne));

  signal.removeEventListener("abort", stop);

  if (!signal.aborted) {
    await pool.terminate();
  }

  for (const [index, outcome] of settled.entries()) {
    const name = basename(files[index]);

    if (outcome.status === "rejected") {
      // An aborted run has no failures to report, only a cancellation.
      if (!signal.aborted) {
        failures.push({ name, reason: describeError(outcome.reason) });
      }

      continue;
    }

    entries.push({ blob: new Blob([toArrayBuffer(outcome.value.bytes)]), name });
    counts.push(outcome.value.redactionCount);

    if (outcome.value.warnings.length > 0) {
      warnings.push({ keys: outcome.value.warnings, name });
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
