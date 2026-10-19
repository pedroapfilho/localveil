import type { ModelId } from "@repo/pii-detect/models";
import type { Analysis, RedactionResult } from "@repo/redact-core";
import { isProgressEvent, warnRecoverable } from "@repo/redact-core";
import workerpool from "workerpool";

import type { ApplyRequest, CreatePool, JobRequest } from "./job-runner";
import type { ModelHost } from "./model-host";
import { createModelHost } from "./model-host";
import { probeCapacity } from "./probe-capacity";
// oxlint-disable-next-line import/default -- Vite's ?worker&url query resolves to a default-exported URL the resolver cannot see
import redactWorkerUrl from "./redact-worker.ts?worker&url";
import type { AnalyseTask, ApplyTask } from "./worker-protocol";

const SILENCE_LIMIT = 120_000;

type PooledTask = {
  cancel: () => void;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool settles with untyped values; isAnalysis/isResult parse them
  settle: (onDone: (value: unknown) => void, onFail: (cause: unknown) => void) => void;
};

// A file has started once its worker first reports progress; until then it is waiting for a worker.
type LiveJob = {
  channel: string;
  id: string;
  restart: () => void;
  started: boolean;
  task: PooledTask;
  watchdog?: ReturnType<typeof setTimeout>;
};

const isAnalysis = (value: unknown): value is Analysis =>
  typeof value === "object" &&
  value !== null &&
  "detections" in value &&
  Array.isArray(value.detections);

const isResult = (value: unknown): value is RedactionResult =>
  typeof value === "object" && value !== null && "blob" in value && value.blob instanceof Blob;

type WorkerTask = {
  cancel: () => void;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool settles with untyped values; isAnalysis/isResult parse them
  then: (onDone: (value: unknown) => void, onFail: (cause: unknown) => void) => void;
};

const isWorkerTask = (task: unknown): task is WorkerTask =>
  typeof task === "object" &&
  task !== null &&
  "cancel" in task &&
  typeof task.cancel === "function" &&
  "then" in task &&
  typeof task.then === "function";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool's exec result is untyped; this function is its parser
const asPooledTask = (task: unknown): PooledTask => {
  if (!isWorkerTask(task)) {
    throw new TypeError("workerpool returned a task that cannot be cancelled or settled");
  }

  return {
    cancel: () => {
      task.cancel();
    },
    settle: (onDone, onFail) => {
      // oxlint-disable-next-line promise/catch-or-return, promise/prefer-catch, promise/prefer-await-to-then -- workerpool's task is a thenable, not a Promise; then(onDone, onFail) is its settle contract
      task.then(onDone, onFail);
    },
  };
};

const shutDownWith = async (pool: { terminate: (force: boolean) => Promise<void> }) => {
  try {
    await pool.terminate(true);
  } catch (error) {
    warnRecoverable("A redaction worker would not shut down", error);
  }
};

const createRedactionPool: CreatePool = (options) => {
  const { onAnalysed, onDone, onFailed, onModelLoad, onModelLost, onProgress } = options;

  const jobs = new Map<string, LiveJob>();

  let host: ModelHost;

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
    onFailed(job.id, new Error(reason));
  };

  const arm = (job: LiveJob) => {
    clearTimeout(job.watchdog);

    job.watchdog = setTimeout(() => {
      give(job, "The redaction worker stopped answering");
    }, SILENCE_LIMIT);
  };

  const hostFor = (chosen: ModelId) =>
    createModelHost({
      model: chosen,
      // A file waits in detect while the model loads, so every step of the load keeps it alive.
      onLoad: (event) => {
        for (const job of jobs.values()) {
          if (job.started) {
            arm(job);
          }
        }

        onModelLoad(event);
      },
      // Every file is failed or restarted before the loss is reported, since the runner reads what is left.
      onLost: (reason, fatal) => {
        const waiting = [...jobs.values()].filter((job) => !job.started);
        const failing = [...jobs.values()].filter((job) => job.started || fatal);

        for (const job of failing) {
          give(job, reason);
        }

        if (!fatal) {
          for (const job of waiting) {
            release(job);
            job.task.cancel();
            job.restart();
          }
        }

        onModelLost(reason, fatal);
      },
    });

  host = hostFor(options.model);

  const pool = workerpool.pool(redactWorkerUrl, {
    maxWorkers: probeCapacity().maxWorkers,
    minWorkers: "max",
    workerOpts: { type: "module" },
    workerType: "web",
  });

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool events cross the worker boundary untyped; isProgressEvent parses them
  const watching = (id: string) => (payload: unknown) => {
    const live = jobs.get(id);

    if (live === undefined || !isProgressEvent(payload)) {
      return;
    }

    live.started = true;
    arm(live);
    onProgress(id, payload.fraction, payload.stage);
  };

  const start = (
    id: string,
    restart: () => void,
    run: (port: MessagePort) => object,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerpool settles with untyped values; isAnalysis/isResult parse them
    settled: (value: unknown) => void,
  ) => {
    const channel = crypto.randomUUID();
    const wire = new MessageChannel();

    if (!host.connect(channel, wire.port1)) {
      onFailed(id, new Error("The detection model is gone, so nothing can be redacted"));

      return;
    }

    try {
      const task = asPooledTask(run(wire.port2));
      const live: LiveJob = { channel, id, restart, started: false, task };

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
            onFailed(id, error);
          }
        },
      );
    } catch (error) {
      host.disconnect(channel);
      onFailed(id, error);
    }
  };

  const submit = (job: JobRequest) => {
    start(
      job.id,
      () => {
        submit(job);
      },
      (port) =>
        pool.exec<AnalyseTask>("analyse", [job.file, port], {
          on: watching(job.id),
          transfer: [port],
        }),
      (value) => {
        if (isAnalysis(value)) {
          onAnalysed(job.id, value);

          return;
        }

        onFailed(job.id, new Error("The worker returned something that is not an analysis"));
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

        onFailed(
          request.id,
          new Error("The worker returned something that is not a redacted file"),
        );
      },
    );
  };

  return {
    apply,
    cancel: (id) => {
      release(jobs.get(id))?.task.cancel();
    },
    destroy: () => {
      for (const job of jobs.values()) {
        release(job);
      }

      host.destroy();
      void shutDownWith(pool);
    },
    /* A switch replaces the model worker outright: two sessions of nearly a gigabyte each do not fit
       side by side, and terminating is the only way to be sure the old one lets go. The runner
       switches only while no file is in flight, so nothing is left talking to the old one. */
    setModel: (next) => {
      host.destroy();
      host = hostFor(next);
    },
    submit,
  };
};

export { createRedactionPool };
export type { WorkerTask };
