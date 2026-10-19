import { PreTrainedTokenizer } from "@huggingface/transformers";
import type { Detect, Span } from "@repo/redact-core";
import { absorbNested, describeError, serialiseDetect, warnRecoverable } from "@repo/redact-core";

import { openModel } from "#model-store";
import { createModelRunner, pickDevice } from "#ort";

import { batchInputs } from "./batch-inputs";
import type { ModelId } from "./catalog";
import { DEFAULT_MODEL_ID, modelById } from "./catalog";
import { chunkWords } from "./chunk-words";
import type { GlinerInput } from "./gliner-codec";
import { createGlinerCodec } from "./gliner-codec";
import type { ModelLoadEvent } from "./model-lifecycle";
import type { ModelDevice } from "./model-runtime";
import type { ModelFiles } from "./model-status";
import { patternSpans } from "./patterns";
import { collectShouting, positionShouted } from "./shouting";
import { splitWords } from "./split-words";
import { tightenToVerified } from "./tighten";

const MAX_WORDS = 280;
const OVERLAP_WORDS = 24;

const CPU_BATCH = 1;
const GPU_BATCH = 4;

const BATCH_TOKENS = 4096;

const MIN_SCORE = 0.15;

/* Overlapping chunks and the shouted pass read the same words more than once, so a span nested in
   another of its label is folded into it, which keeps the stronger of the two scores. */
const mergeChunkSpans = (spans: Array<Span>) =>
  absorbNested(
    spans,
    (span) => span.label,
    (span) => span.score,
    (span, score) => ({ ...span, score }),
  ).toSorted((left, right) => left.start - right.start || left.end - right.end);

type ReportLoad = (event: ModelLoadEvent) => void;

type DetectorOptions = {
  batchSize?: number;
  maxWords?: number;
  minScore?: number;
  model?: ModelId;
  onLoad?: ReportLoad;
  overlapWords?: number;
  signal?: AbortSignal;
};

/* transformers.js checks whether tokenizer_config.json exists at `main` before it loads a tokenizer,
   whatever revision it is handed, so its loader makes an unpinned request on every load and fails
   outright with the network off. The model store fetches the two files instead, pinned like the
   weights and kept beside them. DebertaV2Tokenizer, the class two of the models name, differs from
   the base class only in returning token type ids, which GLiNER never takes. */
const loadTokenizer = (files: ModelFiles) =>
  new PreTrainedTokenizer(files.tokenizer, files.tokenizerConfig);

const loadRunner = async (
  bytes: Uint8Array,
  device: ModelDevice,
  repo: string,
  report: ReportLoad,
) => {
  try {
    return await createModelRunner(bytes, device);
  } catch (firstError) {
    if (device === "wasm") {
      throw firstError;
    }

    warnRecoverable("Could not run the model on WebGPU, falling back to wasm", firstError);
    report({ kind: "slow-device" });

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

const buildDetector = async (options: DetectorOptions, report: ReportLoad): Promise<Detect> => {
  const {
    batchSize,
    maxWords = MAX_WORDS,
    minScore = MIN_SCORE,
    model = DEFAULT_MODEL_ID,
    overlapWords = OVERLAP_WORDS,
    signal,
  } = options;

  const spec = modelById(model);
  const files = await openModel(
    spec,
    (downloaded) => {
      report({ downloaded, kind: "loading" });
    },
    signal,
  );
  const codec = createGlinerCodec(spec, loadTokenizer(files));

  const device = await pickDevice();
  const batching = batchSize ?? (device === "webgpu" ? GPU_BATCH : CPU_BATCH);

  if (device !== "webgpu") {
    report({ kind: "slow-device" });
  }

  // Building the session takes no signal, so a stop that lands before it is the last one honoured.
  signal?.throwIfAborted();

  const run = await loadRunner(files.weights, device, spec.repo, report);

  const jobsFor = (text: string): Array<GlinerInput> => {
    const jobs: Array<GlinerInput> = [];

    for (const chunk of chunkWords(splitWords(text), maxWords, overlapWords)) {
      const encoded = codec.encode(chunk.words);

      if (encoded !== undefined) {
        jobs.push(encoded);
      }

      const shouting = collectShouting(text.slice(chunk.start, chunk.end));

      if (shouting.text.length === 0) {
        continue;
      }

      const shouted = codec.encode(
        positionShouted(splitWords(shouting.text), shouting.segments, chunk.start),
      );

      if (shouted !== undefined) {
        jobs.push(shouted);
      }
    }

    return jobs;
  };

  return serialiseDetect(async (text) => {
    const found: Array<Span> = [];

    for (const batch of batchInputs(jobsFor(text), batching, BATCH_TOKENS)) {
      found.push(...codec.decode(batch, await run(batch), minScore));
    }

    return tightenToVerified(mergeChunkSpans(found), patternSpans(text), text);
  });
};

const ignore = () => undefined;

const createDetector = async ({
  onLoad = ignore,
  ...options
}: DetectorOptions = {}): Promise<Detect> => {
  onLoad({ kind: "loading" });

  try {
    const detect = await buildDetector(options, onLoad);

    onLoad({ kind: "ready" });

    return detect;
  } catch (error) {
    onLoad({ kind: "failed", reason: describeError(error) });

    throw error;
  }
};

export { createDetector };
export type { DetectorOptions };
