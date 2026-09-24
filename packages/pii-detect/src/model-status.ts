import type { ModelSpec } from "./catalog";

type ModelStatus =
  | { state: "absent" }
  | { loaded: number; state: "partial"; total: number }
  | { bytes: number; path?: string; state: "ready" };

type ModelStore = {
  downloadModel: (
    model: ModelSpec,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  inspectModel: (model: ModelSpec) => Promise<ModelStatus>;
  removeModel: (model: ModelSpec) => Promise<void>;
};

export type { ModelStatus, ModelStore };
