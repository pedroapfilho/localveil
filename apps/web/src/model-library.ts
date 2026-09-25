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
  stoppable?: boolean;
};

type PickerDownload = {
  controller: AbortController;
  progress: number;
};

type ModelLibrary = {
  cancel: (id: ModelId) => void;
  download: (id: ModelId) => Promise<void>;
  entries: Partial<Record<ModelId, ModelEntry>>;
  refresh: (id?: ModelId) => Promise<void>;
  remove: (id: ModelId) => Promise<void>;
  reportWorkerProgress: (id: ModelId, fraction: number | undefined) => void;
  select: (id: ModelId) => void;
  selected: ModelId;
};

const warnStorageFailed = (action: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console -- a storage failure is recoverable, so it is surfaced in the console instead of thrown
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

const createModelLibrary = (store: ModelStore = BROWSER_STORE) =>
  create<ModelLibrary>((set, get) => {
    const downloads = new Map<ModelId, PickerDownload>();
    const workerProgress = new Map<ModelId, number>();

    const patch = (id: ModelId, change: Partial<ModelEntry>) => {
      set((state) => ({
        entries: { ...state.entries, [id]: { ...state.entries[id], ...change } },
      }));
    };

    const inspect = async (id: ModelId) => {
      try {
        patch(id, { status: await store.inspectModel(modelById(id)) });
      } catch (error) {
        // oxlint-disable-next-line eslint/no-console -- a storage failure is recoverable, so it is surfaced in the console instead of thrown
        console.warn(`Could not tell whether ${id} is downloaded`, error);
      }
    };

    // Either owner can finish first. The row stays active until both have released their progress.
    const publishProgress = (id: ModelId) => {
      const picker = downloads.get(id);
      const worker = workerProgress.get(id);

      patch(id, {
        progress: picker === undefined ? worker : Math.max(picker.progress, worker ?? 0),
        stoppable: picker !== undefined,
      });
    };

    return {
      cancel: (id) => {
        downloads.get(id)?.controller.abort();
      },
      download: async (id) => {
        if (downloads.has(id)) {
          throw new Error(`${id} is already downloading`);
        }

        const controller = new AbortController();
        const operation: PickerDownload = { controller, progress: 0 };

        downloads.set(id, operation);
        publishProgress(id);

        try {
          await store.downloadModel(
            modelById(id),
            (fraction) => {
              operation.progress = fraction;
              publishProgress(id);
            },
            controller.signal,
          );
        } finally {
          await inspect(id);
          downloads.delete(id);
          publishProgress(id);
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
      reportWorkerProgress: (id, fraction) => {
        if (fraction === undefined) {
          workerProgress.delete(id);
        } else {
          workerProgress.set(id, fraction);
        }

        publishProgress(id);
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
