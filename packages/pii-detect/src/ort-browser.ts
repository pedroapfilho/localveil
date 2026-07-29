import wasmFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
// The same subpath transformers.js imports, so both resolve to one module and one
// shared ort environment rather than two copies of the runtime.
import * as ort from "onnxruntime-web/webgpu";

import { readBytes } from "./fetch-bytes.ts";
import { toLogits } from "./gliner-decode.ts";
import { toFeeds } from "./gliner-feeds.ts";
import type { FetchModelOptions, ModelDevice, RunModel } from "./model-runtime.ts";

// q4 on both tiers, measured in a real browser against native scores: every
// dynamic-int8 file collapses on the wasm provider's integer kernels (a name
// scored 0.999 natively came back at 0.17), and the fp16-activation exports
// either cannot create a session here (the model's LSTM has no fp16 CPU kernel)
// or crush the person head on WebGPU (q4f16: 0.39). q4 keeps activations in
// fp32 with 4-bit weights and reproduced the native scores on both providers.
// One file for both tiers also makes the webgpu-to-wasm fallback a cache hit.
const MODEL_FILES: Record<ModelDevice, string> = {
  wasm: "model_q4.onnx",
  webgpu: "model_q4.onnx",
};

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
  // A bundled build serves its wasm from wherever the chunk landed, which after a
  // production build is nowhere; these are the emitted copies.
  ort.env.wasm.wasmPaths = { mjs: wasmFactoryUrl, wasm: wasmUrl };

  const session = await ort.InferenceSession.create(bytes, { executionProviders: [device] });
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
