import type { GlinerInput, Logits } from "./gliner-codec";

type ModelDevice = "wasm" | "webgpu";

type RunModel = (inputs: Array<GlinerInput>) => Promise<Logits>;

export type { ModelDevice, RunModel };
