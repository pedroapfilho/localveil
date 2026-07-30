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
// Vite compiles and emits the worker, then hands back its URL. workerpool takes a
// path rather than a Worker, so this is the form that reaches it.
// oxlint-disable-next-line import/default
import redactWorkerUrl from "./redact-worker.ts?worker&url";
import type { ProgressEvent, RedactTask } from "./worker-protocol";

// A worker the browser kills for running out of memory raises no `error` on the page:
// it simply stops answering, so silence is the only signal there is. workerpool's own
// `.timeout()` cannot do this job: its clock starts when the task is dequeued and
// never resets, so it would kill a healthy two-hundred-page file.
const SILENCE_LIMIT = 120_000;

type JobRequest = { file: File; id: string; language?: DocumentLanguage };

type RedactionPoolOptions = {
  maxWorkers: number;
  onDone: (id: string, result: RedactionResult) => void;
  onError: (id: string, message: string, unsupported: boolean) => void;
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

// One record per unsettled job, removed the moment the job reaches any terminal state.
// Every callback below starts by looking the job up, so a message that arrives after
// that point has nothing to act on. workerpool keeps forwarding progress events after
// a cancel, and this is what stops them resurrecting a job that is already over.
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

// workerpool returns its own promise class, which carries `cancel` and whose `then`
// takes two required callbacks, so it is neither awaitable nor assignable to Promise.
// Checked rather than asserted: upstream drifting here would otherwise show up as a
// cancel button that silently does nothing.
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

// Reported rather than dropped: a worker that will not exit leaves a thread behind,
// and `void` on the promise would bury that.
const shutDownWith = async (pool: { terminate: (force: boolean) => Promise<void> }) => {
  try {
    await pool.terminate(true);
  } catch (error) {
    // oxlint-disable-next-line eslint/no-console
    console.warn("A redaction worker would not shut down", error);
  }
};

const createRedactionPool = (options: RedactionPoolOptions): RedactionPool => {
  const { maxWorkers, onDone, onError, onModelProgress, onProgress } = options;

  const jobs = new Map<string, LiveJob>();

  // Assigned below rather than declared there: `release` reads it, and the host's own
  // callbacks call `release`. Neither runs before the assignment.
  // oxlint-disable-next-line eslint/prefer-const
  let host: ModelHost;

  const arm = (job: LiveJob) => {
    clearTimeout(job.watchdog);

    job.watchdog = setTimeout(() => {
      // eslint-disable-next-line no-use-before-define -- mutually recursive with give
      give(job.request.id, "The redaction worker stopped answering");
    }, SILENCE_LIMIT);
  };

  // The single exit. Taking the record out here is what makes every late message a
  // no-op, so no separate set of abandoned ids has to be kept in step.
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
      // A file that never reached a worker is innocent: its port died with the model,
      // so it is handed back with a fresh one rather than failed. Only the files that
      // were actually mid-flight are lost.
      // Copied first: `give` deletes from the map this is walking.
      // oxlint-disable-next-line unicorn/no-useless-spread
      const waiting = [...jobs.values()].filter((job) => !job.started);

      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const job of [...jobs.values()]) {
        if (job.started || fatal) {
          give(job.request.id, reason);
        }
      }

      if (fatal) {
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
      // The model downloading is proof the page is alive. Without this, every file
      // blocked waiting for the weights on a first visit trips the silence timer.
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
    // One channel per job, not one per worker: a port transfers only once, so a worker
    // the pool kills and respawns would come back with no way to reach the model.
    const channel = crypto.randomUUID();
    const wire = new MessageChannel();

    host.connect(channel, wire.port1);

    // The same file can be sent back under the same id, which is what changing a
    // document's language does. Looking the id up is then not enough to know a message
    // belongs to this attempt rather than to the one it replaced: the cancelled attempt
    // can still be several stages deep and answers on an id the map has since filled
    // again. The channel is minted per submission, so it says which attempt is talking.
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

            // Armed on the first thing the worker says rather than at submission: a
            // file can sit in the queue for as long as the ones ahead of it take.
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
      // Past maxQueueSize, workerpool throws where everything else here rejects.
      host.disconnect(channel);
      onError(job.id, describeError(error), false);
    }
  };

  return {
    cancel: (id) => {
      release(id)?.task.cancel();
    },
    destroy: () => {
      // Emptied before terminating: workerpool rejects every task it kills, and a job
      // still on the map would be reported as a failure to a page that has gone.
      // Copied first: `release` deletes from the map this is walking.
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
