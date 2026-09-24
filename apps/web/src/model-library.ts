import type { ModelId, ModelStatus, ModelStore } from "@repo/pii-detect/models";
import {
  DEFAULT_MODEL_ID,
  downloadModel,
  inspectModel,
  isModelId,
  modelById,
  MODELS,
  removeModel,
} from "@repo/pii-detect/models";
import { create } from "zustand";

const STORAGE_KEY = "localveil.model";

type ModelEntry = {
  progress?: number;
  removing?: boolean;
  status?: ModelStatus;
};

type ModelLibrary = {
  download: (id: ModelId) => Promise<void>;
  entries: Partial<Record<ModelId, ModelEntry>>;
  refresh: (id?: ModelId) => Promise<void>;
  remove: (id: ModelId) => Promise<void>;
  reportProgress: (id: ModelId, fraction: number | undefined) => void;
  select: (id: ModelId) => void;
  selected: ModelId;
};

const warnStorageFailed = (action: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not ${action} the chosen model`, cause);
};

const readStoredModel = (): ModelId => {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);

    return stored !== null && isModelId(stored) ? stored : DEFAULT_MODEL_ID;
  } catch (error) {
    warnStorageFailed("read", error);

    return DEFAULT_MODEL_ID;
  }
};

const writeStoredModel = (id: ModelId) => {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, id);
  } catch (error) {
    warnStorageFailed("keep", error);
  }
};

const BROWSER_STORE: ModelStore = { downloadModel, inspectModel, removeModel };

/* One record per catalogued model. Progress comes from two places that can overlap, a download the
   user started from the picker and the model worker fetching weights for a dropped file; both write
   the same field, and the resumable cache's per-URL lock makes sure only one of them fetches. */
const createModelLibrary = (store: ModelStore = BROWSER_STORE) =>
  create<ModelLibrary>((set, get) => {
    const patch = (id: ModelId, change: Partial<ModelEntry>) => {
      set((state) => ({
        entries: { ...state.entries, [id]: { ...state.entries[id], ...change } },
      }));
    };

    const inspect = async (id: ModelId) => {
      try {
        patch(id, { status: await store.inspectModel(modelById(id)) });
      } catch (error) {
        // oxlint-disable-next-line eslint/no-console
        console.warn(`Could not tell whether ${id} is downloaded`, error);
      }
    };

    return {
      download: async (id) => {
        patch(id, { progress: 0 });

        try {
          await store.downloadModel(modelById(id), (fraction) => {
            patch(id, { progress: fraction });
          });
        } finally {
          patch(id, { progress: undefined });
          await inspect(id);
        }
      },
      entries: {},
      refresh: async (id) => {
        await Promise.all((id === undefined ? MODELS.map((model) => model.id) : [id]).map(inspect));
      },
      remove: async (id) => {
        patch(id, { removing: true });

        try {
          await store.removeModel(modelById(id));
        } finally {
          patch(id, { removing: false });
          await inspect(id);
        }
      },
      reportProgress: (id, fraction) => {
        patch(id, { progress: fraction });
      },
      select: (id) => {
        if (get().selected === id) {
          return;
        }

        writeStoredModel(id);
        set({ selected: id });
      },
      selected: readStoredModel(),
    };
  });

const useModelLibrary = createModelLibrary();

export { createModelLibrary, STORAGE_KEY, useModelLibrary };
export type { ModelEntry };
