import { I18nProvider } from "@repo/i18n";
import { UnsupportedFileError } from "@repo/redact-core";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryPool } from "./memory-pool";
import { useModelLibrary } from "./model-library";
import { useJobStore } from "./store";
import { useRedaction } from "./use-redaction";

let memory = createMemoryPool();

const render = () => renderHook(() => useRedaction(memory.create), { wrapper: I18nProvider });

const submitted = (name: string) => {
  const { result } = render();

  act(() => {
    result.current.submit([new File(["x"], name, { type: "text/plain" })]);
  });

  const [job] = useJobStore.getState().jobs;

  assert.isDefined(job);

  return { id: job.id, result };
};

const play = (step: () => void) => {
  act(step);
};

beforeEach(() => {
  memory = createMemoryPool();
  useJobStore.setState({ jobs: [], modelLoading: false });
  useModelLibrary.setState({ entries: {}, selected: "gliner-multi-pii" });
  vi.spyOn(useModelLibrary.getState(), "refresh").mockResolvedValue();

  for (const kind of ["dismiss", "error", "loading", "success", "warning"] as const) {
    vi.spyOn(toast, kind).mockImplementation(() => "");
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRedaction", () => {
  it("runs one runner while the page is up, over the pool it is handed", () => {
    const { rerender, unmount } = render();

    rerender();

    expect(memory.created).toBe(1);

    unmount();

    expect(memory.destroyed).toBe(1);
  });

  it("passes each action through to the runner", () => {
    const { id, result } = submitted("a.txt");

    play(() => {
      memory.workers().onAnalysed(id, { detections: [], handle: undefined, warnings: [] });
      result.current.apply(id, ["a"]);
    });

    expect(memory.applied[0]?.decisions).toEqual({ covered: ["a"] });

    play(() => {
      result.current.remove(id);
    });

    expect(memory.cancelled).toEqual([id]);
    expect(useJobStore.getState().jobs).toEqual([]);
  });

  it("moves the model when the picker asks", () => {
    const { result } = render();

    play(() => {
      result.current.selectModel("gliner-pii-base");
    });

    expect(useModelLibrary.getState().selected).toBe("gliner-pii-base");
    expect(memory.models).toEqual(["gliner-multi-pii", "gliner-pii-base"]);
  });
});

describe("what the runner reports", () => {
  it("says which file could not be redacted", () => {
    const { id } = submitted("a.txt");

    play(() => {
      memory.workers().onFailed(id, new Error("out of memory"));
    });

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Could not redact a.txt.");
  });

  it("says which file is not supported", () => {
    const { id } = submitted("archive.zip");

    play(() => {
      memory.workers().onFailed(id, new UnsupportedFileError("archive.zip", "application/zip"));
    });

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "archive.zip is not a supported file type.",
    );
  });

  it("carries a download from its announcement to ready under one toast", () => {
    render();

    play(() => {
      memory.workers().onModelLoad({ downloaded: 0.4, kind: "loading" });
      memory.workers().onModelLoad({ kind: "ready" });
    });

    expect(toast.loading).toHaveBeenCalledExactlyOnceWith("Downloading the detection model", {
      id: "model-load",
    });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Detection model ready", {
      id: "model-load",
    });
  });

  it("turns that toast into the failure when the load fails", () => {
    render();

    play(() => {
      memory.workers().onModelLoad({ kind: "failed", reason: "no wasm" });
    });

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "The detection model could not be loaded. Reload the page to try again.",
      { id: "model-load" },
    );
  });

  it("dismisses that toast when the model changes under it", () => {
    const { result } = render();

    play(() => {
      memory.workers().onModelLoad({ downloaded: 0.1, kind: "loading" });
      result.current.selectModel("gliner-pii-base");
    });

    expect(toast.dismiss).toHaveBeenCalledWith("model-load");
  });

  it("says why the model is gone for good", () => {
    render();

    play(() => {
      memory.workers().onModelLost("The detection model stopped answering", true);
    });

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("The detection model stopped answering");
  });

  it("warns about a device without GPU acceleration", () => {
    render();

    play(() => {
      memory.workers().onModelLoad({ kind: "slow-device" });
    });

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      "Running without GPU acceleration, this will be slow.",
    );
  });
});
