import type { FileStageKey, ModelStageKey, WarningKey } from "@repo/redact-core";

type WorkerRequest = { file: File; id: string; type: "redact" };

type WorkerResponse =
  | { blob: Blob; id: string; redactionCount: number; type: "done"; warnings: Array<WarningKey> }
  | { fraction: number; id: string; stage: FileStageKey; type: "progress" }
  | { fraction: number; stage: ModelStageKey; type: "model-progress" }
  | { id: string; message: string; type: "error"; unsupported: boolean };

export type { WorkerRequest, WorkerResponse };
