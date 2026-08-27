import { AutoTokenizer, env } from "@huggingface/transformers";
import type { Detect, ModelProgress, Span } from "@repo/redact-core";
import {
  describeError,
  mergeChunkSpans,
  patternSpans,
  serialiseDetect,
  tightenToVerified,
} from "@repo/redact-core";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { batchInputs } from "./batch-inputs.ts";
import type { ChunkStore } from "./chunk-store.ts";
import { createIndexedDbChunkStore } from "./chunk-store.ts";
import { chunkWords } from "./chunk-words.ts";
import type { Logits } from "./gliner-decode.ts";
import { decodeSpans, suppressOverlaps } from "./gliner-decode.ts";
import type { GlinerInput, SpanWord, TokenFrame } from "./gliner-encode.ts";
import { encodeGlinerInput } from "./gliner-encode.ts";
import { ENTITY_PROMPTS } from "./gliner-labels.ts";
import { MODEL_FILE } from "./model-runtime.ts";
import type { ModelDevice } from "./model-runtime.ts";
import { purgeStaleModels } from "./purge-stale-models.ts";
import type { ResumableCache } from "./resumable-cache.ts";
import { createResumableCache } from "./resumable-cache.ts";
import { collectShouting, positionShouted } from "./shouting.ts";
import { splitWords } from "./split-words.ts";

const MODEL_ID = "onnx-community/gliner_multi_pii-v1";

const MODEL_REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";

const MAX_WIDTH = 12;

const MAX_WORDS = 280;
const OVERLAP_WORDS = 24;

const CPU_BATCH = 1;
const GPU_BATCH = 4;

const BATCH_TOKENS = 4096;

const MIN_SCORE = 0.15;

type DetectorOptions = {
  batchSize?: number;
  maxWords?: number;
  minScore?: number;
  onProgress?: ModelProgress;
  overlapWords?: number;

  resumableCache?: boolean;
};

const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/${MODEL_FILE}`;

const isWeights = (name: string) => name.endsWith(`/${MODEL_FILE}`);

const installResumableCache = (report: ModelProgress, store: ChunkStore): ResumableCache => {
  const cache = createResumableCache({
    onProgress: ({ loaded, name, total }) => {
      if (!isWeights(name) || total === 0) {
        return;
      }

      report(Math.min(loaded / total, 1), "model.downloading");
    },
    store,
  });

  env.useCustomCache = true;
  env.customCache = cache;

  return cache;
};

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

const frameOf = (tokenizer: Tokenizer): TokenFrame => {
  const frame = tokenizer.encode("", { add_special_tokens: true });

  if (frame.length !== 2) {
    throw new TypeError("The tokenizer did not frame an empty text with CLS and SEP");
  }

  return { cls: frame[0], sep: frame[1] };
};

const createDetector = async (options: DetectorOptions = {}): Promise<Detect> => {
  const {
    batchSize,
    maxWords = MAX_WORDS,
    minScore = MIN_SCORE,
    onProgress,
    overlapWords = OVERLAP_WORDS,
    resumableCache = "caches" in globalThis,
  } = options;

  const report: ModelProgress = (fraction, stage) => {
    onProgress?.(fraction, stage);
  };

  const chunks = createIndexedDbChunkStore();
  const cache = resumableCache ? installResumableCache(report, chunks) : undefined;
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION });
  const frame = frameOf(tokenizer);

  const encodeCache = new Map<string, Array<number>>();

  const encodeWord = (word: string) => {
    const cached = encodeCache.get(word);

    if (cached !== undefined) {
      return cached;
    }

    if (encodeCache.size > 50_000) {
      encodeCache.clear();
    }

    const ids = tokenizer.encode(word, { add_special_tokens: false });

    encodeCache.set(word, ids);

    return ids;
  };

  const onDownload = (fraction: number) => {
    report(fraction, "model.downloading");
  };

  const load = async (device: ModelDevice) => {
    const bytes = await fetchModelBytes(MODEL_URL, { cache, onProgress: onDownload });

    return createModelRunner(bytes, device);
  };

  const device = await pickDevice();
  const batching = batchSize ?? (device === "webgpu" ? GPU_BATCH : CPU_BATCH);

  if (device !== "webgpu") {
    report(0, "model.slowDevice");
  }

  const loadWithFallback = async () => {
    try {
      return await load(device);
    } catch (firstError) {
      if (device === "wasm") {
        throw firstError;
      }

      // oxlint-disable-next-line eslint/no-console
      console.warn("Could not run the model on WebGPU, falling back to wasm", firstError);
      report(0, "model.slowDevice");

      try {
        return await load("wasm");
      } catch (wasmError) {
        throw new Error(
          `Could not load ${MODEL_ID} on webgpu (${describeError(firstError)}) or wasm (${describeError(wasmError)})`,
          { cause: wasmError },
        );
      }
    }
  };

  const run = await loadWithFallback();

  if (cache !== undefined) {
    try {
      await purgeStaleModels({
        keepFiles: [MODEL_FILE],
        revision: MODEL_REVISION,
        store: chunks,
      });
    } catch (error) {
      // oxlint-disable-next-line eslint/no-console
      console.warn("Could not clear superseded model weights", error);
    }
  }

  report(1, "model.ready");

  const prompts = ENTITY_PROMPTS.map((entity) => entity.prompt);

  const encodeChunk = (words: Array<SpanWord>) => {
    const encoded = encodeGlinerInput({ encodeWord, frame, maxWidth: MAX_WIDTH, prompts, words });

    return encoded.keptWords.length === 0 ? undefined : encoded;
  };

  const spansOf = (input: GlinerInput, logits: Logits, item: number): Array<Span> => {
    const { keptWords } = input;
    const found = suppressOverlaps(
      decodeSpans({
        entityCount: prompts.length,
        item,
        logits,
        threshold: minScore,
        wordCount: keptWords.length,
      }),
    );

    return found.map((candidate) => {
      const first = keptWords[candidate.start];
      let last = keptWords[candidate.end];

      for (let at = candidate.end; at > candidate.start && last.line !== first.line; at -= 1) {
        last = keptWords[at - 1];
      }

      return {
        end: last.end,
        label: ENTITY_PROMPTS[candidate.entity].label,
        score: candidate.score,
        start: first.start,
      };
    });
  };

  const jobsFor = (text: string): Array<GlinerInput> => {
    const jobs: Array<GlinerInput> = [];

    for (const chunk of chunkWords(splitWords(text), maxWords, overlapWords)) {
      const encoded = encodeChunk(chunk.words);

      if (encoded !== undefined) {
        jobs.push(encoded);
      }

      const shouting = collectShouting(text.slice(chunk.start, chunk.end));

      if (shouting.text.length === 0) {
        continue;
      }

      const shouted = encodeChunk(
        positionShouted(splitWords(shouting.text), shouting.segments, chunk.start),
      );

      if (shouted !== undefined) {
        jobs.push(shouted);
      }
    }

    return jobs;
  };

  return serialiseDetect(async (text) => {
    const jobs = jobsFor(text);
    const batches = batchInputs(jobs, batching, BATCH_TOKENS);
    const found: Array<Span> = [];

    /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
    for (const batch of batches) {
      const inputs = batch.map((at) => jobs[at]);
      const logits = await run(inputs);

      inputs.forEach((input, item) => {
        found.push(...spansOf(input, logits, item));
      });
    }
    /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    return tightenToVerified(
      [...mergeChunkSpans([{ offset: 0, spans: found }]), ...patternSpans(text)],
      text,
    );
  });
};

export { createDetector, MAX_WIDTH, MIN_SCORE, MODEL_ID };
export type { DetectorOptions };
