import type { GlinerInput, Logits } from "./gliner-codec";

// Node runs the model on its native CPU; a browser runs it on WebGPU, or on wasm without one.
type ModelDevice = "cpu" | "wasm" | "webgpu";

type RunModel = (inputs: Array<GlinerInput>) => Promise<Logits>;

type ModelRuntime = {
  createModelRunner: (bytes: Uint8Array, device: ModelDevice) => Promise<RunModel>;
  pickDevice: () => Promise<ModelDevice>;
};

export type { ModelDevice, ModelRuntime, RunModel };
