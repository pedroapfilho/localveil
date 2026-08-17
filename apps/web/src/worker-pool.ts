import type {
  Analysis,
  Decisions,
  DocumentLanguage,
  FileStageKey,
  ModelStageKey,
  RedactionResult,
} from "@repo/redact-core";
import { describeError, isUnsupportedFile } from "@repo/redact-core";
import workerpool from "workerpool";

import type { ModelHost } from "./model-host";
import { createModelHost } from "./model-host";
// oxlint-disable-next-line import/default
import redactWorkerUrl from "./redact-worker.ts?worker&url";
import type { AnalyseTask, ApplyTask, ProgressEvent } from "./worker-protocol";

const SILENCE_LIMIT = 120_000;

type JobRequest = { file: File; id: string; language?: DocumentLanguage };

type ApplyRequest = { analysis: Analysis; decisions: Decisions; file: File; id: string };

type RedactionPoolOptions = {
  maxWorkers: number;
  onAnalysed: (id: string, analysis: Analysis) => void;
  onDone: (id: string, result: RedactionResult) => void;
  onError: (id: string, message: string, unsupported: boolean) => void;
  onModelLost: (reason: string) => void;
  onModelProgress: (fraction: number, stage: ModelStageKey) => void;
  onProgress: (id: string, fraction: number, stage: FileStageKey) => void;
};

type RedactionPool = {
  apply: (request: ApplyRequest) => void;
  cancel: (id: string) => void;
  destroy: () => void;
  submit: (job: JobRequest) => void;
};

type PooledTask = {
  cancel: () => void;
  settle: (onDone: (value: unknown) => void, onFail: (error: unknown) => void) => void;
};

// The presence of the watchdog is the phase: it is armed the moment the worker first speaks, so
// an absent one means the job is still queued behind the model. A separate `started` flag said
// the same thing in a second place that nothing kept in step.
type LiveJob = {
  channel: string;
  id: string;
  restart: () => void;
  task: PooledTask;
  watchdog?: ReturnType<typeof setTimeout>;
};

const isAnalysis = (value: unknown): value is Analysis =>
  typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "detections"));

const isResult = (value: unknown): value is RedactionResult =>
  typeof value === "object" && value !== null && Reflect.get(value, "blob") instanceof Blob;

const isProgressEvent = (payload: unknown): payload is ProgressEvent =>
  typeof payload === "object" &&
  payload !== null &&
  "type" in payload &&
  payload.type === "progress";

const asPooledTask = (task: object): PooledTask => {
  if (!("cancel" in task) || typeof task.cancel !== "function") {
    throw new TypeError("workerpool returned a task that cannot be cancelled");
  }

  if (!("then" in task) || typeof task.then !== "function") {
    throw new TypeError("workerpool returned a task that never settles");
  }

  const { cancel, then } = task;

  return {
    cancel: () => {
      cancel.call(task);
    },
    settle: (onDone, onFail) => {
      then.call(task, onDone, onFail);
    },
  };
};

const shutDownWith = async (pool: { terminate: (force: boolean) => Promise<void> }) => {
  try {
    await pool.terminate(true);
  } catch (error) {
    // oxlint-disable-next-line eslint/no-console
    console.warn("A redaction worker would not shut down", error);
  }
};

