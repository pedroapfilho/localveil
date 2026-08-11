import type { Logits } from "./gliner-decode.ts";
import type { GlinerInput } from "./gliner-encode.ts";
import type { ResumableCache } from "./resumable-cache.ts";

type ModelDevice = "wasm" | "webgpu";

const MODEL_FILE = "model_q4.onnx";

type RunModel = (inputs: Array<GlinerInput>) => Promise<Logits>;

type FetchModelOptions = {
  cache?: ResumableCache;
  onProgress: (fraction: number) => void;
};

export { MODEL_FILE };
export type { FetchModelOptions, ModelDevice, RunModel };
