import type {
  DocumentLanguage,
  FileStageKey,
  ModelStageKey,
  RedactionResult,
} from "@repo/redact-core";

// The shape a pooled worker's `redact` task presents to `pool.exec`. Arguments are
// positional because workerpool spreads them, and the port is one of them rather than
// a side channel because a transfer list only moves objects the message itself
// reaches. The result is written unwrapped because workerpool settles the task with
// what the worker's promise resolved to, not with the promise.
type RedactTask = (
  file: File,
  language: DocumentLanguage | undefined,
  port: MessagePort,
) => RedactionResult;

// Emitted from inside a task through workerpool's event channel, which is why there
// is no job id on it: the pool already knows which task the event came from.
type ProgressEvent = { fraction: number; stage: FileStageKey; type: "progress" };

// Each job hands the model worker a fresh port rather than connecting once at startup,
// so a worker the pool kills and respawns needs no repair. The id is what lets the
// pool hang up on a job cancelled before any worker ever received its half.
type ConnectRequest = { channel: string; port: MessagePort; type: "connect" };

type DisconnectRequest = { channel: string; type: "disconnect" };

type ModelRequest = ConnectRequest | DisconnectRequest;

type ModelResponse = { fraction: number; stage: ModelStageKey; type: "model-progress" };

export type {
  ConnectRequest,
  DisconnectRequest,
  ModelRequest,
  ModelResponse,
  ProgressEvent,
  RedactTask,
};
