import type { ModelSpec, ModelStatus, ModelStore } from "@repo/pii-detect/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createModelLibrary, STORAGE_KEY } from "./model-library";

type Settle = { fail: (error: Error) => void; finish: () => void };

const fakeStore = (statuses: Record<string, ModelStatus> = {}) => {
  const downloads: Array<{ onProgress: (fraction: number) => void; settle: Settle }> = [];
  const removed: Array<string> = [];

  const store: ModelStore = {
    downloadModel: (
      model: ModelSpec,
      onProgress: (fraction: number) => void,
      signal?: AbortSignal,
    ) =>
      new Promise<void>((resolve, reject) => {
        downloads.push({ onProgress, settle: { fail: reject, finish: resolve } });
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The download was stopped", "AbortError"));
        });
        statuses[model.id] = { bytes: model.bytes, state: "ready" };
      }),
    inspectModel: (model: ModelSpec) => Promise.resolve(statuses[model.id] ?? { state: "absent" }),
    removeModel: (model: ModelSpec) => {
      removed.push(model.id);
      statuses[model.id] = { state: "absent" };

      return Promise.resolve();
    },
  };

  return { downloads, removed, store };
};

const latest = <T>(items: Array<T>) => {
  const item = items.at(-1);

  if (item === undefined) {
    throw new Error("Nothing was started");
  }

  return item;
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the chosen model", () => {
  it("starts on the default model when nothing was chosen before", () => {
    const library = createModelLibrary(fakeStore().store);

    expect(library.getState().selected).toBe("gliner-multi-pii");
  });

  it("remembers a choice across page loads", () => {
    createModelLibrary(fakeStore().store).getState().select("gliner-pii-base");

    expect(localStorage.getItem(STORAGE_KEY)).toBe("gliner-pii-base");
    expect(createModelLibrary(fakeStore().store).getState().selected).toBe("gliner-pii-base");
  });

  it("falls back to the default when the saved model is no longer catalogued", () => {
    localStorage.setItem(STORAGE_KEY, "gliner-retired");

    expect(createModelLibrary(fakeStore().store).getState().selected).toBe("gliner-multi-pii");
  });
});

describe("what is downloaded", () => {
  it("asks about every catalogued model", async () => {
    const library = createModelLibrary(
      fakeStore({ "gliner-multi-pii": { bytes: 10, state: "ready" } }).store,
    );

    await library.getState().refresh();

    expect(library.getState().entries).toEqual({
      "gliner-multi-pii": { status: { bytes: 10, state: "ready" } },
      "gliner-pii-base": { status: { state: "absent" } },
      "gliner-pii-edge": { status: { state: "absent" } },
    });
  });

  it("tracks a download's progress and reports it downloaded once it lands", async () => {
    const { downloads, store } = fakeStore();
    const library = createModelLibrary(store);
    const finished = library.getState().download("gliner-pii-base");

    await vi.waitFor(() => {
      expect(downloads).toHaveLength(1);
    });

    latest(downloads).onProgress(0.4);

    expect(library.getState().entries["gliner-pii-base"]?.progress).toBe(0.4);

    latest(downloads).settle.finish();
    await finished;

    expect(library.getState().entries["gliner-pii-base"]).toEqual({
      progress: undefined,
      status: { bytes: 196_757_174, state: "ready" },
      stoppable: false,
    });
  });

  it("stops showing progress when a download fails, and passes the failure on", async () => {
    const { downloads, store } = fakeStore();
    const library = createModelLibrary(store);
    const finished = library.getState().download("gliner-pii-base");

    await vi.waitFor(() => {
      expect(downloads).toHaveLength(1);
    });

    latest(downloads).settle.fail(new Error("offline"));

    await expect(finished).rejects.toThrow("offline");
    expect(library.getState().entries["gliner-pii-base"]?.progress).toBeUndefined();
  });

  it("stops a download it started and lets the failure through as an abort", async () => {
    const { downloads, store } = fakeStore();
    const library = createModelLibrary(store);
    const finished = library.getState().download("gliner-pii-base");

    await vi.waitFor(() => {
      expect(downloads).toHaveLength(1);
    });

    expect(library.getState().entries["gliner-pii-base"]?.stoppable).toBe(true);

    library.getState().cancel("gliner-pii-base");

    await expect(finished).rejects.toThrow(/stopped/v);
    expect(library.getState().entries["gliner-pii-base"]).toMatchObject({
      progress: undefined,
      stoppable: false,
    });
  });

  it("does not offer to stop a download the model worker is running", () => {
    const library = createModelLibrary(fakeStore().store);

    library.getState().reportProgress("gliner-pii-base", 0.2);

    expect(library.getState().entries["gliner-pii-base"]).toEqual({ progress: 0.2 });
  });

  it("removes a model and reports it gone", async () => {
    const { removed, store } = fakeStore({ "gliner-pii-base": { bytes: 5, state: "ready" } });
    const library = createModelLibrary(store);

    await library.getState().remove("gliner-pii-base");

    expect(removed).toEqual(["gliner-pii-base"]);
    expect(library.getState().entries["gliner-pii-base"]).toEqual({
      removing: false,
      status: { state: "absent" },
    });
  });
});
