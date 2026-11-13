import { cpus } from "node:os";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { aborted } from "node:util";
import { MessageChannel } from "node:worker_threads";

import { createDetector } from "@repo/pii-detect";
import type { ModelId, ModelLoadEvent } from "@repo/pii-detect/models";
import { archiveNames, buildZip, isProgressEvent, serveDetect, toArrayBuffer } from "@repo/redact";
import type { FileStageKey, WarningKey, ZipEntry } from "@repo/redact";
import { describeError } from "@repo/redact-core";
import type { Detect } from "@repo/redact-core";
import workerpool from "workerpool";

import type { FileWorker } from "./file-worker";
import { writeArchive } from "./write-archive";

const MAX_JOBS = 4;

const defaultJobs = () => {
  const half = Math.floor(cpus().length / 2);

  return Math.max(1, Math.min(half, MAX_JOBS));
};

const workerUrl = new URL("file-worker.ts", import.meta.url);

const REDACT = "redact" satisfies keyof FileWorker;
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

type RunSettings = { jobs?: number; model?: ModelId };

type RunOptions = RunSettings & {
  files: ReadonlyArray<string>;
  onFileProgress: (progress: RunProgress) => void;
  onModelLoad: (event: ModelLoadEvent) => void;
  outputDirectory: string;
  signal: AbortSignal;
};

/* The signal ends the download, but building the session takes none, so a stop during the build is
   answered without waiting it out. */
const unlessStopped = async (
  loading: Promise<Detect>,
  signal: AbortSignal,
): Promise<Detect | undefined> => {
  try {
    await Promise.race([loading, aborted(signal, loading)]);
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }

  return signal.aborted ? undefined : loading;
};

const runRedaction = async ({
  files,
  jobs,
  model,
  onFileProgress,
  onModelLoad,
  outputDirectory,
  signal,
}: RunOptions): Promise<RunResult> => {
  const detect = await unlessStopped(
    createDetector({ model, onLoad: onModelLoad, signal }),
    signal,
  );

  if (detect === undefined) {
    return {
      cancelled: true,
      failures: [],
      fileCount: 0,
      redactionCount: 0,
      warnings: [],
      zipPath: null,
    };
  }

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
    pool.exec<FileWorker[typeof REDACT]>(REDACT, [file], {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool events cross the thread boundary untyped; isProgressEvent parses them
      on: (payload: unknown) => {
        if (isProgressEvent(payload)) {
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
    const file = files[index];

    if (file === undefined) {
      throw new RangeError(`Redaction outcome ${String(index)} has no file`);
    }

    return outcome.status === "rejected"
      ? { kind: "failed", name: basename(file), reason: describeError(outcome.reason) }
      : {
          blob: new Blob([toArrayBuffer(outcome.value.bytes)]),
          kind: "done",
          name: outcome.value.name,
          redactionCount: outcome.value.redactionCount,
          warnings: outcome.value.warnings,
        };
  });

  const failures: Array<FileFailure> = cancelled
    ? []
    : outcomes.flatMap((outcome) =>
        outcome.kind === "failed" ? [{ name: outcome.name, reason: outcome.reason }] : [],
      );

  const done = outcomes.filter((outcome) => outcome.kind === "done");

  // The summary names each file the way the archive does, so a warning points at one entry.
  const names = archiveNames(done.map((outcome) => outcome.name));
  const entries: Array<ZipEntry> = [];
  const warnings: Array<FileWarnings> = [];
  let redactionCount = 0;

  for (const [at, outcome] of done.entries()) {
    const name = names[at] ?? outcome.name;

    entries.push({ blob: outcome.blob, name });
    redactionCount += outcome.redactionCount;

    if (outcome.warnings.length > 0) {
      warnings.push({ keys: outcome.warnings, name });
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

export type { RunResult, RunSettings };
