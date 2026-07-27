import type { ProgressInfo } from "@huggingface/transformers";
import { pipeline } from "@huggingface/transformers";
import type { Detect, Progress, Span } from "@repo/redact-core";
import { chunkText, mergeChunkSpans } from "@repo/redact-core";

import type { RawToken } from "./decode.ts";
import { decodeBioes } from "./decode.ts";

const CHUNK_OVERLAP = 200;
const CHUNK_SIZE = 4000;
const MIN_SCORE = 0.5;
const MODEL_ID = "openai/privacy-filter";

type Device = "wasm" | "webgpu";

type DetectorOptions = {
  chunkSize?: number;
  minScore?: number;
  onProgress?: Progress;
  overlap?: number;
};

type ChunkSpans = { offset: number; spans: Array<Span> };

type ClassifierOutput = Array<{ end?: number; entity: string; score: number; start?: number }>;

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const loadClassifier = (device: Device, report: Progress) =>
  pipeline("token-classification", MODEL_ID, {
    device,
    dtype: "q4f16",
    progress_callback: (event: ProgressInfo) => {
      if (event.status === "progress_total") {
        report(event.progress / 100, "Downloading model");
      }
    },
  });

type TokenClassifier = Awaited<ReturnType<typeof loadClassifier>>;

// The pipeline types character offsets as optional; NaN reaches `decodeBioes`, which
// rejects it loudly rather than letting an unlocatable span be dropped.
const toRawTokens = (output: ClassifierOutput): Array<RawToken> =>
  output.map((item) => ({
    end: item.end ?? Number.NaN,
    entity: item.entity,
    score: item.score,
    start: item.start ?? Number.NaN,
  }));

const createDetector = async (options: DetectorOptions = {}): Promise<Detect> => {
  const {
    chunkSize = CHUNK_SIZE,
    minScore = MIN_SCORE,
    onProgress,
    overlap = CHUNK_OVERLAP,
  } = options;

  const report: Progress = (fraction, stage) => {
    onProgress?.(fraction, stage);
  };

  let device: Device = "webgpu";
  let classifier: TokenClassifier;

  try {
    classifier = await loadClassifier(device, report);
  } catch (webgpuError) {
    device = "wasm";
    report(0, "WebGPU unavailable, retrying on wasm");

    try {
      classifier = await loadClassifier(device, report);
    } catch (wasmError) {
      throw new Error(
        `Could not load ${MODEL_ID} on webgpu (${describeError(webgpuError)}) or wasm (${describeError(wasmError)})`,
        { cause: wasmError },
      );
    }
  }

  report(1, `Model ready on ${device}`);

  return async (text) => {
    const chunks = chunkText(text, chunkSize, overlap);

    // One inference at a time: a long file can produce hundreds of chunks, and
    // queueing them all would hold every intermediate tensor on the device at once.
    /* oxlint-disable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */
    const parts = await chunks.reduce<Promise<Array<ChunkSpans>>>(async (pending, chunk) => {
      const collected = await pending;
      const output = await classifier(chunk.text, { ignore_labels: [] });

      collected.push({ offset: chunk.offset, spans: decodeBioes(toRawTokens(output), minScore) });

      return collected;
    }, Promise.resolve([]));
    /* oxlint-enable react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await */

    return mergeChunkSpans(parts);
  };
};

export { createDetector, MIN_SCORE, MODEL_ID };
export type { DetectorOptions };
