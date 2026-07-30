import type { StageKey } from "@repo/redact-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDetector } from "./detector.ts";
import type { CacheProgress, ResumableCacheOptions } from "./resumable-cache.ts";
import { createResumableCache } from "./resumable-cache.ts";

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: { from_pretrained: vi.fn() },
  env: {},
}));

vi.mock("#ort", () => ({
  createModelRunner: vi.fn(),
  fetchModelBytes: vi.fn(),
  pickDevice: vi.fn(),
}));

vi.mock("./resumable-cache.ts", () => ({
  createResumableCache: vi.fn(() => ({ match: vi.fn(), put: vi.fn() })),
}));

const HOST = "https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/abc";

// The cache hook is installed at the very top of createDetector, so it is in hand well
// before the tokenizer the rest of the load would need.
const installedReporter = async () => {
  const reported: Array<{ fraction: number; stage: StageKey }> = [];

  await createDetector({
    onProgress: (fraction, stage) => {
      reported.push({ fraction, stage });
    },
    resumableCache: true,
  }).catch(() => undefined);

  const [options] = vi.mocked(createResumableCache).mock.calls.at(0) ?? [];

  return { onProgress: (options as ResumableCacheOptions).onProgress, reported };
};

const bytes = (name: string, loaded: number, total: number): CacheProgress => ({
  loaded,
  name,
  total,
});

describe("what the detector counts as the model download", () => {
  beforeEach(() => {
    vi.mocked(createResumableCache).mockClear();
  });

  it("reports the weights against their own size", async () => {
    const { onProgress, reported } = await installedReporter();

    onProgress?.(bytes(`${HOST}/onnx/model_q4.onnx`, 25, 100));

    expect(reported).toContainEqual({ fraction: 0.25, stage: "model.downloading" });
  });

  // Every small file finishing used to run the bar to full and back, because the total
  // was only ever the total of the files seen so far.
  it("says nothing for the tokenizer and the config beside it", async () => {
    const { onProgress, reported } = await installedReporter();

    const before = reported.length;

    onProgress?.(bytes(`${HOST}/tokenizer.json`, 100, 100));
    onProgress?.(bytes(`${HOST}/config.json`, 40, 40));

    expect(reported.length).toBe(before);
  });

  // A tier that is no longer the one being loaded may still be sitting in the cache
  // from an earlier revision, and purging it is not the download anybody is waiting on.
  it("says nothing for a weights file that is not the one being loaded", async () => {
    const { onProgress, reported } = await installedReporter();

    const before = reported.length;

    onProgress?.(bytes(`${HOST}/onnx/model_int8.onnx`, 50, 200));

    expect(reported.length).toBe(before);
  });

  it("ignores a file whose size the server never gave", async () => {
    const { onProgress, reported } = await installedReporter();

    const before = reported.length;

    onProgress?.(bytes(`${HOST}/onnx/model_q4.onnx`, 0, 0));

    expect(reported.length).toBe(before);
  });
});
