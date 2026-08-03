import type {
  DocumentLanguage,
  FileStageKey,
  ModelStageKey,
  RedactionResult,
} from "@repo/redact-core";

type RedactTask = (
  file: File,
  language: DocumentLanguage | undefined,
  port: MessagePort,
) => RedactionResult;

type ProgressEvent = { fraction: number; stage: FileStageKey; type: "progress" };

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
