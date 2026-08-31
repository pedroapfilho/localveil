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

const recognizeWords = async (image: ImageLike, language: OcrLanguage): Promise<Recognition> => {
  const worker = await workerFor(language);
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });

  return { confidence: data.confidence, words: wordsOf(data.blocks ?? []) };
};

export { recognizeWords };
export type { Recognition, RecognisedWord };
