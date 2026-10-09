import * as ort from "onnxruntime-web/webgpu";

import { toLogits } from "./gliner-decode";
import { toFeeds } from "./gliner-feeds";
import type { ModelDevice, RunModel } from "./model-runtime";

const pickDevice = async (): Promise<ModelDevice> => {
  if (!("gpu" in navigator)) {
    return "wasm";
  }

  const { gpu }: { gpu?: unknown } = navigator;

  if (typeof gpu !== "object" || gpu === null || !("requestAdapter" in gpu)) {
    return "wasm";
  }

  const { requestAdapter } = gpu;

  if (typeof requestAdapter !== "function") {
    return "wasm";
  }

  try {
    const adapter: unknown = await requestAdapter.call(gpu);

    return adapter === null || adapter === undefined ? "wasm" : "webgpu";
  } catch {
    return "wasm";
  }
};

const createModelRunner = async (bytes: Uint8Array, device: ModelDevice): Promise<RunModel> => {
  const session = await ort.InferenceSession.create(bytes, { executionProviders: [device] });
  const output = session.outputNames.at(0);

  if (output === undefined) {
    throw new TypeError("The model session reports no outputs");
  }

  return async (inputs) => {
    const results = await session.run(
      toFeeds(inputs, (type, data, dims) => new ort.Tensor(type, data, dims), session.inputNames),
    );

    return toLogits(results[output]);
  };
};

export { createModelRunner, pickDevice };
