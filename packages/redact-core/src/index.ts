export { isCovered } from "./covered.ts";
export { describeError } from "./describe-error.ts";
export {
  APPLY_SCORE,
  dedupeDetections,
  defaultDecisions,
  describeSpans,
  keptSpans,
} from "./detections.ts";
export { createDetectClient, serialiseDetect, serveDetect } from "./detect-rpc.ts";
export type { DetectRequest, DetectResponse, EventPort } from "./detect-rpc.ts";
export { absorbNested, mergeChunkSpans, mergeOverlappingRanges } from "./merge-spans.ts";
export type { ChunkSpans, Range } from "./merge-spans.ts";
export { redactFile } from "./redact-file.ts";
export { patternSpans } from "./patterns.ts";
export { spansForTokens, tokensFromSpans } from "./repeats.ts";
export type { PiiToken } from "./repeats.ts";
export { createRedactorRegistry } from "./registry.ts";
export type { RedactorRegistry } from "./registry.ts";
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
  RedactOptions,
  Redactor,
  Span,
  StageKey,
  WarningKey,
} from "./types.ts";
export { isUnsupportedFile, UnsupportedFileError } from "./unsupported-file-error.ts";
export { survivingSpans } from "./verify.ts";
export type { Survivor } from "./verify.ts";
export { spansToRects } from "./rects.ts";
export { tightenToVerified } from "./tighten.ts";
export { buildWordIndex } from "./word-index.ts";
export type { WordIndex, WordInput } from "./word-index.ts";
export { buildZip, toArrayBuffer, uniqueFilename } from "./zip.ts";
export type { ZipEntry } from "./zip.ts";
