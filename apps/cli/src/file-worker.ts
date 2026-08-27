import { workerData } from "node:worker_threads";

import type { EventPort } from "@repo/redact-core";
import { createDetectClient } from "@repo/redact-core";
import type { NodeRedactionOutput } from "@repo/redact-node";
import { redactPath } from "@repo/redact-node";
import workerpool from "workerpool";

type WorkerSetup = { port: EventPort };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- workerData crosses the thread boundary untyped; this guard is its parser
const isSetup = (value: unknown): value is WorkerSetup =>
  typeof value === "object" && value !== null && "port" in value && value.port !== null;

if (!isSetup(workerData)) {
  throw new TypeError("The redaction thread started without a port to the model");
}

const detect = createDetectClient(workerData.port);

const redact = (path: string): Promise<NodeRedactionOutput> =>
  redactPath(path, detect, (fraction, stage) => {
    workerpool.workerEmit({ fraction, stage });
  });

workerpool.worker({ redact });
