import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import * as ort from "onnxruntime-node";

import { readBytes } from "./fetch-bytes.ts";
import { toLogits } from "./gliner-decode.ts";
import { toFeeds } from "./gliner-feeds.ts";
import type { FetchModelOptions, ModelDevice, RunModel } from "./model-runtime.ts";

const CACHE_DIR = path.join(homedir(), ".cache", "localveil", "models");

// int8 here, unlike the browser runtime's q4: the native CPU integer kernels
// reproduce full-precision scores on this model where the browser's wasm ones
// collapse, and at 349 MB it is the smallest correct file.
const MODEL_FILES: Record<ModelDevice, string> = {
  wasm: "model_int8.onnx",
  webgpu: "model_int8.onnx",
};

// Node has no WebGPU; the CPU provider is this runtime's slow tier.
const pickDevice = (): Promise<ModelDevice> => Promise.resolve("wasm");

const cachePathFor = (url: string) => {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);

  return path.join(CACHE_DIR, `${digest}-${path.basename(new URL(url).pathname)}`);
};

const isMissingFile = (error: unknown) =>
  error instanceof Error && Reflect.get(error, "code") === "ENOENT";

// The download already succeeded and is being returned, so a failed write is not
// the reader's problem, but silence would hide a full disk from whoever debugs it.
const warnNotKept = (file: string, error: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not keep the model at ${file}`, error);
};

const keepOnDisk = async (file: string, bytes: Uint8Array) => {
  try {
    await mkdir(path.dirname(file), { recursive: true });

    // Written whole and renamed into place so a crash mid-write cannot leave a
    // truncated file that every later run would feed to the session.
    const part = `${file}.part-${globalThis.crypto.randomUUID()}`;

    await writeFile(part, bytes);
    await rename(part, file);
  } catch (error) {
    warnNotKept(file, error);
  }
};

const fetchModelBytes = async (url: string, options: FetchModelOptions): Promise<Uint8Array> => {
  const { onProgress } = options;
  const file = cachePathFor(url);

  const kept = await readFile(file).catch((error: unknown) => {
    if (isMissingFile(error)) {
      return undefined;
    }

    throw error;
  });

  if (kept !== undefined) {
    onProgress(1);

    return new Uint8Array(kept.buffer, kept.byteOffset, kept.byteLength);
  }

  const bytes = await readBytes(await fetch(url), onProgress);

  await keepOnDisk(file, bytes);

  return bytes;
};

const createModelRunner = async (bytes: Uint8Array, _device: ModelDevice): Promise<RunModel> => {
  const session = await ort.InferenceSession.create(bytes);
  const output = session.outputNames[0];

  if (output === undefined) {
    throw new TypeError("The model session reports no outputs");
  }

  return async (input) => {
    const results = await session.run(
      toFeeds(input, (type, data, dims) => new ort.Tensor(type, data, dims)),
    );

    return toLogits(results[output]);
  };
};

export { createModelRunner, fetchModelBytes, MODEL_FILES, pickDevice };
