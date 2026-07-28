import type { FileStageKey, ModelStageKey, WarningKey } from "@repo/redact-core";

type RedactRequest = { file: File; id: string; type: "redact" };

// Sent when a row leaves the page. Without it the worker carried on rendering and
// recognising every page of a file nobody was waiting for any more, with the rest of
// the queue stuck behind it.
type CancelRequest = { id: string; type: "cancel" };

type WorkerRequest = CancelRequest | RedactRequest;

type WorkerResponse =
  | { blob: Blob; id: string; redactionCount: number; type: "done"; warnings: Array<WarningKey> }
  | { fraction: number; id: string; stage: FileStageKey; type: "progress" }
  | { fraction: number; stage: ModelStageKey; type: "model-progress" }
  | { id: string; message: string; type: "error"; unsupported: boolean };

export type { CancelRequest, RedactRequest, WorkerRequest, WorkerResponse };
