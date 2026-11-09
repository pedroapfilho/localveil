import type { ModelLoadEvent } from "@repo/pii-detect/models";
import type { Analysis, Decisions, RedactionResult } from "@repo/redact-core";

type ApplyWork = { analysis: Analysis; decisions: Decisions };

// workerpool settles a call with what the method resolves to, so each is typed by that value.
type RedactWorker = {
  analyse: (file: File, port: MessagePort) => Analysis;
  apply: (file: File, work: ApplyWork, port: MessagePort) => RedactionResult;
};

type ConnectRequest = { channel: string; port: MessagePort; type: "connect" };

type DisconnectRequest = { channel: string; type: "disconnect" };

type ModelRequest = ConnectRequest | DisconnectRequest;

type ModelResponse = { event: ModelLoadEvent; type: "model-load" };

export type {
  ApplyWork,
  ConnectRequest,
  DisconnectRequest,
  ModelRequest,
  ModelResponse,
  RedactWorker,
};
