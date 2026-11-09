import type { Analysis, FileStageKey, RedactionResult } from "@repo/redact-core";
import { analyseFile, applyDecisions, createDetectClient, progressEvent } from "@repo/redact-core";
import { resolveRedactor } from "@repo/redact-formats/redactors";
import workerpool from "workerpool";

import type { ApplyWork, RedactWorker } from "./worker-protocol";

const ABORT_LIMIT = 45_000;

class CancelledError extends Error {
  constructor() {
    super("The job was cancelled");
    this.name = "CancelledError";
  }
}

const noop = () => {};

type PublicWorker = { addAbortListener: (listener: () => Promise<void>) => void };

type Report = (fraction: number, stage: FileStageKey) => void;

type Served<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (...args: infer Params) => infer Result
    ? (this: { worker: PublicWorker }, ...args: Params) => Promise<Result>
    : never;
};

const guarded = async <T>(
  worker: PublicWorker,
  port: MessagePort,
  work: (report: Report) => Promise<T>,
): Promise<T> => {
  let cancelled = false;
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

      workerpool.workerEmit(progressEvent(fraction, stage));
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
    analyseFile({
      detect: createDetectClient(port),
      file,
      onProgress: report,
      redactor: resolveRedactor(file),
    }),
  );

  return analysis;
}

async function apply(
  this: { worker: PublicWorker },
  file: File,
  work: ApplyWork,
  port: MessagePort,
): Promise<RedactionResult> {
  const result = await guarded(this.worker, port, (report) =>
    applyDecisions({
      analysis: work.analysis,
      decisions: work.decisions,
      detect: createDetectClient(port),
      file,
      onProgress: report,
      redactor: resolveRedactor(file),
    }),
  );

  return result;
}

workerpool.worker({ analyse, apply } satisfies Served<RedactWorker>, {
  abortListenerTimeout: ABORT_LIMIT,
});
