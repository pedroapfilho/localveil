import type { Logits } from "./gliner-decode";
import type { GlinerInput } from "./gliner-encode";

type ModelDevice = "wasm" | "webgpu";

type RunModel = (inputs: Array<GlinerInput>) => Promise<Logits>;

export type { ModelDevice, RunModel };
