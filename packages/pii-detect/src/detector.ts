import { PreTrainedTokenizer } from "@huggingface/transformers";
import type { Detect, ModelProgress, Span } from "@repo/redact-core";
import {
  describeError,
  mergeChunkSpans,
  patternSpans,
  serialiseDetect,
  tightenToVerified,
} from "@repo/redact-core";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { batchInputs } from "./batch-inputs";
import { withCacheLock } from "./cache-lock";
import type { ModelId, ModelSpec } from "./catalog";
import {
  DEFAULT_MODEL_ID,
  modelById,
  MODELS,
  revisionUrl,
  tokenizerUrls,
  weightsUrl,
} from "./catalog";
import type { ChunkStore } from "./chunk-store";
import { createIndexedDbChunkStore } from "./chunk-store";
import { chunkWords } from "./chunk-words";
import type { Logits } from "./gliner-decode";
import { decodeSpans, decodeTokenSpans, suppressOverlaps } from "./gliner-decode";
import type { GlinerInput, SpanWord, TokenFrame } from "./gliner-encode";
import { encodeGlinerInput } from "./gliner-encode";
import type { ModelDevice } from "./model-runtime";
import { purgeStaleModels } from "./purge-stale-models";
import type { ResumableCache } from "./resumable-cache";
import { createResumableCache } from "./resumable-cache";
import { settleAll } from "./settle-all";
import { collectShouting, positionShouted } from "./shouting";
import { splitWords } from "./split-words";

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
  model?: ModelId;
  onProgress?: ModelProgress;
  overlapWords?: number;

  resumableCache?: boolean;
};

const weightsCache = (report: ModelProgress, store: ChunkStore, weights: string): ResumableCache =>
  createResumableCache({
    onProgress: ({ loaded, name, total }) => {
      if (name !== weights || total === 0) {
        return;
      }

      report(Math.min(loaded / total, 1), "model.downloading");
    },
    store,
  });

const parseJson = (bytes: Uint8Array, url: string): object => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError(`${url} is not a JSON object`);
  }

  return parsed;
};

const ignoreProgress = () => undefined;

/* transformers.js checks whether tokenizer_config.json exists at `main` before it loads a tokenizer,
   whatever revision it is handed, so its loader makes an unpinned request on every load and fails
   outright with the network off. The two files are fetched here instead, pinned like the weights and
   kept in the same cache. DebertaV2Tokenizer, the class two of the models name, differs from the
   base class only in returning token type ids, which GLiNER never takes. */
const loadTokenizer = async (spec: ModelSpec, cache: ResumableCache | undefined) => {
  const [tokenizerJson, tokenizerConfig] = await settleAll(
    tokenizerUrls(spec).map((url) =>
      fetchModelBytes(url, { cache, onProgress: ignoreProgress }).then((bytes) =>
        parseJson(bytes, url),
      ),
    ),
  );

  return new PreTrainedTokenizer(tokenizerJson, tokenizerConfig);
};

type Tokenizer = PreTrainedTokenizer;

const frameOf = (tokenizer: Tokenizer): TokenFrame => {
  const frame = tokenizer.encode("", { add_special_tokens: true });

  if (frame.length !== 2) {
    throw new TypeError("The tokenizer did not frame an empty text with CLS and SEP");
  }

  return { cls: frame[0], sep: frame[1] };
};

const loadRunner = async (
  bytes: Uint8Array,
  device: ModelDevice,
  repo: string,
  report: ModelProgress,
) => {
  try {
    return await createModelRunner(bytes, device);
  } catch (firstError) {
    if (device === "wasm") {
      throw firstError;
    }

    // oxlint-disable-next-line eslint/no-console
    console.warn("Could not run the model on WebGPU, falling back to wasm", firstError);
    report(0, "model.slowDevice");

    try {
      return await createModelRunner(bytes, "wasm");
    } catch (wasmError) {
      throw new Error(
        `Could not load ${repo} on webgpu (${describeError(firstError)}) or wasm (${describeError(wasmError)})`,
        { cause: wasmError },
      );
    }
  }
};

const createDetector = async (options: DetectorOptions = {}): Promise<Detect> => {
  const {
    batchSize,
    maxWords = MAX_WORDS,
    minScore = MIN_SCORE,
    model = DEFAULT_MODEL_ID,
    onProgress,
    overlapWords = OVERLAP_WORDS,
    resumableCache = "caches" in globalThis,
  } = options;

  const report: ModelProgress = (fraction, stage) => {
    onProgress?.(fraction, stage);
  };

  const spec = modelById(model);
  const weights = weightsUrl(spec);
  const chunks = createIndexedDbChunkStore();
  const cache = resumableCache ? weightsCache(report, chunks, weights) : undefined;
  const loadFiles = async () => {
    const tokenizer = await loadTokenizer(spec, cache);
    // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- validate the small tokenizer before downloading the weights
    const bytes = await fetchModelBytes(weights, {
      cache,
      onProgress: (fraction) => {
        report(fraction, "model.downloading");
      },
    });

    return { bytes, tokenizer };
  };
  const { bytes, tokenizer } = await (cache === undefined
    ? loadFiles()
    : withCacheLock(revisionUrl(spec), "shared", loadFiles));
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

  const device = await pickDevice();
  const batching = batchSize ?? (device === "webgpu" ? GPU_BATCH : CPU_BATCH);

  if (device !== "webgpu") {
    report(0, "model.slowDevice");
  }

  const run = await loadRunner(bytes, device, spec.repo, report);

  if (cache !== undefined) {
    try {
      await purgeStaleModels({ models: MODELS, store: chunks });
    } catch (error) {
      // oxlint-disable-next-line eslint/no-console
      console.warn("Could not clear superseded model weights", error);
    }
  }

  report(1, "model.ready");

  const prompts = spec.prompts.map((entity) => entity.prompt);

  const encodeChunk = (words: Array<SpanWord>) => {
    const encoded = encodeGlinerInput({
      encodeWord,
      frame,
      maxWidth: spec.decoding === "span" ? spec.maxWidth : 0,
      prompts,
      words,
    });

    return encoded.keptWords.length === 0 ? undefined : encoded;
  };

  const spansOf = (input: GlinerInput, logits: Logits, item: number): Array<Span> => {
    const { keptWords } = input;
    const asked = {
      entityCount: prompts.length,
      item,
      logits,
      threshold: minScore,
      wordCount: keptWords.length,
    };
    const found = suppressOverlaps(
      spec.decoding === "span"
        ? decodeSpans(asked)
        : decodeTokenSpans({ ...asked, maxWidth: spec.maxWidth }),
    );

    return found.map((candidate) => {
      const first = keptWords[candidate.start];
      let last = keptWords[candidate.end];

      for (let at = candidate.end; at > candidate.start && last.line !== first.line; at -= 1) {
        last = keptWords[at - 1];
      }

      return {
        end: last.end,
        label: spec.prompts[candidate.entity].label,
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

export { createDetector, MIN_SCORE };
export type { DetectorOptions };
