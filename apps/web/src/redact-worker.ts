import { createDetector } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";
import { createRedactorRegistry, UnsupportedFileError } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";

import { createJobQueue } from "./job-queue";
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

const queue = createJobQueue({
  onError: (request, error) => {
    post({
      id: request.id,
      message: describeError(error),
      run: request.run,
      type: "error",
      unsupported: error instanceof UnsupportedFileError,
    });
  },
  // Every reply quotes back the run it was asked for, so the page can tell this
  // attempt's answers from those of the one it replaced.
  run: async ({ file, id, language, run }, stopIfCancelled) => {
    const redactor = registry.resolve(file);

    post({ fraction: 0, id, run, stage: "stage.loadingModel", type: "progress" });

    const detect = await loadDetector();

    stopIfCancelled();

    const result = await redactor.redact(
      file,
      detect,
      (fraction, stage) => {
        stopIfCancelled();
        post({ fraction, id, run, stage, type: "progress" });
      },
      { language },
    );

    post({
      blob: result.blob,
      id,
      redactionCount: result.redactionCount,
      run,
      type: "done",
      warnings: result.warnings,
    });
  },
});

globalThis.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === "cancel") {
    queue.cancel(request.id);

    return;
  }

  queue.enqueue(request);
});
