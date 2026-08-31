export { detectLanguage, LANGUAGES, traineddataFor } from "./languages";
export type { DetectedLanguage, OcrLanguage } from "./languages";
export { recognizeWords } from "./recognize";
export type { Recognition, RecognisedWord } from "./recognize";
export { readImageText } from "./read-image-text";
export type { ImageReading } from "./read-image-text";
export { assessReading, LEGIBLE_WORD, UNREADABLE_SHARE } from "./readable";
export type { Readability } from "./readable";
