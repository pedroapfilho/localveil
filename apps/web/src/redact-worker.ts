import type {
  Analysis,
  Decisions,
  FileStageKey,
  ProgressEvent,
  RedactionResult,
} from "@repo/redact-core";
import { createDetectClient } from "@repo/redact-core";
import { resolveRedactor } from "@repo/redact-formats/redactors";
import workerpool from "workerpool";

const ABORT_LIMIT = 45_000;

class CancelledError extends Error {
  constructor() {
    super("The job was cancelled");
    this.name = "CancelledError";
  }
}

let cancelled = false;

const noop = () => {};

type PublicWorker = { addAbortListener: (listener: () => Promise<void>) => void };

type Report = (fraction: number, stage: FileStageKey) => void;

const guarded = async <T>(
  worker: PublicWorker,
  port: MessagePort,
  work: (report: Report) => Promise<T>,
): Promise<T> => {
  cancelled = false;

  let unwind = noop;

  const unwound = new Promise<void>((resolve) => {
    unwind = resolve;
  });

  worker.addAbortListener(async () => {
    cancelled = true;

    await unwound;
  });

  try {
    return await work((fraction, stage) => {
      if (cancelled) {
        throw new CancelledError();
      }

      workerpool.workerEmit({ fraction, stage, type: "progress" } satisfies ProgressEvent);
    });
  } finally {
    unwind();
    port.close();
  }
};

async function analyse(
  this: { worker: PublicWorker },
  file: File,
  port: MessagePort,
): Promise<Analysis> {
  const analysis = await guarded(this.worker, port, (report) =>
    resolveRedactor(file).analyse(file, createDetectClient(port), report),
  );

  return analysis;
}

async function apply(
  this: { worker: PublicWorker },
  file: File,
  work: { analysis: Analysis; decisions: Decisions },
  port: MessagePort,
): Promise<RedactionResult> {
  const result = await guarded(this.worker, port, (report) =>
    resolveRedactor(file).apply({
      analysis: work.analysis,
      decisions: work.decisions,
      detect: createDetectClient(port),
      file,
      onProgress: report,
    }),
  );

  return result;
}

workerpool.worker({ analyse, apply }, { abortListenerTimeout: ABORT_LIMIT });

export { ABORT_LIMIT };
