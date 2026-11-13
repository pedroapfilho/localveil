export { BROWSER_ACCEPT, nodeTypeOf } from "./formats/formats";

export { defaultDecisions } from "./pipeline/detections";

export { analyseFile, applyDecisions, overallProgress } from "./pipeline/redact-file";

export type {
  Analysis,
  Decisions,
  Detection,
  FileStageKey,
  RedactionResult,
  WarningKey,
} from "./pipeline/types";

export { isUnsupportedFile, UnsupportedFileError } from "./pipeline/unsupported-file-error";

export { createDetectClient, serveDetect } from "./transport/detect-rpc";

export type { EventPort } from "./transport/detect-rpc";

export { isProgressEvent, progressEvent } from "./transport/progress-event";

export type { ProgressEvent } from "./transport/progress-event";

export {
  ARCHIVE_NAME,
  archiveNames,
  buildZip,
  toArrayBuffer,
  uniqueFilename,
} from "./transport/zip";

export type { ZipEntry } from "./transport/zip";
