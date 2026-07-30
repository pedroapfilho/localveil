import type { Logits } from "./gliner-decode.ts";
import type { GlinerInput } from "./gliner-encode.ts";
import type { ResumableCache } from "./resumable-cache.ts";

type ModelDevice = "wasm" | "webgpu";

// One file everywhere. The dynamic-int8 exports are a third of the size and score
// correctly on native CPU kernels, but they collapse on the browser's wasm integer
// kernels: a name scoring 0.999 natively came back at 0.17. The fp16-activation
// exports either cannot create a session (the model's LSTM has no fp16 CPU kernel) or
// crush the person head on WebGPU (q4f16: 0.39). q4 keeps activations in fp32 with
// 4-bit weights and reproduced native scores on every provider measured, so it is the
// only export that works in all three places.
//
// Carrying one file also means the CLI and the browser cannot disagree about a
// document, and it makes the WebGPU-to-wasm fallback a cache hit rather than a second
// download.
const MODEL_FILE = "model_q4.onnx";

type RunModel = (input: GlinerInput) => Promise<Logits>;

type FetchModelOptions = {
  cache?: ResumableCache;
  onProgress: (fraction: number) => void;
};

export { MODEL_FILE };
export type { FetchModelOptions, ModelDevice, RunModel };
