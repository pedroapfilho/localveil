import { I18nProvider } from "@repo/i18n";
import type { ModelId } from "@repo/pii-detect/models";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModelLibrary } from "./model-library";
import { useJobStore } from "./store";
import { useModelPicker } from "./use-model-picker";

const onSelect = vi.fn<(id: ModelId) => void>();

const render = () => renderHook(() => useModelPicker(onSelect), { wrapper: I18nProvider });

const download = (outcome: Promise<void>) => {
  vi.spyOn(useModelLibrary.getState(), "download").mockReturnValue(outcome);
};

beforeEach(() => {
  onSelect.mockClear();
  localStorage.clear();
  useJobStore.getState().reset();
  useModelLibrary.setState({ entries: {}, selected: "gliner-multi-pii" });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useModelPicker", () => {
  it("says a stopped download will resume rather than calling it a failure", async () => {
    download(Promise.reject(new DOMException("stopped", "AbortError")));

    const { result } = render();

    await act(async () => {
      result.current.onDownload("gliner-pii-base");
      await Promise.resolve();
    });

    expect(toast.info).toHaveBeenCalledWith(
      "GLiNER PII base stopped downloading. It picks up where it left off next time.",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports a download that failed for any other reason", async () => {
    download(Promise.reject(new TypeError("offline")));

    const { result } = render();

    await act(async () => {
      result.current.onDownload("gliner-pii-base");
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith("Could not download GLiNER PII base.");
  });

  it("reads as busy while a file is still reaching the model", () => {
    useJobStore.getState().addFiles([new File(["x"], "a.txt")]);

    const { result } = render();

    expect(result.current.busy).toBe(true);
  });

  it("hands a chosen model to whoever switches it", () => {
    const { result } = render();

    act(() => {
      result.current.onSelect("gliner-pii-edge");
    });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("gliner-pii-edge");
  });
});
