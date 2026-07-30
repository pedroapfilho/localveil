import { AutoTokenizer, env } from "@huggingface/transformers";
import type { ChunkSpans, Detect, ModelProgress, Span } from "@repo/redact-core";
import { describeError, mergeChunkSpans, patternSpans, serialiseDetect } from "@repo/redact-core";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { chunkWords } from "./chunk-words.ts";
import { decodeSpans, suppressOverlaps } from "./gliner-decode.ts";
import type { TokenFrame } from "./gliner-encode.ts";
import { encodeGlinerInput } from "./gliner-encode.ts";
import { ENTITY_PROMPTS } from "./gliner-labels.ts";
import { MODEL_FILE } from "./model-runtime.ts";
import type { ModelDevice } from "./model-runtime.ts";
import { purgeStaleModels } from "./purge-stale-models.ts";
import type { ResumableCache } from "./resumable-cache.ts";
import { createResumableCache } from "./resumable-cache.ts";
import { collectShouting, toSourceSpans } from "./shouting.ts";
import type { SourceWord } from "./split-words.ts";
import { splitWords } from "./split-words.ts";

const MODEL_ID = "onnx-community/gliner_multi_pii-v1";

// Unpinned, a download resumed across an update splices bytes from two revisions
// into one file. A commit id in the URL moves the cache key when the model moves.
const MODEL_REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";

// From the model's gliner_config.json: the longest span, in words, it can score.
const MAX_WIDTH = 12;

// The model was trained at 384 words per example; staying under it with room for
// the label prompt keeps every chunk in-distribution.
const MAX_WORDS = 280;
const OVERLAP_WORDS = 24;

// Redaction wants recall: a false span costs an unneeded box, a missed one leaks
// an identity. The checksum patterns below the model keep precision honest.
const MIN_SCORE = 0.35;

type DetectorOptions = {
  maxWords?: number;
  minScore?: number;
  onProgress?: ModelProgress;
  overlapWords?: number;
  // The cache below is built on the Cache API and IndexedDB, so a runtime with
  // neither turns it off and lets transformers.js keep the tokenizer its own way.
  resumableCache?: boolean;
};

const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/${MODEL_FILE}`;

// The weights are the download. The tokenizer and the config beside them are a few
// megabytes against nearly a gigabyte, and counting them meant every one of them ran
// the bar to full and back before the file anybody was waiting for had begun.
const isWeights = (name: string) => name.endsWith(`/${MODEL_FILE}`);

// transformers.js only writes a file to the cache once it is complete, so a refresh
// partway through throws the download away. Its cache hook runs before the fetch,
// so `match` is where the resumable download goes.
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
    maxWords = MAX_WORDS,
    minScore = MIN_SCORE,
    onProgress,
    overlapWords = OVERLAP_WORDS,
    // Installed blind, the hook would crash the first tokenizer fetch on any
    // runtime without the Cache API, Node included.
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

    // A very long file can hold more unique words than are worth remembering.
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

    // Swallowed, this made "why is my GPU not used" undiagnosable: the page only
    // said it was slow, never why.
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

  const inferSpans = async (sourceWords: Array<SourceWord>): Promise<Array<Span>> => {
    const encoded = encodeGlinerInput({
      encodeWord,
      frame,
      maxWidth: MAX_WIDTH,
      prompts,
      words: sourceWords.map((word) => word.text),
    });

    if (encoded.keptWords.length === 0) {
      return [];
    }

    const logits = await run(encoded);
    const found = suppressOverlaps(
      decodeSpans(logits, encoded.keptWords.length, prompts.length, minScore),
    );

    return found.map((candidate) => ({
      end: sourceWords[encoded.keptWords[candidate.end]].end,
      label: ENTITY_PROMPTS[candidate.entity].label,
      score: candidate.score,
      start: sourceWords[encoded.keptWords[candidate.start]].start,
    }));
  };

  // Serialised here rather than left to each caller: this function owns the session,
  // and two callers running through it at once is how a mid-range GPU runs out of
  // memory. A pool that had to remember to wrap it would eventually forget.
  return serialiseDetect(async (text) => {
    const chunks = chunkWords(splitWords(text), maxWords, overlapWords);

    // One inference at a time: a long file can produce hundreds of chunks, and
    // queueing them all would hold every intermediate tensor on the device at once.
    /* oxlint-disable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
    const parts = await chunks.reduce<Promise<Array<ChunkSpans>>>(async (pending, chunk) => {
      const collected = await pending;

      // The words carry absolute offsets, so these spans need no shift.
      collected.push({ offset: 0, spans: await inferSpans(chunk.words) });

      const shouting = collectShouting(text.slice(chunk.start, chunk.end));

      if (shouting.text.length > 0) {
        const found = await inferSpans(splitWords(shouting.text));

        collected.push({
          offset: chunk.start,
          spans: toSourceSpans(found, shouting.segments),
        });
      }

      return collected;
    }, Promise.resolve([]));
    /* oxlint-enable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    // A check digit is a fact the model can only guess at.
    return [...mergeChunkSpans(parts), ...patternSpans(text)];
  });
};

export { createDetector, MAX_WIDTH, MIN_SCORE, MODEL_ID };
export type { DetectorOptions };
