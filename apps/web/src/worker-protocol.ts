import type { DocumentLanguage, FileStageKey, ModelStageKey, WarningKey } from "@repo/redact-core";

// `run` counts the attempts at one file. Changing a document's language sends the file
// back to the worker under the same id, and the attempt being replaced can be several
// stages deep when it is told to stop, so both sides carry the run number and the page
// drops anything answering for an attempt it has already replaced.
type RedactRequest = {
  file: File;
  id: string;
  language?: DocumentLanguage;
  run: number;
  type: "redact";
};

// Sent when a row leaves the page. Without it the worker carried on rendering and
// recognising every page of a file nobody was waiting for any more, with the rest of
// the queue stuck behind it.
type CancelRequest = { id: string; type: "cancel" };

type WorkerRequest = CancelRequest | RedactRequest;

// The model is loaded once for the page rather than per file, so its progress carries
// no id and no run.
type WorkerResponse =
  | {
      blob: Blob;
      id: string;
      redactionCount: number;
      run: number;
      type: "done";
      warnings: Array<WarningKey>;
    }
  | { fraction: number; id: string; run: number; stage: FileStageKey; type: "progress" }
  | { fraction: number; stage: ModelStageKey; type: "model-progress" }
  | { id: string; message: string; run: number; type: "error"; unsupported: boolean };

export type { CancelRequest, RedactRequest, WorkerRequest, WorkerResponse };
