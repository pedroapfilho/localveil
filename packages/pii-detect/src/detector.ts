import { env, pipeline } from "@huggingface/transformers";
import type { Detect, ModelProgress, Span } from "@repo/redact-core";
import { chunkText, mergeChunkSpans } from "@repo/redact-core";

import type { RawToken } from "./decode.ts";
import { decodeBioes } from "./decode.ts";
import { locateTokens } from "./offsets.ts";
import { createResumableCache } from "./resumable-cache.ts";

const CHUNK_OVERLAP = 200;
const CHUNK_SIZE = 4000;
const MIN_SCORE = 0.5;
const MODEL_ID = "openai/privacy-filter";

type Device = "wasm" | "webgpu";

type DetectorOptions = {
  chunkSize?: number;
  minScore?: number;
  onProgress?: ModelProgress;
  overlap?: number;
};

type ChunkSpans = { offset: number; spans: Array<Span> };

type ClassifiedToken = { entity: string; index: number; score: number };

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

// `input_ids` is an int64 tensor, so `tolist()` hands back bigints rather than the
// numbers the rest of this file counts in.
const toIdRow = (value: unknown): Array<number> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids: Array<number> = [];

  for (const entry of value) {
    if (typeof entry === "number") {
      ids.push(entry);
    } else if (typeof entry === "bigint") {
      ids.push(Number(entry));
    } else {
      return undefined;
    }
  }

  return ids;
};

const isClassifiedToken = (value: unknown): value is ClassifiedToken =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "entity") === "string" &&
  typeof Reflect.get(value, "index") === "number" &&
  typeof Reflect.get(value, "score") === "number";

// The weights are 809 MB, and transformers.js only writes a file to the cache once
// it has the whole thing, so a refresh partway through throws the download away.
// Its own cache hook runs before the fetch, which makes it the place to put a
// resumable one: `match` does the downloading, in ranges it can pick back up.
const installResumableCache = (report: ModelProgress) => {
  env.useCustomCache = true;
  env.customCache = createResumableCache({
    onProgress: (fraction) => {
      report(fraction, "model.downloading");
    },
  });
};

// No `progress_callback` on purpose. transformers.js fires it while reading a file
// back out of the cache too, so a reader whose model was already downloaded watched
// a download bar count to 100% for something that never touched the network. The
// resumable cache below reports only bytes it actually fetched.
const loadClassifier = (device: Device) =>
  pipeline("token-classification", MODEL_ID, { device, dtype: "q4f16" });

type TokenClassifier = Awaited<ReturnType<typeof loadClassifier>>;

const encodeIds = (classifier: TokenClassifier, text: string): Array<number> => {
  // The same options the pipeline tokenises with, so these ids line up with the
  // `index` every classified token carries.
  const rows: unknown = classifier
    .tokenizer(text, { padding: true, truncation: true })
    .input_ids.tolist();
  const ids = Array.isArray(rows) ? toIdRow(rows[0]) : undefined;

  if (ids === undefined) {
    throw new TypeError("The tokenizer did not return a row of input ids");
  }

  return ids;
};

const toRawTokens = (output: unknown, text: string, classifier: TokenClassifier) => {
  const tokens = Array.isArray(output) ? output.filter((item) => isClassifiedToken(item)) : [];

  if (Array.isArray(output) && tokens.length !== output.length) {
    throw new TypeError("The token classifier returned an entry without an entity, index or score");
  }

  const ranges = locateTokens(text, encodeIds(classifier, text), (ids) =>
    classifier.tokenizer.decode(ids, { skip_special_tokens: true }),
  );

  // NaN reaches `decodeBioes`, which rejects it loudly rather than letting an
  // unlocatable span be dropped.
  return tokens.map((token): RawToken => {
    const range = ranges[token.index];

    return {
      end: range?.end ?? Number.NaN,
      entity: token.entity,
      score: token.score,
      start: range?.start ?? Number.NaN,
    };
  });
};

const createDetector = async (options: DetectorOptions = {}): Promise<Detect> => {
  const {
    chunkSize = CHUNK_SIZE,
    minScore = MIN_SCORE,
    onProgress,
    overlap = CHUNK_OVERLAP,
  } = options;

  const report: ModelProgress = (fraction, stage) => {
    onProgress?.(fraction, stage);
  };

  installResumableCache(report);

  let device: Device = "webgpu";
  let classifier: TokenClassifier;

  try {
    classifier = await loadClassifier(device);
  } catch (webgpuError) {
    device = "wasm";
    report(0, "model.slowDevice");

    try {
      classifier = await loadClassifier(device);
    } catch (wasmError) {
      throw new Error(
        `Could not load ${MODEL_ID} on webgpu (${describeError(webgpuError)}) or wasm (${describeError(wasmError)})`,
        { cause: wasmError },
      );
    }
  }

  report(1, "model.ready");

  return async (text) => {
    const chunks = chunkText(text, chunkSize, overlap);

    // One inference at a time: a long file can produce hundreds of chunks, and
    // queueing them all would hold every intermediate tensor on the device at once.
    /* oxlint-disable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
    const parts = await chunks.reduce<Promise<Array<ChunkSpans>>>(async (pending, chunk) => {
      const collected = await pending;
      const output = await classifier(chunk.text, { ignore_labels: [] });
      const tokens = toRawTokens(output, chunk.text, classifier);

      collected.push({ offset: chunk.offset, spans: decodeBioes(tokens, minScore) });

      return collected;
    }, Promise.resolve([]));
    /* oxlint-enable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    return mergeChunkSpans(parts);
  };
};

export { createDetector, MIN_SCORE, MODEL_ID };
export type { DetectorOptions };
