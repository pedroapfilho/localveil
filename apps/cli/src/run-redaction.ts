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
import type { FileStageKey, WarningKey, ZipEntry } from "@repo/redact-core";
import type { NodeRedactionOutput } from "@repo/redact-node";
import { createNodeDetector } from "@repo/redact-node";
import workerpool from "workerpool";

const ZIP_NAME = "localveil.zip";

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
  keys: Array<WarningKey>;
  name: string;
};

type RunProgress = {
  fraction: number;
  index: number;
  stage: FileStageKey;
};

type FileOutcome =
  | { blob: Blob; kind: "done"; name: string; redactionCount: number; warnings: Array<WarningKey> }
  | { kind: "failed"; name: string; reason: string };

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
  onFileProgress: (progress: RunProgress) => void;
  onModelProgress: (fraction: number) => void;
  outputDirectory: string;
  signal: AbortSignal;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool events cross the thread boundary untyped; this guard is their parser
const isProgress = (payload: unknown): payload is { fraction: number; stage: FileStageKey } =>
  typeof payload === "object" &&
  payload !== null &&
  "fraction" in payload &&
  typeof payload.fraction === "number" &&
  "stage" in payload &&
  typeof payload.stage === "string";

const availableName = async (directory: string): Promise<string> => {
  const taken = new Set(await readdir(directory));

  return uniqueFilename(ZIP_NAME, taken);
};

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
  onFileProgress,
  onModelProgress,
  outputDirectory,
  signal,
}: RunOptions): Promise<RunResult> => {
  const detect = await createNodeDetector({ onModelProgress });

  const pool = workerpool.pool(WORKER_SCRIPT, {
    maxWorkers: jobs ?? defaultJobs(),
    minWorkers: "max",
    onCreateWorker: () => {
      const channel = new MessageChannel();

      serveDetect(channel.port1, detect);

      return {
        workerThreadOpts: { transferList: [channel.port2], workerData: { port: channel.port2 } },
      };
    },
    workerType: "thread",
  });

  const stop = () => {
    void pool.terminate(true);
  };

  signal.addEventListener("abort", stop, { once: true });

  const redactOne = (file: string, index: number) =>
    pool.exec<(path: string) => NodeRedactionOutput>("redact", [file], {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool events cross the thread boundary untyped; isProgress parses them
      on: (payload: unknown) => {
        if (isProgress(payload)) {
          onFileProgress({ fraction: payload.fraction, index, stage: payload.stage });
        }
      },
    });

  const settled = await Promise.allSettled(files.map(redactOne));

  signal.removeEventListener("abort", stop);

  if (!signal.aborted) {
    await pool.terminate();
  }

  const cancelled = signal.aborted;

  const outcomes = settled.map((outcome, index): FileOutcome => {
    const name = basename(files[index]);

    return outcome.status === "rejected"
      ? { kind: "failed", name, reason: describeError(outcome.reason) }
      : {
          blob: new Blob([toArrayBuffer(outcome.value.bytes)]),
          kind: "done",
          name,
          redactionCount: outcome.value.redactionCount,
          warnings: outcome.value.warnings,
        };
  });

  const entries: Array<ZipEntry> = [];
  const failures: Array<FileFailure> = [];
  const warnings: Array<FileWarnings> = [];
  let redactionCount = 0;

  for (const outcome of outcomes) {
    if (outcome.kind === "failed") {
      if (!cancelled) {
        failures.push({ name: outcome.name, reason: outcome.reason });
      }

      continue;
    }

    entries.push({ blob: outcome.blob, name: outcome.name });
    redactionCount += outcome.redactionCount;

    if (outcome.warnings.length > 0) {
      warnings.push({ keys: outcome.warnings, name: outcome.name });
    }
  }

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
