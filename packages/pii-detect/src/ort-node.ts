import * as ort from "onnxruntime-node";

import { sessionRunner } from "./gliner-tensors";
import type { ModelRuntime } from "./model-runtime";

const pickDevice: ModelRuntime["pickDevice"] = () => Promise.resolve("cpu");

const createModelRunner: ModelRuntime["createModelRunner"] = async (bytes) =>
  sessionRunner(
    await ort.InferenceSession.create(bytes),
    (type, data, dims) => new ort.Tensor(type, data, dims),
  );

export { createModelRunner, pickDevice };
