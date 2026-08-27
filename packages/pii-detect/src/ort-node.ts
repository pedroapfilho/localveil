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

const pickDevice = (): Promise<ModelDevice> => Promise.resolve("wasm");

const cachePathFor = (url: string) => {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);

  return path.join(CACHE_DIR, `${digest}-${path.basename(new URL(url).pathname)}`);
};

const isMissingFile = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const warnNotKept = (file: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not keep the model at ${file}`, cause);
};

const keepOnDisk = async (file: string, bytes: Uint8Array) => {
  try {
    await mkdir(path.dirname(file), { recursive: true });

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

  const readKept = async () => {
    try {
      return await readFile(file);
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }

      throw error;
    }
  };

  const kept = await readKept();

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

  return async (inputs) => {
    const results = await session.run(
      toFeeds(inputs, (type, data, dims) => new ort.Tensor(type, data, dims)),
    );

    return toLogits(results[output]);
  };
};

export { createModelRunner, fetchModelBytes, pickDevice };
