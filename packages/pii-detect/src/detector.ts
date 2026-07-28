import { env, pipeline } from "@huggingface/transformers";
import type { Detect, ModelProgress, Span } from "@repo/redact-core";
import { chunkText, mergeChunkSpans, patternSpans } from "@repo/redact-core";

import type { RawToken } from "./decode.ts";
import { decodeBioes } from "./decode.ts";
import { locateTokens } from "./offsets.ts";
import { createResumableCache } from "./resumable-cache.ts";
import { collectShouting, toSourceSpans } from "./shouting.ts";

const CHUNK_OVERLAP = 200;
const CHUNK_SIZE = 4000;
const MIN_SCORE = 0.5;
const MODEL_ID = "openai/privacy-filter";

// Unpinned, a download resumed across an update splices bytes from two revisions
// into one file. A commit id in the URL moves the cache key when the model moves.
const MODEL_REVISION = "7ffa9a043d54d1be65afb281eddf0ffbe629385b";

type Device = "wasm" | "webgpu";

type DetectorOptions = {
  chunkSize?: number;
  minScore?: number;
  onProgress?: ModelProgress;
  overlap?: number;
  // The cache below is built on the Cache API and IndexedDB, so a runtime with
  // neither turns it off and lets transformers.js keep the weights its own way.
  resumableCache?: boolean;
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

// transformers.js only writes a file to the cache once it has all 809 MB, so a
// refresh partway through throws the download away. Its cache hook runs before the
// fetch, so `match` is where the resumable download goes.
const installResumableCache = (report: ModelProgress) => {
  env.useCustomCache = true;
  env.customCache = createResumableCache({
    onProgress: (fraction) => {
      report(fraction, "model.downloading");
    },
  });
};

// No `progress_callback`: transformers.js fires it on cache reads too, so a reader
// whose model was already on disk watched a download bar for nothing.
const loadClassifier = (device: Device) =>
  pipeline("token-classification", MODEL_ID, {
    device,
    dtype: "q4f16",
    revision: MODEL_REVISION,
  });

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
    resumableCache = true,
  } = options;

  const report: ModelProgress = (fraction, stage) => {
    onProgress?.(fraction, stage);
  };

  if (resumableCache) {
    installResumableCache(report);
  }

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
    const spansOf = async (source: string) => {
      const output = await classifier(source, { ignore_labels: [] });

      return decodeBioes(toRawTokens(output, source, classifier), minScore);
    };

    const parts = await chunks.reduce<Promise<Array<ChunkSpans>>>(async (pending, chunk) => {
      const collected = await pending;

      collected.push({ offset: chunk.offset, spans: await spansOf(chunk.text) });

      const shouting = collectShouting(chunk.text);

      if (shouting.text.length > 0) {
        const found = await spansOf(shouting.text);

        collected.push({
          offset: chunk.offset,
          spans: toSourceSpans(found, shouting.segments),
        });
      }

      return collected;
    }, Promise.resolve([]));
    /* oxlint-enable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    // A check digit is a fact the model can only guess at.
    return [...mergeChunkSpans(parts), ...patternSpans(text)];
  };
};

export { createDetector, MIN_SCORE, MODEL_ID };
export type { DetectorOptions };
