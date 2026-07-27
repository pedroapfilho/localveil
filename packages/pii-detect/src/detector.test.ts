import { pipeline } from "@huggingface/transformers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDetector } from "./detector.ts";

vi.mock("@huggingface/transformers", () => ({ pipeline: vi.fn() }));

const pipelineMock = vi.mocked(pipeline);

type Classifier = (text: string) => Promise<Array<unknown>>;

const stubPipeline = (classifier: Classifier) => {
  pipelineMock.mockResolvedValue(classifier as never);
};

beforeEach(() => {
  pipelineMock.mockReset();
});

describe("createDetector", () => {
  it("chunks a long input into more than one pipeline call", async () => {
    const classifier = vi.fn<Classifier>().mockResolvedValue([]);

    stubPipeline(classifier);

    const detect = await createDetector();

    await detect("a".repeat(9000));

    expect(classifier.mock.calls.length).toBeGreaterThan(1);
  });

  it("reports spans from a later chunk at absolute offsets", async () => {
    const classifier = vi.fn<Classifier>((text) =>
      Promise.resolve(
        text.startsWith("second")
          ? [{ end: 6, entity: "S-private_email", score: 0.9, start: 0 }]
          : [],
      ),
    );

    stubPipeline(classifier);

    const detect = await createDetector({ chunkSize: 10, overlap: 0 });
    const spans = await detect(`0123456789second456`);

    expect(spans).toEqual([{ end: 16, label: "private_email", score: 0.9, start: 10 }]);
  });

  it("retries once on wasm when the webgpu load fails", async () => {
    pipelineMock
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockResolvedValueOnce(vi.fn<Classifier>().mockResolvedValue([]) as never);

    const stages: Array<string> = [];

    await createDetector({
      onProgress: (_fraction, stage) => {
        stages.push(stage);
      },
    });

    expect(pipelineMock.mock.calls.length).toBe(2);
    expect(pipelineMock.mock.calls.at(0)?.at(2)).toMatchObject({ device: "webgpu" });
    expect(pipelineMock.mock.calls.at(1)?.at(2)).toMatchObject({ device: "wasm" });
    expect(stages.at(-1)).toContain("wasm");
  });

  it("rejects with the original failure visible when wasm also fails", async () => {
    pipelineMock
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockRejectedValueOnce(new Error("wasm unavailable"));

    await expect(createDetector()).rejects.toThrow(/no adapter/v);
  });

  it("does not swallow a load failure into an empty detection", async () => {
    pipelineMock.mockRejectedValue(new Error("network down"));

    await expect(createDetector()).rejects.toThrow(/network down/v);
  });
});
