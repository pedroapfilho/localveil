import type { ModelLoadEvent } from "@repo/pii-detect/models";
import type { Analysis, Decisions, RedactionResult } from "@repo/redact-core";

type AnalyseTask = (file: File, port: MessagePort) => Analysis;

type ApplyWork = { analysis: Analysis; decisions: Decisions };

type ApplyTask = (file: File, work: ApplyWork, port: MessagePort) => RedactionResult;

type ConnectRequest = { channel: string; port: MessagePort; type: "connect" };

type DisconnectRequest = { channel: string; type: "disconnect" };

type ModelRequest = ConnectRequest | DisconnectRequest;

type ModelResponse = { event: ModelLoadEvent; type: "model-load" };

export type {
  AnalyseTask,
  ApplyTask,
  ApplyWork,
  ConnectRequest,
  DisconnectRequest,
  ModelRequest,
  ModelResponse,
};
