import * as ort from "onnxruntime-web/webgpu";

import { readBytes } from "./fetch-bytes.ts";
import { toLogits } from "./gliner-decode.ts";
import { toFeeds } from "./gliner-feeds.ts";
import type { FetchModelOptions, ModelDevice, RunModel } from "./model-runtime.ts";

const pickDevice = async (): Promise<ModelDevice> => {
  const gpu: unknown = Reflect.get(navigator, "gpu");

  if (typeof gpu !== "object" || gpu === null) {
    return "wasm";
  }

  const requestAdapter: unknown = Reflect.get(gpu, "requestAdapter");

  if (typeof requestAdapter !== "function") {
    return "wasm";
  }

  try {
    const adapter: unknown = await Reflect.apply(requestAdapter, gpu, []);

    return adapter === null || adapter === undefined ? "wasm" : "webgpu";
  } catch {
    return "wasm";
  }
};

const fetchModelBytes = async (url: string, options: FetchModelOptions): Promise<Uint8Array> => {
  const { cache, onProgress } = options;

  if (cache !== undefined) {
    const response = await cache.match(url);

    if (response === undefined) {
      throw new Error(`The model cache could not produce ${url}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  return readBytes(await fetch(url), onProgress);
};

const createModelRunner = async (bytes: Uint8Array, device: ModelDevice): Promise<RunModel> => {
  const session = await ort.InferenceSession.create(bytes, { executionProviders: [device] });
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
