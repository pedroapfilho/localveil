/* oxlint-disable anti-slop/no-unknown-parameters -- this fixture mirrors workerpool's untyped task wire, so its params are unknown by contract */
import type { Analysis, RedactionResult } from "@repo/redact-core";
import { vi } from "vitest";

import type { ModelHostOptions } from "./model-host";
import type { ProgressEvent } from "./worker-protocol";

type ExecOptions = { on: (payload: unknown) => void; transfer: Array<unknown> };

class FakeTask {
  cancelled = false;

  private onDone?: (result: Analysis | RedactionResult) => void;
  private onFail?: (error: unknown) => void;

  constructor(
    readonly params: Array<unknown>,
    readonly options: ExecOptions,
  ) {}

  // oxlint-disable-next-line unicorn/no-thenable
  then(onDone: (result: Analysis | RedactionResult) => void, onFail: (error: unknown) => void) {
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

  finish(result: Analysis | RedactionResult) {
    this.onDone?.(result);
  }

  crash(error: unknown) {
    this.onFail?.(error);
  }
}

type Pooled = {
  connected: Array<string>;
  disconnected: Array<string>;
  host: ModelHostOptions | undefined;
  modelGone: boolean;
  overflowAfter: number;
  tasks: Array<FakeTask>;
  terminated: number;
};

const pooled: Pooled = {
  connected: [],
  disconnected: [],
  host: undefined,
  modelGone: false,
  overflowAfter: Number.POSITIVE_INFINITY,
  tasks: [],
  terminated: 0,
};

type Reported = {
  analysed: Array<string>;
  done: Array<string>;
  errors: Array<{ id: string; message: string; unsupported: boolean }>;
  model: Array<string>;
  modelLost: Array<string>;
  progress: Array<{ fraction: number; id: string }>;
};

const reported: Reported = {
  analysed: [],
  done: [],
  errors: [],
  model: [],
  modelLost: [],
  progress: [],
};

const modelHostDouble = {
  createModelHost: (options: ModelHostOptions) => {
    pooled.host = options;

    return {
      connect: (channel: string) => {
        if (pooled.modelGone) {
          return false;
        }

        pooled.connected.push(channel);

        return true;
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
  onAnalysed: (id: string) => {
    reported.analysed.push(id);
  },
  onDone: (id: string) => {
    reported.done.push(id);
  },
  onError: (id: string, message: string, unsupported: boolean) => {
    reported.errors.push({ id, message, unsupported });
  },
  onModelLost: (reason: string) => {
    reported.modelLost.push(reason);
  },
  onModelProgress: (_fraction: number, stage: string) => {
    reported.model.push(stage);
  },
  onProgress: (id: string, fraction: number) => {
    reported.progress.push({ fraction, id });
  },
});

const resetFixture = () => {
  reported.analysed.length = 0;
  pooled.tasks.length = 0;
  pooled.connected.length = 0;
  pooled.disconnected.length = 0;
  pooled.modelGone = false;
  pooled.overflowAfter = Number.POSITIVE_INFINITY;
  pooled.terminated = 0;
  pooled.host = undefined;
  reported.done.length = 0;
  reported.errors.length = 0;
  reported.model.length = 0;
  reported.modelLost.length = 0;
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
