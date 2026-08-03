import type {
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
import type { ProgressEvent, RedactTask } from "./worker-protocol";

const SILENCE_LIMIT = 120_000;

type JobRequest = { file: File; id: string; language?: DocumentLanguage };

type RedactionPoolOptions = {
  maxWorkers: number;
  onDone: (id: string, result: RedactionResult) => void;
  onError: (id: string, message: string, unsupported: boolean) => void;
  onModelLost: (reason: string) => void;
  onModelProgress: (fraction: number, stage: ModelStageKey) => void;
  onProgress: (id: string, fraction: number, stage: FileStageKey) => void;
};

type RedactionPool = {
  cancel: (id: string) => void;
  destroy: () => void;
  submit: (job: JobRequest) => void;
};

type PooledTask = {
  cancel: () => void;
  settle: (onDone: (result: RedactionResult) => void, onFail: (error: unknown) => void) => void;
};

type LiveJob = {
  channel: string;
  request: JobRequest;
  started: boolean;
  task: PooledTask;
  watchdog?: ReturnType<typeof setTimeout>;
};

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
  const { maxWorkers, onDone, onError, onModelLost, onModelProgress, onProgress } = options;

  const jobs = new Map<string, LiveJob>();

  // oxlint-disable-next-line eslint/prefer-const
  let host: ModelHost;

  const arm = (job: LiveJob) => {
    clearTimeout(job.watchdog);

    job.watchdog = setTimeout(() => {
      // eslint-disable-next-line no-use-before-define -- mutually recursive with give
      give(job.request.id, "The redaction worker stopped answering");
    }, SILENCE_LIMIT);
  };

  const release = (id: string) => {
    const job = jobs.get(id);

    if (job === undefined) {
      return undefined;
    }

    clearTimeout(job.watchdog);
    jobs.delete(id);
    host.disconnect(job.channel);

    return job;
  };

  const give = (id: string, reason: string) => {
    const job = release(id);

    if (job === undefined) {
      return;
    }

    job.task.cancel();
    onError(id, reason, false);
  };

  host = createModelHost({
    onLost: (reason, fatal) => {
      // oxlint-disable-next-line unicorn/no-useless-spread
      const waiting = [...jobs.values()].filter((job) => !job.started);

      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const job of [...jobs.values()]) {
        if (job.started || fatal) {
          give(job.request.id, reason);
        }
      }

      if (fatal) {
        onModelLost(reason);

        return;
      }

      for (const job of waiting) {
        release(job.request.id);
        job.task.cancel();
        // eslint-disable-next-line no-use-before-define -- resubmission needs submit
        submit(job.request);
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

  const submit = (job: JobRequest) => {
    const channel = crypto.randomUUID();
    const wire = new MessageChannel();

    host.connect(channel, wire.port1);

    const mine = () => {
      const live = jobs.get(job.id);

      return live?.channel === channel ? live : undefined;
    };

    try {
      const task = asPooledTask(
        pool.exec<RedactTask>("redact", [job.file, job.language, wire.port2], {
          on: (payload: unknown) => {
            const live = mine();

            if (live === undefined || !isProgressEvent(payload)) {
              return;
            }

            live.started = true;
            arm(live);
            onProgress(job.id, payload.fraction, payload.stage);
          },
          transfer: [wire.port2],
        }),
      );

      jobs.set(job.id, { channel, request: job, started: false, task });

      task.settle(
        (result) => {
          if (mine() !== undefined && release(job.id) !== undefined) {
            onDone(job.id, result);
          }
        },
        (error) => {
          if (mine() !== undefined && release(job.id) !== undefined) {
            onError(job.id, describeError(error), isUnsupportedFile(error));
          }
        },
      );
    } catch (error) {
      host.disconnect(channel);
      onError(job.id, describeError(error), false);
    }
  };

  return {
    cancel: (id) => {
      release(id)?.task.cancel();
    },
    destroy: () => {
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const id of [...jobs.keys()]) {
        release(id);
      }

      host.destroy();
      void shutDownWith(pool);
    },
    submit,
  };
};

export { createRedactionPool, SILENCE_LIMIT };
export type { JobRequest, RedactionPool, RedactionPoolOptions };
