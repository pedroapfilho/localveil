import type { ModelSpec } from "./catalog";

/* Ready means every file a load asks for is kept, so loading makes no request. Partial means some of
   the weights are kept but the model cannot load offline yet; loaded counts the weight bytes held
   against the catalogued size. */
type ModelStatus =
  | { state: "absent" }
  | { loaded: number; state: "partial"; total: number }
  | { bytes: number; path?: string; state: "ready" };

type ModelFiles = { tokenizer: object; tokenizerConfig: object; weights: Uint8Array };

type ModelStore = {
  downloadModel: (
    model: ModelSpec,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  inspectModel: (model: ModelSpec) => Promise<ModelStatus>;
  removeModel: (model: ModelSpec) => Promise<void>;
};

type OpenModel = (
  model: ModelSpec,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) => Promise<ModelFiles>;

export type { ModelFiles, ModelStatus, ModelStore, OpenModel };
