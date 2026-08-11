import type {
  Analysis,
  Decisions,
  DocumentLanguage,
  FileStageKey,
  ModelStageKey,
  RedactionResult,
} from "@repo/redact-core";

type AnalyseTask = (
  file: File,
  language: DocumentLanguage | undefined,
  port: MessagePort,
) => Analysis;

type ApplyWork = { analysis: Analysis; decisions: Decisions };

type ApplyTask = (file: File, work: ApplyWork, port: MessagePort) => RedactionResult;

type ProgressEvent = { fraction: number; stage: FileStageKey; type: "progress" };

type ConnectRequest = { channel: string; port: MessagePort; type: "connect" };

type DisconnectRequest = { channel: string; type: "disconnect" };

type ModelRequest = ConnectRequest | DisconnectRequest;

type ModelResponse = { fraction: number; stage: ModelStageKey; type: "model-progress" };

export type {
  AnalyseTask,
  ApplyTask,
  ApplyWork,
  ConnectRequest,
  DisconnectRequest,
  ModelRequest,
  ModelResponse,
  ProgressEvent,
};
