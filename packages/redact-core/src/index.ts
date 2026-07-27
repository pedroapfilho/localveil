export { chunkText } from "./chunk.ts";
export type { TextChunk } from "./chunk.ts";
export { mergeChunkSpans, mergeOverlappingRanges } from "./merge-spans.ts";
export type { ChunkSpans, Range } from "./merge-spans.ts";
export { RedactionError } from "./redaction-error.ts";
export { createRedactorRegistry } from "./registry.ts";
export type { RedactorRegistry } from "./registry.ts";
export type {
  Bbox,
  Detect,
  PiiLabel,
  PositionedWord,
  Progress,
  Rect,
  RedactionResult,
  Redactor,
  Span,
} from "./types.ts";
export { UnsupportedFileError } from "./unsupported-file-error.ts";
export { spansToRects } from "./rects.ts";
export { buildWordIndex } from "./word-index.ts";
export type { WordIndex, WordInput } from "./word-index.ts";
