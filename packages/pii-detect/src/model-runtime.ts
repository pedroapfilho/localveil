import type { Logits } from "./gliner-decode.ts";
import type { GlinerInput } from "./gliner-encode.ts";
import type { ResumableCache } from "./resumable-cache.ts";

type ModelDevice = "wasm" | "webgpu";

type RunModel = (input: GlinerInput) => Promise<Logits>;

type FetchModelOptions = {
  cache?: ResumableCache;
  onProgress: (fraction: number) => void;
};

export type { FetchModelOptions, ModelDevice, RunModel };
