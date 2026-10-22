import type { WordInput } from "@repo/redact-core";
import { contextOf } from "@repo/redact-core";

import type { OcrLanguage } from "./languages";
import { languageOf } from "./languages";
import type { Recognition } from "./recognize";
import { recognizeWords } from "./recognize";

type Legibility = "blank" | "legible" | "unreadable";

type TextReading = {
  alternatives: Array<Array<WordInput>>;
  language: OcrLanguage;
  legibility: Legibility;
  words: Array<WordInput>;
};

type ReadText = (page: OffscreenCanvas, known?: OcrLanguage) => Promise<TextReading>;

type Recognise = (page: OffscreenCanvas, language: OcrLanguage) => Promise<Recognition>;

type Pass = Omit<TextReading, "alternatives"> & { confidence: number };

const PROBE = "en";

const LEGIBLE_WORD = 60;

const UNREADABLE_SHARE = 0.25;

const LUMINANCE_THRESHOLD = 120;

const legibilityOf = (read: number, legible: number): Legibility => {
  if (read === 0) {
    return "blank";
  }

  return (read - legible) / read > UNREADABLE_SHARE ? "unreadable" : "legible";
};

const assess = ({ confidence, words }: Recognition, language: OcrLanguage): Pass => {
  const legible: Array<WordInput> = [];

  for (const { bbox, confidence: wordConfidence, text } of words) {
    if (wordConfidence >= LEGIBLE_WORD) {
      legible.push({ bbox, text });
    }
  }

  return {
    confidence,
    language,
    legibility: legibilityOf(words.length, legible.length),
    words: legible,
  };
};

const textOf = ({ words }: Recognition) => words.map((word) => word.text).join(" ");

/* Nothing on an unread page says what language it is in, so English reads it first and a second
   pass runs only when that reading turns out to be in another language. */
const recogniseIn = async (
  recognise: Recognise,
  page: OffscreenCanvas,
  known: OcrLanguage | undefined,
) => {
  if (known !== undefined) {
    return assess(await recognise(page, known), known);
  }

  const probed = await recognise(page, PROBE);
  const language = languageOf(textOf(probed)) ?? PROBE;

  return assess(language === PROBE ? probed : await recognise(page, language), language);
};

const binarizePixels = (pixels: Uint8ClampedArray) => {
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];

    if (red === undefined || green === undefined || blue === undefined) {
      throw new RangeError(`RGBA pixel data ends mid-pixel at byte ${String(index)}`);
    }

    const value = 0.299 * red + 0.587 * green + 0.114 * blue < LUMINANCE_THRESHOLD ? 0 : 255;

    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
};

const binarized = (page: OffscreenCanvas) => {
  const pixels = contextOf(page).getImageData(0, 0, page.width, page.height);

  binarizePixels(pixels.data);

  const prepared = new OffscreenCanvas(page.width, page.height);

  contextOf(prepared).putImageData(pixels, 0, 0);

  return prepared;
};

const isBetter = (candidate: Pass, kept: Pass) =>
  candidate.words.length === kept.words.length
    ? candidate.confidence > kept.confidence
    : candidate.words.length > kept.words.length;

const readingOf = (
  { language, legibility, words }: Pass,
  passedOver: ReadonlyArray<Pass>,
): TextReading => ({
  alternatives: passedOver.map((other) => other.words),
  language,
  legibility,
  words,
});

/* A faint scan or a photographed card can come back mostly unreadable, and thresholding it to black
   and white before reading it again often recovers it. The pass not chosen comes back too: a value
   only that pass could read is still on the page and still has to be covered. */
const createTextReader =
  (recognise: Recognise): ReadText =>
  async (page, known) => {
    const first = await recogniseIn(recognise, page, known);

    if (first.legibility === "legible") {
      return readingOf(first, []);
    }

    const retry = await recogniseIn(recognise, binarized(page), known);

    return isBetter(retry, first) ? readingOf(retry, [first]) : readingOf(first, [retry]);
  };

const readText = createTextReader(recognizeWords);

export { createTextReader, readText };

export type { ReadText, Recognise, TextReading };
