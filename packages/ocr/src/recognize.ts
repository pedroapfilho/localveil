import type { WordInput } from "@repo/redact-core";
import type { Block, ImageLike, Word, Worker } from "tesseract.js";

import type { OcrLanguage } from "./languages.ts";
import { traineddataFor } from "./languages.ts";

type Recognition = {
  confidence: number;
  words: Array<WordInput>;
};

// Loading a language costs a traineddata download, so workers are kept and reused
// for as long as the page lives rather than spun up per image.
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

  return started;
};

const wordsOf = (blocks: Array<Block>) => {
  const collected: Array<WordInput> = [];

  const take = (word: Word) => {
    if (word.text.trim().length > 0) {
      collected.push({ bbox: word.bbox, text: word.text });
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

const releaseRecognizers = async () => {
  const running = [...workers.values()];

  workers.clear();

  await Promise.allSettled(
    running.map(async (pending) => {
      const worker = await pending;

      return worker.terminate();
    }),
  );
};

export { recognizeWords, releaseRecognizers };
export type { Recognition };
