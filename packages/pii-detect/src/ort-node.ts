import * as ort from "onnxruntime-node";

import { fetchKept } from "./disk-cache";
import { toLogits } from "./gliner-decode";
import { toFeeds } from "./gliner-feeds";
import type { FetchModelOptions, ModelDevice, RunModel } from "./model-runtime";

const pickDevice = (): Promise<ModelDevice> => Promise.resolve("wasm");

const fetchModelBytes = (url: string, options: FetchModelOptions): Promise<Uint8Array> =>
  fetchKept(url, options.onProgress);

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
