export { analyseUnits, keptSpans } from "./analysis";

export { describeError } from "./describe-error";

export { APPLY_SCORE, defaultDecisions } from "./detections";

export { createDetectClient, serialiseDetect, serveDetect } from "./detect-rpc";

export type { EventPort } from "./detect-rpc";

export { absorbNested, mergeOverlappingRanges } from "./merge-spans";

export type { Range } from "./merge-spans";

export { contextOf, coverUnit, paint, scanOf, surfaceOf, surfaceUnits } from "./page-surface";

export type { PageSurface } from "./page-surface";

export { analyseFile, applyDecisions, overallProgress, redactFile } from "./redact-file";

export { isProgressEvent, progressEvent } from "./progress-event";

export type { ProgressEvent } from "./progress-event";

export { isPiiLabel, PII_LABELS } from "./labels";

export type { PiiLabel } from "./labels";

export { DOCUMENT_LANGUAGES, isDocumentLanguage } from "./languages";

export type { DocumentLanguage } from "./languages";

export { inReadingOrder } from "./reading-order";

export { MASK } from "./text";

export type {
  Analysis,
  Decisions,
  Detect,
  Detection,
  FileProgress,
  FileStageKey,
  Painted,
  RedactionResult,
  Redactor,
  Span,
  WarningKey,
  WordInput,
} from "./types";

export { isUnsupportedFile, UnsupportedFileError } from "./unsupported-file-error";

export { warnRecoverable } from "./warn-recoverable";

export { ARCHIVE_NAME, archiveNames, buildZip, toArrayBuffer, uniqueFilename } from "./zip";

export type { ZipEntry } from "./zip";
