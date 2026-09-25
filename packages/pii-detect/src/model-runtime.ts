import type { Logits } from "./gliner-decode";
import type { GlinerInput } from "./gliner-encode";
import type { ResumableCache } from "./resumable-cache";

type ModelDevice = "wasm" | "webgpu";

type RunModel = (inputs: Array<GlinerInput>) => Promise<Logits>;

type FetchModelOptions = {
  cache?: ResumableCache;
  onProgress: (fraction: number) => void;
};

export type { FetchModelOptions, ModelDevice, RunModel };
