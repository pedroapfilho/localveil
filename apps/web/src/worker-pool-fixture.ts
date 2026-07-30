import type { RedactionResult } from "@repo/redact-core";
import { vi } from "vitest";

import type { ModelHostOptions } from "./model-host";
import type { ProgressEvent } from "./worker-protocol";

type ExecOptions = { on: (payload: unknown) => void; transfer: Array<unknown> };

// Stands in for workerpool's own promise, which carries `cancel` and whose `then`
// takes two required callbacks rather than optional ones. Reproducing that thenable is
// the point of the fake, so the rule against it is not the one to follow here.
class FakeTask {
  cancelled = false;

  private onDone?: (result: RedactionResult) => void;
  private onFail?: (error: unknown) => void;

  constructor(
    readonly params: Array<unknown>,
    readonly options: ExecOptions,
  ) {}

  // oxlint-disable-next-line unicorn/no-thenable
  then(onDone: (result: RedactionResult) => void, onFail: (error: unknown) => void) {
    this.onDone = onDone;
    this.onFail = onFail;
  }

  cancel() {
    this.cancelled = true;
  }

  emit(payload: unknown) {
    this.options.on(payload);
  }

  progress(fraction = 0.1) {
    this.emit({ fraction, stage: "stage.rendering", type: "progress" } satisfies ProgressEvent);
  }

  finish(result: RedactionResult) {
    this.onDone?.(result);
  }

  crash(error: unknown) {
    this.onFail?.(error);
  }
}

// Module state rather than per-test locals: `vi.mock` factories are hoisted above
// anything a test file declares, so the doubles they build have to reach it here.
const pooled = {
  connected: [] as Array<string>,
  disconnected: [] as Array<string>,
  host: undefined as ModelHostOptions | undefined,
  overflowAfter: Number.POSITIVE_INFINITY,
  tasks: [] as Array<FakeTask>,
  terminated: 0,
};

const reported = {
  done: [] as Array<string>,
  errors: [] as Array<{ id: string; message: string; unsupported: boolean }>,
  model: [] as Array<string>,
  progress: [] as Array<{ fraction: number; id: string }>,
};

const modelHostDouble = {
  createModelHost: (options: ModelHostOptions) => {
    pooled.host = options;

    return {
      connect: (channel: string) => {
        pooled.connected.push(channel);
      },
      destroy: () => {},
      disconnect: (channel: string) => {
        pooled.disconnected.push(channel);
      },
    };
  },
};

const workerpoolDouble = {
  default: {
    pool: () => ({
      exec: (_method: string, params: Array<unknown>, options: ExecOptions) => {
        if (pooled.tasks.length >= pooled.overflowAfter) {
          throw new Error("Max queue size of 1 reached");
        }

        const task = new FakeTask(params, options);

        pooled.tasks.push(task);

        return task;
      },
      terminate: () => {
        pooled.terminated += 1;

        return Promise.resolve();
      },
    }),
  },
};

const poolOptions = (maxWorkers: number) => ({
  maxWorkers,
  onDone: (id: string) => {
    reported.done.push(id);
  },
  onError: (id: string, message: string, unsupported: boolean) => {
    reported.errors.push({ id, message, unsupported });
  },
  onModelProgress: (_fraction: number, stage: string) => {
    reported.model.push(stage);
  },
  onProgress: (id: string, fraction: number) => {
    reported.progress.push({ fraction, id });
  },
});

const resetFixture = () => {
  pooled.tasks.length = 0;
  pooled.connected.length = 0;
  pooled.disconnected.length = 0;
  pooled.overflowAfter = Number.POSITIVE_INFINITY;
  pooled.terminated = 0;
  pooled.host = undefined;
  reported.done.length = 0;
  reported.errors.length = 0;
  reported.model.length = 0;
  reported.progress.length = 0;
  vi.restoreAllMocks();
};

const modelHost = () => {
  if (pooled.host === undefined) {
    throw new Error("The pool never built a model host");
  }

  return pooled.host;
};

const taskAt = (index: number) => {
  const task = pooled.tasks[index];

  if (task === undefined) {
    throw new Error(`No task was queued at index ${String(index)}`);
  }

  return task;
};

const job = (id: string) => ({ file: new File(["x"], `${id}.txt`), id });

const redacted: RedactionResult = { blob: new Blob(["x"]), redactionCount: 0, warnings: [] };

export {
  job,
  modelHost,
  modelHostDouble,
  pooled,
  poolOptions,
  redacted,
  reported,
  resetFixture,
  taskAt,
  workerpoolDouble,
};
export type { ExecOptions, FakeTask };
