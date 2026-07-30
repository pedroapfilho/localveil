import type { DocumentLanguage, RedactionResult } from "@repo/redact-core";
import { createDetectClient, createRedactorRegistry } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";
import workerpool from "workerpool";

import type { ProgressEvent } from "./worker-protocol";

// The three predicates are disjoint (text/*, application/pdf, image/*), so the order
// only decides which one is asked first. At module scope so pdf.js and the Tesseract
// weights survive from one task to the next.
const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

// The checkpoint below can only fire when the redactor next reports progress, and on a
// scanned page that is after Tesseract has finished it. workerpool's default of one
// second is shorter than a single page, so every cancel would time out and kill the
// worker, which is the outcome the listener exists to avoid.
const ABORT_LIMIT = 45_000;

// Cancelling has to reach code several loops deep inside a redactor, and none of them
// knows what a job is. The progress callback runs on every page, so it doubles as the
// checkpoint and no redactor had to learn anything new.
class CancelledError extends Error {
  constructor() {
    super("The job was cancelled");
    this.name = "CancelledError";
  }
}

// Only ever read by the task that set it: a worker runs one at a time.
let cancelled = false;

const noop = () => {};

type PublicWorker = { addAbortListener: (listener: () => Promise<void>) => void };

// A `function` rather than an arrow because workerpool passes the task its own handle
// through `this`, and that handle is the only way to answer a cancel. Unanswered, a
// cancel kills the worker and its replacement reloads pdf.js and Tesseract.
async function redact(
  this: { worker: PublicWorker },
  file: File,
  language: DocumentLanguage | undefined,
  port: MessagePort,
): Promise<RedactionResult> {
  cancelled = false;

  let unwind = noop;
  const unwound = new Promise<void>((resolve) => {
    unwind = resolve;
  });

  // The listener waits for the redactor to actually stop rather than resolving on the
  // flag. Resolving early tells workerpool the worker is free while a page is still
  // being recognised, and the next task would then reset the flag out from under the
  // one being cancelled.
  this.worker.addAbortListener(async () => {
    cancelled = true;

    await unwound;
  });

  try {
    return await registry.resolve(file).redact(
      file,
      createDetectClient(port),
      (fraction, stage) => {
        if (cancelled) {
          throw new CancelledError();
        }

        workerpool.workerEmit({ fraction, stage, type: "progress" } satisfies ProgressEvent);
      },
      { language },
    );
  } finally {
    // Inside the `finally` and covering `registry.resolve` too: an unsupported file
    // throwing before this point would leave the listener above waiting forever, and
    // workerpool keeps that listener for the life of the worker, so every later cancel
    // on it would time out and kill it.
    unwind();
    port.close();
  }
}

workerpool.worker({ redact }, { abortListenerTimeout: ABORT_LIMIT });

export { ABORT_LIMIT };
