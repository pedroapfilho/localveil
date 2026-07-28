import { createDetector } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";
import { createRedactorRegistry, UnsupportedFileError } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";

import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

// The three predicates are disjoint (text/*, application/pdf, image/*), so the order
// only decides which one is asked first.
const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

const post = (message: WorkerResponse) => {
  // A worker's own postMessage takes no target origin; the rule is written for the
  // window-to-window call of the same name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  globalThis.postMessage(message);
};

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

let pendingDetector: Promise<Detect> | undefined;

const loadDetector = async () => {
  pendingDetector ??= createDetector({
    onProgress: (fraction, stage) => {
      post({ fraction, stage, type: "model-progress" });
    },
  });

  try {
    return await pendingDetector;
  } catch (error) {
    // A failed load is worth retrying on the next file: a cached rejection would
    // condemn every later job to the same error.
    pendingDetector = undefined;

    throw error;
  }
};

const runJob = async ({ file, id }: WorkerRequest) => {
  const redactor = registry.resolve(file);

  post({ fraction: 0, id, stage: "stage.loadingModel", type: "progress" });

  const detect = await loadDetector();

  const result = await redactor.redact(file, detect, (fraction, stage) => {
    post({ fraction, id, stage, type: "progress" });
  });

  post({
    blob: result.blob,
    id,
    redactionCount: result.redactionCount,
    type: "done",
    warnings: result.warnings,
  });
};

const queue: Array<WorkerRequest> = [];
let draining = false;

// One file at a time: the model holds its tensors on the device, and running two
// inferences at once is how a mid-range GPU runs out of memory.
/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop */
const drain = async () => {
  if (draining) {
    return;
  }

  draining = true;

  let next = queue.shift();

  while (next !== undefined) {
    const request = next;

    try {
      await runJob(request);
    } catch (error) {
      post({
        id: request.id,
        message: describeError(error),
        type: "error",
        unsupported: error instanceof UnsupportedFileError,
      });
    }

    next = queue.shift();
  }

  draining = false;
};
/* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop */

globalThis.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  queue.push(event.data);

  void drain();
});
