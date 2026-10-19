export { analyseUnits, isAnalysedReading, keptSpans, redactionCount } from "./analysis";
export type { AnalysedReading } from "./analysis";
export { describeError } from "./describe-error";
export { APPLY_SCORE, defaultDecisions } from "./detections";
export { createDetectClient, serialiseDetect, serveDetect } from "./detect-rpc";
export type { DetectRequest, DetectResponse, EventPort } from "./detect-rpc";
export { absorbNested, mergeOverlappingRanges } from "./merge-spans";
export type { Range } from "./merge-spans";
export { contextOf, isPageSurface, paint, rectsFor, surfaceOf, uncovered } from "./page-surface";
export type { PageSurface } from "./page-surface";
export { redactFile } from "./redact-file";
export { isProgressEvent } from "./progress-event";
export type { ProgressEvent } from "./progress-event";
export { inReadingOrder } from "./reading-order";
export type {
  Analysis,
  ApplyRequest,
  Decisions,
  Detect,
  Detection,
  DocumentLanguage,
  FileProgress,
  FileStageKey,
  PiiLabel,
  RedactionResult,
  Redactor,
  Span,
  WarningKey,
  WordInput,
} from "./types";
export { isUnsupportedFile, UnsupportedFileError } from "./unsupported-file-error";
export { verifyOutput } from "./verify";
export { warnRecoverable } from "./warn-recoverable";
export { buildZip, toArrayBuffer, uniqueFilename } from "./zip";
export type { ZipEntry } from "./zip";