const createRedactionPool = (options: RedactionPoolOptions): RedactionPool => {
  const { maxWorkers, onAnalysed, onDone, onError, onModelLost, onModelProgress, onProgress } =
    options;

  const jobs = new Map<string, LiveJob>();

  // oxlint-disable-next-line eslint/prefer-const
  let host: ModelHost;

  const arm = (job: LiveJob) => {
    clearTimeout(job.watchdog);

    job.watchdog = setTimeout(() => {
      // eslint-disable-next-line no-use-before-define -- mutually recursive with give
      give(job, "The redaction worker stopped answering");
    }, SILENCE_LIMIT);
  };

  // Identity is the record, not the id. A resubmit under the same id replaces the entry, and
  // keying teardown on the id alone would let the replaced job's watchdog fail its successor.
  const release = (job: LiveJob | undefined) => {
    if (job === undefined || jobs.get(job.id) !== job) {
      return undefined;
    }

    clearTimeout(job.watchdog);
    jobs.delete(job.id);
    host.disconnect(job.channel);

    return job;
  };

  const give = (job: LiveJob, reason: string) => {
    if (release(job) === undefined) {
      return;
    }

    job.task.cancel();
    onError(job.id, reason, false);
  };

  host = createModelHost({
    onLost: (reason, fatal) => {
      // oxlint-disable-next-line unicorn/no-useless-spread
      const waiting = [...jobs.values()].filter((job) => job.watchdog === undefined);

      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const job of [...jobs.values()]) {
        if (job.watchdog !== undefined || fatal) {
          give(job, reason);
        }
      }

      if (fatal) {
        onModelLost(reason);

        return;
      }

      for (const job of waiting) {
        release(job);
        job.task.cancel();
        job.restart();
      }
    },
    onProgress: (fraction, stage) => {
      for (const job of jobs.values()) {
        if (job.watchdog !== undefined) {
          arm(job);
        }
      }

      onModelProgress(fraction, stage);
    },
  });

  const pool = workerpool.pool(redactWorkerUrl, {
    maxWorkers,
    minWorkers: "max",
    workerOpts: { type: "module" },
    workerType: "web",
  });

  const watching = (id: string) => (payload: unknown) => {
    const live = jobs.get(id);

    if (live === undefined || !isProgressEvent(payload)) {
      return;
    }

    arm(live);
    onProgress(id, payload.fraction, payload.stage);
  };

  const start = (
    id: string,
    restart: () => void,
    run: (port: MessagePort) => object,
    settled: (value: unknown) => void,
  ) => {
    const channel = crypto.randomUUID();
    const wire = new MessageChannel();

    if (!host.connect(channel, wire.port1)) {
      onError(id, "The detection model is gone, so nothing can be redacted", false);

      return;
    }

    try {
      const task = asPooledTask(run(wire.port2));
      const live: LiveJob = { channel, id, restart, task };

      release(jobs.get(id))?.task.cancel();
      jobs.set(id, live);

      task.settle(
        (value) => {
          if (release(live) !== undefined) {
            settled(value);
          }
        },
        (error) => {
          if (release(live) !== undefined) {
            onError(id, describeError(error), isUnsupportedFile(error));
          }
        },
      );
    } catch (error) {
      host.disconnect(channel);
      onError(id, describeError(error), false);
    }
  };

  const submit = (job: JobRequest) => {
    start(
      job.id,
      () => {
        submit(job);
      },
      (port) =>
        pool.exec<AnalyseTask>("analyse", [job.file, job.language, port], {
          on: watching(job.id),
          transfer: [port],
        }),
      (value) => {
        if (isAnalysis(value)) {
          onAnalysed(job.id, value);

          return;
        }

        onError(job.id, "The worker returned something that is not an analysis", false);
      },
    );
  };

  const apply = (request: ApplyRequest) => {
    start(
      request.id,
      () => {
        apply(request);
      },
      (port) =>
        pool.exec<ApplyTask>(
          "apply",
          [request.file, { analysis: request.analysis, decisions: request.decisions }, port],
          { on: watching(request.id), transfer: [port] },
        ),
      (value) => {
        if (isResult(value)) {
          onDone(request.id, value);

          return;
        }

        onError(request.id, "The worker returned something that is not a redacted file", false);
      },
    );
  };

  return {
    apply,
    cancel: (id) => {
      release(jobs.get(id))?.task.cancel();
    },
    destroy: () => {
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const job of [...jobs.values()]) {
        release(job);
      }

      host.destroy();
      void shutDownWith(pool);
    },
    submit,
  };
};

export { createRedactionPool, SILENCE_LIMIT };
export type { ApplyRequest, JobRequest, RedactionPool, RedactionPoolOptions };
