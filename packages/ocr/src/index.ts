export { detectLanguage, LANGUAGES, traineddataFor } from "./languages.ts";
export type { DetectedLanguage, OcrLanguage } from "./languages.ts";
export { recognizeWords } from "./recognize.ts";
export type { Recognition, RecognisedWord } from "./recognize.ts";
export { readImageText } from "./read-image-text.ts";
export type { ImageReading } from "./read-image-text.ts";
export { assessReading, LEGIBLE_WORD, UNREADABLE_SHARE } from "./readable.ts";
export type { Readability } from "./readable.ts";
