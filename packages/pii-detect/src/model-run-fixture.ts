import { vi } from "vitest";

import type { ModelSpec } from "./catalog";
import type { RunModel } from "./model-runtime";
import type { ModelFiles } from "./model-status";

type Hit = { end: number; logit?: number; prompt: string; start: number };

type Respond = (words: Array<string>) => Array<Hit>;

const SURE = 50;
const UNSURE = -50;

const START = 0;
const END = 1;
const INSIDE = 2;
const ROLES = 3;

const specialToken = (id: number, content: string) => ({
  content,
  id,
  lstrip: false,
  normalized: false,
  rstrip: false,
  single_word: false,
  special: true,
});

/* The detector builds a real tokenizer from these files. The fake model reads the words it is sent
   rather than their ids, so a vocabulary of CLS, SEP and the unknown token is enough. */
const MODEL_FILES: ModelFiles = {
  tokenizer: {
    added_tokens: [specialToken(0, "[UNK]"), specialToken(1, "[CLS]"), specialToken(2, "[SEP]")],
    decoder: null,
    model: {
      continuing_subword_prefix: "##",
      type: "WordPiece",
      unk_token: "[UNK]",
      vocab: { "[CLS]": 1, "[SEP]": 2, "[UNK]": 0 },
    },
    normalizer: null,
    post_processor: {
      pair: [],
      single: [
        { SpecialToken: { id: "[CLS]", type_id: 0 } },
        { Sequence: { id: "A", type_id: 0 } },
        { SpecialToken: { id: "[SEP]", type_id: 0 } },
      ],
      special_tokens: {
        "[CLS]": { id: "[CLS]", ids: [1], tokens: ["[CLS]"] },
        "[SEP]": { id: "[SEP]", ids: [2], tokens: ["[SEP]"] },
      },
      type: "TemplateProcessing",
    },
    pre_tokenizer: { type: "WhitespaceSplit" },
  },
  tokenizerConfig: {},
  weights: new Uint8Array(3),
};

/* respond flags words of each input by index and prompt, and the fake scores them in the layout
   the spec's graph emits, so a test names words instead of tensor positions. */
const fakeModelRun = (spec: ModelSpec, respond: Respond) => {
  const seen: Array<Array<string>> = [];
  const entities = spec.prompts.length;
  const span = spec.decoding === "span";
  const scoresPerWord = entities * (span ? spec.maxWidth : ROLES);

  const entityOf = (prompt: string) => {
    const at = spec.prompts.findIndex((entity) => entity.prompt === prompt);

    if (at === -1) {
      throw new RangeError(`${spec.repo} asks for no ${prompt}`);
    }

    return at;
  };

  const run = vi.fn<RunModel>((inputs) => {
    const texts = inputs.map((input) => input.keptWords.map((word) => word.text));
    const words = Math.max(...texts.map((text) => text.length));
    const data = new Float32Array(inputs.length * words * scoresPerWord).fill(UNSURE);

    seen.push(...texts);

    texts.forEach((text, item) => {
      const at = (word: number, score: number) => (item * words + word) * scoresPerWord + score;

      for (const { end, logit = SURE, prompt, start } of respond(text)) {
        const entity = entityOf(prompt);

        if (span) {
          data[at(start, (end - start) * entities + entity)] = logit;
          continue;
        }

        const role = (word: number, which: number) => at(word, entity * ROLES + which);

        data[role(start, START)] = logit;
        data[role(end, END)] = logit;

        for (let word = start; word <= end; word += 1) {
          data[role(word, INSIDE)] = logit;
        }
      }
    });

    return Promise.resolve({
      data,
      dims: span
        ? [inputs.length, words, spec.maxWidth, entities]
        : [inputs.length, words, entities, ROLES],
    });
  });

  return { run, seen };
};

export { fakeModelRun, MODEL_FILES };

export type { Respond };
