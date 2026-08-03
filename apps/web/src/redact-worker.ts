import type { DocumentLanguage, RedactionResult } from "@repo/redact-core";
import { createDetectClient, createRedactorRegistry } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";
import workerpool from "workerpool";

import type { ProgressEvent } from "./worker-protocol";

const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

const ABORT_LIMIT = 45_000;

class CancelledError extends Error {
  constructor() {
    super("The job was cancelled");
    this.name = "CancelledError";
  }
}

let cancelled = false;

const noop = () => {};

type PublicWorker = { addAbortListener: (listener: () => Promise<void>) => void };

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
    unwind();
    port.close();
  }
}

workerpool.worker({ redact }, { abortListenerTimeout: ABORT_LIMIT });

export { ABORT_LIMIT };
