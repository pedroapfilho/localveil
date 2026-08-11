import { AutoTokenizer, env } from "@huggingface/transformers";
import type { ChunkSpans, Detect, ModelProgress, Span } from "@repo/redact-core";
import { describeError, mergeChunkSpans, patternSpans, serialiseDetect } from "@repo/redact-core";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { batchInputs } from "./batch-inputs.ts";
import { chunkWords } from "./chunk-words.ts";
import type { Logits } from "./gliner-decode.ts";
import { decodeSpans, suppressOverlaps } from "./gliner-decode.ts";
import type { GlinerInput, TokenFrame } from "./gliner-encode.ts";
import { encodeGlinerInput } from "./gliner-encode.ts";
import { ENTITY_PROMPTS } from "./gliner-labels.ts";
import { MODEL_FILE } from "./model-runtime.ts";
import type { ModelDevice } from "./model-runtime.ts";
import { purgeStaleModels } from "./purge-stale-models.ts";
import type { ResumableCache } from "./resumable-cache.ts";
import { createResumableCache } from "./resumable-cache.ts";
import type { Segment } from "./shouting.ts";
import { collectShouting, toSourceSpans } from "./shouting.ts";
import type { SourceWord } from "./split-words.ts";
import { splitWords } from "./split-words.ts";

type Job = {
  encoded: GlinerInput;
  offset: number;
  segments?: Array<Segment>;
  words: Array<SourceWord>;
};

const MODEL_ID = "onnx-community/gliner_multi_pii-v1";

const MODEL_REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";

const MAX_WIDTH = 12;

const MAX_WORDS = 280;
const OVERLAP_WORDS = 24;

// Batching costs time on native CPU rather than saving it, because onnxruntime-node already
// spreads one inference across every core. Measured on the eval corpus, darwin arm64:
// 2030 ms at 1, 2913 ms at 2, 3151 ms at 4, and the same ordering on uniform chunks with no
// shouting retries, so it is not padding waste. Raise it only against a measurement on a
// runtime that leaves cores idle between submissions.
const BATCH_SIZE = 1;

const BATCH_TOKENS = 4096;

// Detection returns everything down to here. What actually gets covered is decided later, by
// APPLY_SCORE in @repo/redact-core: at or above it a span is covered unless dismissed, below it
// the span is offered as a suggestion and covered only if somebody ticks it. Reading this far
// down is only affordable because nothing under the apply floor reaches a file on its own.
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

const installResumableCache = (report: ModelProgress): ResumableCache => {
  const cache = createResumableCache({
    onProgress: ({ loaded, name, total }) => {
      if (!isWeights(name) || total === 0) {
        return;
      }

      report(Math.min(loaded / total, 1), "model.downloading");
    },
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
    batchSize = BATCH_SIZE,
    maxWords = MAX_WORDS,
    minScore = MIN_SCORE,
    onProgress,
    overlapWords = OVERLAP_WORDS,
    resumableCache = "caches" in globalThis,
  } = options;

  const report: ModelProgress = (fraction, stage) => {
    onProgress?.(fraction, stage);
  };

  const cache = resumableCache ? installResumableCache(report) : undefined;
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

  if (device !== "webgpu") {
    report(0, "model.slowDevice");
  }

  const run = await load(device).catch((firstError: unknown) => {
    if (device === "wasm") {
      throw firstError;
    }

    // oxlint-disable-next-line eslint/no-console
    console.warn("Could not run the model on WebGPU, falling back to wasm", firstError);
    report(0, "model.slowDevice");

    return load("wasm").catch((wasmError: unknown) => {
      throw new Error(
        `Could not load ${MODEL_ID} on webgpu (${describeError(firstError)}) or wasm (${describeError(wasmError)})`,
        { cause: wasmError },
      );
    });
  });

  if (cache !== undefined) {
    await purgeStaleModels({
      keepFiles: [MODEL_FILE],
      revision: MODEL_REVISION,
    }).catch((error: unknown) => {
      // oxlint-disable-next-line eslint/no-console
      console.warn("Could not clear superseded model weights", error);
    });
  }

  report(1, "model.ready");

  const prompts = ENTITY_PROMPTS.map((entity) => entity.prompt);

  const encodeChunk = (sourceWords: Array<SourceWord>) => {
    const encoded = encodeGlinerInput({
      encodeWord,
      frame,
      maxWidth: MAX_WIDTH,
      prompts,
      words: sourceWords.map((word) => word.text),
    });

    return encoded.keptWords.length === 0 ? undefined : encoded;
  };

  const spansOf = (job: Job, logits: Logits, item: number): Array<Span> => {
    const found = suppressOverlaps(
      decodeSpans({
        entityCount: prompts.length,
        item,
        logits,
        threshold: minScore,
        wordCount: job.encoded.keptWords.length,
      }),
    );

    return found.map((candidate) => ({
      end: job.words[job.encoded.keptWords[candidate.end]].end,
      label: ENTITY_PROMPTS[candidate.entity].label,
      score: candidate.score,
      start: job.words[job.encoded.keptWords[candidate.start]].start,
    }));
  };

  const jobsFor = (text: string): Array<Job> => {
    const jobs: Array<Job> = [];

    for (const chunk of chunkWords(splitWords(text), maxWords, overlapWords)) {
      const encoded = encodeChunk(chunk.words);

      if (encoded !== undefined) {
        jobs.push({ encoded, offset: 0, words: chunk.words });
      }

      const shouting = collectShouting(text.slice(chunk.start, chunk.end));

      if (shouting.text.length === 0) {
        continue;
      }

      const words = splitWords(shouting.text);
      const shouted = encodeChunk(words);

      if (shouted !== undefined) {
        jobs.push({
          encoded: shouted,
          offset: chunk.start,
          segments: shouting.segments,
          words,
        });
      }
    }

    return jobs;
  };

  return serialiseDetect(async (text) => {
    const jobs = jobsFor(text);
    const batches = batchInputs(
      jobs.map((job) => job.encoded),
      batchSize,
      BATCH_TOKENS,
    );
    const parts: Array<ChunkSpans> = [];

    /* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
    for (const batch of batches) {
      const logits = await run(batch.map((at) => jobs[at].encoded));

      batch.forEach((at, item) => {
        const job = jobs[at];
        const spans = spansOf(job, logits, item);

        parts.push({
          offset: job.offset,
          spans: job.segments === undefined ? spans : toSourceSpans(spans, job.segments),
        });
      });
    }
    /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    return [...mergeChunkSpans(parts), ...patternSpans(text)];
  });
};

export { createDetector, MAX_WIDTH, MIN_SCORE, MODEL_ID };
export type { DetectorOptions };
