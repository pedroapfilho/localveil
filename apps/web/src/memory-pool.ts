import type { ModelId } from "@repo/pii-detect/models";

import type {
  ApplyRequest,
  CreatePool,
  JobRequest,
  RedactionPool,
  RedactionPoolOptions,
} from "./job-runner";

type MemoryPool = {
  applied: Array<ApplyRequest>;
  cancelled: Array<string>;
  create: CreatePool;
  created: number;
  destroyed: number;
  models: Array<ModelId>;
  submitted: Array<JobRequest>;
  workers: () => RedactionPoolOptions;
};

// Holds every request the runner makes and hands back the callbacks it gave, so a test plays the workers.
const createMemoryPool = (): MemoryPool => {
  let given: RedactionPoolOptions | undefined;

  const memory: MemoryPool = {
    applied: [],
    cancelled: [],
    create: (options): RedactionPool => {
      given = options;
      memory.created += 1;
      memory.models.push(options.model);

      return {
        apply: (request) => {
          memory.applied.push(request);
        },
        cancel: (id) => {
          memory.cancelled.push(id);
        },
        destroy: () => {
          memory.destroyed += 1;
        },
        setModel: (model) => {
          memory.models.push(model);
        },
        submit: (job) => {
          memory.submitted.push(job);
        },
      };
    },
    created: 0,
    destroyed: 0,
    models: [],
    submitted: [],
    workers: () => {
      if (given === undefined) {
        throw new Error("The runner never built a pool");
      }

      return given;
    },
  };

  return memory;
};

export { createMemoryPool };
