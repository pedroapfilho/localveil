import * as ort from "onnxruntime-web/webgpu";

import { sessionRunner } from "./gliner-tensors";
import type { ModelRuntime } from "./model-runtime";

const pickDevice: ModelRuntime["pickDevice"] = async () => {
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

const createModelRunner: ModelRuntime["createModelRunner"] = async (bytes, device) =>
  sessionRunner(
    await ort.InferenceSession.create(bytes, { executionProviders: [device] }),
    (type, data, dims) => new ort.Tensor(type, data, dims),
  );

export { createModelRunner, pickDevice };
