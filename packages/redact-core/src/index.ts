export { isCovered } from "./covered";
export { describeError } from "./describe-error";
export {
  APPLY_SCORE,
  dedupeDetections,
  defaultDecisions,
  describeSpans,
  keptSpans,
} from "./detections";
export { definedTerms, dropDefinedTerms } from "./defined-terms";
export { createDetectClient, serialiseDetect, serveDetect } from "./detect-rpc";
export type { DetectRequest, DetectResponse, EventPort } from "./detect-rpc";
export { absorbNested, mergeChunkSpans, mergeOverlappingRanges } from "./merge-spans";
export type { ChunkSpans, Range } from "./merge-spans";
export { redactFile } from "./redact-file";
export { patternSpans } from "./patterns";
export { inReadingOrder } from "./reading-order";
export { spansForTokens, tokensFromSpans } from "./repeats";
export type { PiiToken } from "./repeats";
export { createRedactorRegistry } from "./registry";
export type { RedactorRegistry } from "./registry";
export type {
  Analysis,
  ApplyRequest,
  Bbox,
  Decisions,
  Detect,
  Detection,
  DocumentLanguage,
  FileProgress,
  FileStageKey,
  ModelProgress,
  ModelStageKey,
  PiiLabel,
  PositionedWord,
  Rect,
  RedactionResult,
  Redactor,
  Span,
  StageKey,
  WarningKey,
} from "./types";
export { isUnsupportedFile, UnsupportedFileError } from "./unsupported-file-error";
export { survivingSpans } from "./verify";
export type { Survivor } from "./verify";
export { spansToRects } from "./rects";
export { tightenToVerified } from "./tighten";
export { buildWordIndex } from "./word-index";
export type { WordIndex, WordInput } from "./word-index";
export { buildZip, toArrayBuffer, uniqueFilename } from "./zip";
export type { ZipEntry } from "./zip";
