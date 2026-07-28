import { pipeline } from "@huggingface/transformers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDetector } from "./detector.ts";

vi.mock("@huggingface/transformers", () => ({ env: {}, pipeline: vi.fn() }));

const pipelineMock = vi.mocked(pipeline);

type ClassifiedToken = { entity: string; index: number; score: number };

type Respond = (text: string) => Array<ClassifiedToken>;

// One token per character keeps the arithmetic in the expectations obvious: the
// token at index `i` covers exactly `[i, i + 1)` of the chunk it came from.
const stubClassifier = (respond: Respond, asBigInt = false) => {
  let pieces: Array<string> = [];

  const tokenizer = Object.assign(
    (text: string) => {
      // Code points are what this stub wants, so splitting emoji apart is the
      // point rather than the hazard the rule is guarding against.
      // oxlint-disable-next-line typescript/no-misused-spread
      pieces = [...text];

      const row = pieces.map((_piece, index) => (asBigInt ? BigInt(index) : index));

      return { input_ids: { tolist: () => [row] } };
    },
    { decode: (ids: Array<number>) => ids.map((id) => pieces[id] ?? "").join("") },
  );

  const call = vi.fn((text: string) => Promise.resolve(respond(text)));

  return Object.assign(call, { tokenizer });
};

const bioesPrefix = (index: number, count: number) => {
  if (count === 1) {
    return "S";
  }

  if (index === 0) {
    return "B";
  }

  return index === count - 1 ? "E" : "I";
};

const tokensFor = (label: string, count: number): Array<ClassifiedToken> =>
  Array.from({ length: count }, (_entry, index) => ({
    entity: `${bioesPrefix(index, count)}-${label}`,
    index,
    score: 0.9,
  }));

const stubPipeline = (classifier: ReturnType<typeof stubClassifier>) => {
  pipelineMock.mockResolvedValue(classifier as never);
};

beforeEach(() => {
  pipelineMock.mockReset();
});

describe("createDetector", () => {
  it("chunks a long input into more than one pipeline call", async () => {
    const classifier = stubClassifier(() => []);

    stubPipeline(classifier);

    const detect = await createDetector();

    await detect("a".repeat(9000));

    expect(classifier.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives a span the character offsets the pipeline never reports", async () => {
    const classifier = stubClassifier(() => tokensFor("private_email", 4));

    stubPipeline(classifier);

    const detect = await createDetector();

    expect(await detect("mail me")).toEqual([
      { end: 4, label: "private_email", score: 0.9, start: 0 },
    ]);
  });

  it("reads the int64 input ids the tokenizer reports as bigints", async () => {
    const classifier = stubClassifier(() => tokensFor("private_email", 4), true);

    stubPipeline(classifier);

    const detect = await createDetector();

    expect(await detect("mail me")).toEqual([
      { end: 4, label: "private_email", score: 0.9, start: 0 },
    ]);
  });

  it("reports spans from a later chunk at absolute offsets", async () => {
    const classifier = stubClassifier((text) =>
      text.startsWith("second") ? tokensFor("private_email", 6) : [],
    );

    stubPipeline(classifier);

    const detect = await createDetector({ chunkSize: 10, overlap: 0 });
    const spans = await detect("0123456789second456");

    expect(spans).toEqual([{ end: 16, label: "private_email", score: 0.9, start: 10 }]);
  });

  it("drops a span whose score sits below the floor", async () => {
    const classifier = stubClassifier(() => [{ entity: "S-private_person", index: 0, score: 0.1 }]);

    stubPipeline(classifier);

    const detect = await createDetector({ minScore: 0.5 });

    expect(await detect("Jo")).toEqual([]);
  });

  it("refuses a classifier entry that carries no index", async () => {
    const classifier = stubClassifier(() => [
      { entity: "S-private_person", score: 0.9 } as unknown as ClassifiedToken,
    ]);

    stubPipeline(classifier);

    const detect = await createDetector();

    await expect(detect("Jo")).rejects.toThrow(/entity, index or score/v);
  });

  it("retries once on wasm when the webgpu load fails", async () => {
    pipelineMock
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockResolvedValueOnce(stubClassifier(() => []) as never);

    const stages: Array<string> = [];

    await createDetector({
      onProgress: (_fraction, stage) => {
        stages.push(stage);
      },
    });

    expect(pipelineMock.mock.calls.length).toBe(2);
    expect(pipelineMock.mock.calls.at(0)?.at(2)).toMatchObject({ device: "webgpu" });
    expect(pipelineMock.mock.calls.at(1)?.at(2)).toMatchObject({ device: "wasm" });
    expect(stages).toContain("model.slowDevice");
    expect(stages.at(-1)).toBe("model.ready");
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
