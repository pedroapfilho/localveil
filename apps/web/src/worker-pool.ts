import type { ModelId } from "@repo/pii-detect/models";
import type { FailureKey } from "@repo/redact";
import { isProgressEvent, RedactionFailure } from "@repo/redact";
import { warnRecoverable } from "@repo/redact-core";
import workerpool from "workerpool";

import type { ApplyRequest, CreatePool, JobRequest } from "./job-runner";
import type { ModelHost } from "./model-host";
import { createModelHost } from "./model-host";
import { probeCapacity } from "./probe-capacity";
// oxlint-disable-next-line import/default -- Vite's ?worker&url query resolves to a default-exported URL the resolver cannot see
import redactWorkerUrl from "./redact-worker.ts?worker&url";
import type { RedactWorker } from "./worker-protocol";

const SILENCE_LIMIT = 120_000;

type Task<T> = workerpool.Promise<T>;

// A file has started once its worker first reports progress; until then it is waiting for a worker.
type LiveJob = {
  channel: string;
  id: string;
  restart: () => void;
  started: boolean;
  task: Task<unknown>;
  watchdog?: ReturnType<typeof setTimeout>;
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

  const give = (job: LiveJob, failure: FailureKey) => {
    if (release(job) === undefined) {
      return;
    }

    job.task.cancel();
    onFailed(job.id, new RedactionFailure(failure));
  };

  const arm = (job: LiveJob) => {
    clearTimeout(job.watchdog);

    job.watchdog = setTimeout(() => {
      give(job, "failure.workerSilent");
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
      onLost: (failure, fatal) => {
        const waiting = [...jobs.values()].filter((job) => !job.started);
        const failing = [...jobs.values()].filter((job) => job.started || fatal);

        for (const job of failing) {
          give(job, failure);
        }

        if (!fatal) {
          for (const job of waiting) {
            release(job);
            job.task.cancel();
            job.restart();
          }
        }

        onModelLost(failure, fatal, !fatal && waiting.length > 0);
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

  const call = <Name extends keyof RedactWorker>(
    id: string,
    name: Name,
    params: Parameters<RedactWorker[Name]>,
    port: MessagePort,
  ) => pool.exec<RedactWorker[Name]>(name, params, { on: watching(id), transfer: [port] });

  const start = <T>(
    id: string,
    restart: () => void,
    run: (port: MessagePort) => Task<T>,
    settled: (value: T) => void,
  ) => {
    const channel = crypto.randomUUID();
    const wire = new MessageChannel();

    if (!host.connect(channel, wire.port1)) {
      onFailed(id, new RedactionFailure("failure.modelGone"));

      return;
    }

    try {
      const task = run(wire.port2);
      const live: LiveJob = { channel, id, restart, started: false, task };

      release(jobs.get(id))?.task.cancel();
      jobs.set(id, live);

      const done = (value: T) => {
        if (release(live) !== undefined) {
          settled(value);
        }
      };

      const failed = (error: Error) => {
        if (release(live) !== undefined) {
          onFailed(id, error);
        }
      };

      // oxlint-disable-next-line promise/catch-or-return, promise/no-callback-in-promise, promise/prefer-catch, promise/prefer-await-to-then -- workerpool's task is a thenable, not a Promise; then(onDone, onFail) is its settle contract
      task.then(done, failed);
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
      (port) => call(job.id, "analyse", [job.file, port], port),
      (analysis) => {
        onAnalysed(job.id, analysis);
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
        call(
          request.id,
          "apply",
          [request.file, { analysis: request.analysis, decisions: request.decisions }, port],
          port,
        ),
      (result) => {
        onDone(request.id, result);
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
