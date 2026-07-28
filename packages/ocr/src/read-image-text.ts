import type { ImageLike } from "tesseract.js";

import type { OcrLanguage } from "./languages.ts";
import { detectLanguage } from "./languages.ts";
import type { Recognition } from "./recognize.ts";
import { recognizeWords } from "./recognize.ts";

type ImageReading = Recognition & { language: OcrLanguage };

type ReadOptions = {
  known?: OcrLanguage;
  onLanguage?: (language: OcrLanguage) => void;
};

const PROBE = "en";

// Acting on a weak guess costs a second OCR pass and can make the result worse, so
// an uncertain reading stays with what the probe already produced.
const MIN_CONFIDENCE = 0.5;

const textOf = (recognition: Recognition) => recognition.words.map((word) => word.text).join(" ");

// An image carries no text until it has been read once, so the language cannot be
// known in advance: read it in English, work out what it actually is, and read it
// again only when the answer is something else. A caller that already knows the
// language (a PDF whose text layer gave it away) skips the probe entirely.
const readImageText = async (
  image: ImageLike,
  options: ReadOptions = {},
): Promise<ImageReading> => {
  const { known, onLanguage } = options;

  if (known !== undefined) {
    onLanguage?.(known);

    return { ...(await recognizeWords(image, known)), language: known };
  }

  const probed = await recognizeWords(image, PROBE);
  const { confidence, language } = detectLanguage(textOf(probed), PROBE);

  if (language === PROBE || confidence < MIN_CONFIDENCE) {
    onLanguage?.(PROBE);

    return { ...probed, language: PROBE };
  }

  onLanguage?.(language);

  return { ...(await recognizeWords(image, language)), language };
};

export { readImageText };
export type { ImageReading, ReadOptions };
