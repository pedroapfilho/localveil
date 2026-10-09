import type { WordInput } from "@repo/redact-core";
import type { Block, ImageLike, Word, Worker } from "tesseract.js";

import type { OcrLanguage } from "./languages";
import { traineddataFor } from "./languages";

type RecognisedWord = WordInput & { confidence: number };

type Recognition = {
  confidence: number;
  words: Array<RecognisedWord>;
};

const workers = new Map<OcrLanguage, Promise<Worker>>();

const startWorker = async (language: OcrLanguage) => {
  const tesseract = await import("tesseract.js");

  return tesseract.createWorker(traineddataFor(language));
};

const workerFor = (language: OcrLanguage) => {
  const existing = workers.get(language);

  if (existing !== undefined) {
    return existing;
  }

  const started = startWorker(language);

  workers.set(language, started);

  // oxlint-disable-next-line promise/prefer-await-to-then -- eviction must not make callers wait
  started.catch(() => {
    if (workers.get(language) === started) {
      workers.delete(language);
    }
  });

  return started;
};

const wordsOf = (blocks: Array<Block>) => {
  const collected: Array<RecognisedWord> = [];

  const take = (word: Word) => {
    if (word.text.trim().length > 0) {
      collected.push({ bbox: word.bbox, confidence: word.confidence, text: word.text });
    }
  };

  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        line.words.forEach(take);
      }
    }
  }

  return collected;
};

/* tesseract.js unpacks a canvas only in its browser build; raw image bytes it reads the same way
   under Node, so the page goes over as a PNG. */
const pngOf = async (page: OffscreenCanvas) => {
  const encoded = await page.convertToBlob({ type: "image/png" });

  /* SAFETY: both builds' loaders copy any byte array with new Uint8Array, but ImageLike names only
     Node's Buffer, so the bytes are forced through unknown. */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- see the SAFETY note above
  return new Uint8Array(await encoded.arrayBuffer()) as unknown as ImageLike;
};

const recognizeWords = async (
  page: OffscreenCanvas,
  language: OcrLanguage,
): Promise<Recognition> => {
  const [worker, image] = await Promise.all([workerFor(language), pngOf(page)]);
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });

  return { confidence: data.confidence, words: wordsOf(data.blocks ?? []) };
};

export { recognizeWords };
export type { Recognition };
