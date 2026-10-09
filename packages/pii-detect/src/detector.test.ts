/* oxlint-disable anti-slop/no-module-mocking -- the ONNX runtime is a wasm engine and the model store holds the weights; the module seams are the only practical hermetic substitute */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openModel } from "#model-store";
import { createModelRunner, pickDevice } from "#ort";

import type { ModelId } from "./catalog";
import { DEFAULT_MODEL_ID, modelById } from "./catalog";
import { createDetector } from "./detector";
import type { ModelLoadEvent } from "./model-lifecycle";
import type { Respond } from "./model-run-fixture";
import { fakeModelRun, MODEL_FILES } from "./model-run-fixture";

vi.mock("#model-store", () => ({
  openModel: vi.fn(),
}));

vi.mock("#ort", () => ({
  createModelRunner: vi.fn(),
  pickDevice: vi.fn(),
}));

const openedRepos = () => vi.mocked(openModel).mock.calls.map(([model]) => model.repo);

const recordLoad = () => {
  const events: Array<ModelLoadEvent> = [];

  const onLoad = (event: ModelLoadEvent) => {
    events.push(event);
  };

  return { events, onLoad };
};

const setup = (respond: Respond = () => [], model: ModelId = DEFAULT_MODEL_ID) => {
  const fake = fakeModelRun(modelById(model), respond);

  vi.mocked(pickDevice).mockResolvedValue("webgpu");
  vi.mocked(openModel).mockResolvedValue(MODEL_FILES);
  vi.mocked(createModelRunner).mockResolvedValue(fake.run);

  return fake;
};

beforeEach(() => {
  vi.mocked(createModelRunner).mockReset();
  vi.mocked(openModel).mockReset();
  vi.mocked(pickDevice).mockReset();
});

describe("createDetector", () => {
  it("chunks a long input into more than one model call", async () => {
    const { seen } = setup();
    const detect = await createDetector({ maxWords: 3, overlapWords: 0 });

    await detect("aa bb cc dd ee");

    expect(seen).toEqual([
      ["aa", "bb", "cc"],
      ["dd", "ee"],
    ]);
  });

  it("returns character offsets for the words the model flagged", async () => {
    const { seen } = setup((words) =>
      words[0] === "mail" ? [{ end: 0, prompt: "email", start: 0 }] : [],
    );
    const detect = await createDetector();

    expect(await detect("mail me")).toEqual([
      { end: 4, label: "private_email", score: 1, start: 0 },
    ]);
    expect(seen).toHaveLength(1);
  });

  it("labels a span by the entity its prompt stands for", async () => {
    setup(() => [{ end: 0, prompt: "username", start: 0 }]);

    const detect = await createDetector();

    expect(await detect("jsmith")).toEqual([
      { end: 6, label: "private_person", score: 1, start: 0 },
    ]);
  });

  it("reports spans from a later chunk at absolute offsets", async () => {
    setup((words) => (words[0] === "cc" ? [{ end: 0, prompt: "person", start: 0 }] : []));

    const detect = await createDetector({ maxWords: 2, overlapWords: 0 });

    expect(await detect("aa bb cc dd")).toEqual([
      { end: 8, label: "private_person", score: 1, start: 6 },
    ]);
  });

  it("folds what overlapping chunks both find into the widest span at the strongest score", async () => {
    setup((words) =>
      words[0] === "aa"
        ? [{ end: 2, logit: 1, prompt: "person", start: 1 }]
        : [{ end: 0, logit: 3, prompt: "person", start: 0 }],
    );

    const detect = await createDetector({ maxWords: 3, overlapWords: 1 });

    expect(await detect("aa bb cc dd")).toEqual([
      { end: 8, label: "private_person", score: 1 / (1 + Math.exp(-3)), start: 3 },
    ]);
  });

  it("drops a span whose score sits below the floor", async () => {
    setup(() => [{ end: 0, logit: -1, prompt: "person", start: 0 }]);

    const detect = await createDetector({ minScore: 0.5 });

    expect(await detect("Jo")).toEqual([]);
  });

  it("keeps only the strongest of overlapping claims", async () => {
    setup(() => [
      { end: 1, logit: 3, prompt: "cpf", start: 0 },
      { end: 1, logit: 1, prompt: "phone number", start: 0 },
    ]);

    const detect = await createDetector();
    const spans = await detect("word pair");

    expect(spans.map((span) => span.label)).toEqual(["account_number"]);
  });

  it("never wakes the model for text with no words", async () => {
    const { run } = setup();
    const detect = await createDetector();

    expect(await detect("  \n\t")).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("retries once on wasm when the webgpu load fails", async () => {
    const { run } = setup();

    vi.mocked(createModelRunner)
      .mockReset()
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockResolvedValueOnce(run);

    const { events, onLoad } = recordLoad();

    await createDetector({ onLoad });

    expect(openModel).toHaveBeenCalledOnce();
    expect(vi.mocked(createModelRunner).mock.calls).toEqual([
      [MODEL_FILES.weights, "webgpu"],
      [MODEL_FILES.weights, "wasm"],
    ]);
    expect(events).toEqual([{ kind: "loading" }, { kind: "slow-device" }, { kind: "ready" }]);
  });

  it("rejects with the original failure visible when wasm also fails", async () => {
    setup();
    vi.mocked(createModelRunner)
      .mockReset()
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockRejectedValueOnce(new Error("wasm unavailable"));

    await expect(createDetector()).rejects.toThrow(/no adapter/v);
  });
});

describe("the model load", () => {
  it("carries the fraction downloaded while a fresh model arrives, then comes ready", async () => {
    setup();
    vi.mocked(openModel).mockImplementation((_model, onProgress) => {
      onProgress(0.25);
      onProgress(1);

      return Promise.resolve(MODEL_FILES);
    });
    const { events, onLoad } = recordLoad();

    await createDetector({ onLoad });

    expect(events).toEqual([
      { kind: "loading" },
      { downloaded: 0.25, kind: "loading" },
      { downloaded: 1, kind: "loading" },
      { kind: "ready" },
    ]);
  });

  it("loads a model it already keeps without any download", async () => {
    setup();
    const { events, onLoad } = recordLoad();

    await createDetector({ onLoad });

    expect(events).toEqual([{ kind: "loading" }, { kind: "ready" }]);
  });

  it("notes a device without a GPU and carries on to ready", async () => {
    setup();
    vi.mocked(pickDevice).mockResolvedValue("wasm");
    const { events, onLoad } = recordLoad();

    await createDetector({ onLoad });

    expect(events).toEqual([{ kind: "loading" }, { kind: "slow-device" }, { kind: "ready" }]);
  });

  it("fails with the reason, and rejects rather than detecting nothing", async () => {
    setup();
    vi.mocked(openModel).mockRejectedValue(new Error("network down"));
    const { events, onLoad } = recordLoad();

    await expect(createDetector({ onLoad })).rejects.toThrow(/network down/v);
    expect(events).toEqual([{ kind: "loading" }, { kind: "failed", reason: "network down" }]);
  });

  it("hands the store the stop, and builds no session once it lands", async () => {
    setup();
    const controller = new AbortController();

    vi.mocked(openModel).mockImplementation(() => {
      controller.abort();

      return Promise.resolve(MODEL_FILES);
    });

    await expect(createDetector({ signal: controller.signal })).rejects.toThrow(/abort/iv);
    expect(vi.mocked(openModel).mock.calls[0]?.[2]).toBe(controller.signal);
    expect(createModelRunner).not.toHaveBeenCalled();
  });

  it("opens the default model", async () => {
    setup();

    await createDetector();

    expect(openedRepos()).toEqual([modelById(DEFAULT_MODEL_ID).repo]);
  });

  it("loads the named model and asks it in its own vocabulary", async () => {
    const { seen } = setup(
      (words) => (words[0] === "Ana" ? [{ end: 1, prompt: "name", start: 0 }] : []),
      "gliner-pii-base",
    );

    const detect = await createDetector({ model: "gliner-pii-base" });
    const spans = await detect("Ana Lima signed");

    expect(openedRepos()).toEqual([modelById("gliner-pii-base").repo]);
    expect(seen).toHaveLength(1);
    expect(spans).toEqual([{ end: 8, label: "private_person", score: 1, start: 0 }]);
  });
});

describe("a token-level model", () => {
  it("joins the words the model marks as start, inside and end into one span", async () => {
    setup(
      (words) => (words[0] === "Ana" ? [{ end: 1, prompt: "name", start: 0 }] : []),
      "gliner-pii-edge",
    );

    const detect = await createDetector({ model: "gliner-pii-edge" });

    expect(await detect("Ana Lima signed")).toEqual([
      { end: 8, label: "private_person", score: 1, start: 0 },
    ]);
  });
});

describe("shouting text", () => {
  it("reads a chunk again in title case when it holds runs of capitals", async () => {
    setup((words) =>
      words.join(" ") === "Pedro Silva" ? [{ end: 1, prompt: "person", start: 0 }] : [],
    );

    const detect = await createDetector();

    expect(await detect("PEDRO SILVA")).toEqual([
      { end: 11, label: "private_person", score: 1, start: 0 },
    ]);
  });

  it("does not pay for a second pass when nothing is shouting", async () => {
    const { seen } = setup();
    const detect = await createDetector();

    await detect("Pedro Silva went home");

    expect(seen).toHaveLength(1);
  });

  it("does not pay for a second pass over a lone acronym", async () => {
    const { seen } = setup();
    const detect = await createDetector();

    await detect("2026-01-01 INFO user signed in");

    expect(seen).toHaveLength(1);
  });

  it("sends the second pass the shouted line rather than the whole chunk", async () => {
    const { seen } = setup();
    const detect = await createDetector();

    await detect("an invoice\nPEDRO AFONSO\ntotal 210");

    expect(seen.at(1)).toEqual(["Pedro", "Afonso"]);
  });

  it("places a span from the second pass back where the shouted line sits", async () => {
    setup((words) =>
      words.join(" ") === "Pedro Afonso" ? [{ end: 1, prompt: "person", start: 0 }] : [],
    );

    const detect = await createDetector();

    expect(await detect("an invoice\nPEDRO AFONSO\ntotal 210")).toEqual([
      { end: 23, label: "private_person", score: 1, start: 11 },
    ]);
  });

  it("cuts a span back when the model runs it across the join between two shouted lines", async () => {
    setup((words) =>
      words.join(" ") === "Rua Das Flores Ana Lima Souza"
        ? [{ end: 5, prompt: "person", start: 0 }]
        : [],
    );

    const detect = await createDetector();
    const [span] = await detect("RUA DAS FLORES\nquantity 4\nANA LIMA SOUZA");

    expect(span).toEqual({ end: 14, label: "private_person", score: 1, start: 0 });
  });

  it("keeps what the first pass found as well as what the second did", async () => {
    setup((words) => {
      if (words[0] === "PEDRO") {
        return [{ end: 0, prompt: "email", start: 0 }];
      }

      return words[0] === "Pedro" ? [{ end: 1, prompt: "person", start: 0 }] : [];
    });

    const detect = await createDetector();
    const spans = await detect("PEDRO AFONSO");

    expect(spans.map((span) => span.label)).toEqual(["private_email", "private_person"]);
  });
});

describe("patterns", () => {
  it("finds a checksummed identifier the model walked past", async () => {
    setup();

    const detect = await createDetector();
    const spans = await detect("CPF 108.467.036-45 emitido");

    expect(spans).toEqual([{ end: 18, label: "account_number", score: 1, start: 4 }]);
  });

  it("leaves a number that fails its check digits alone", async () => {
    setup();

    const detect = await createDetector();

    expect(await detect("total 12345678901 units")).toEqual([]);
  });

  it("trims a model span that only adds its label word, however sure the model is", async () => {
    setup((words) => (words[0] === "CPF" ? [{ end: 5, prompt: "cpf", start: 0 }] : []));

    const detect = await createDetector();

    expect(await detect("CPF 108.467.036-45 emitido")).toEqual([
      { end: 18, label: "account_number", score: 1, start: 4 },
    ]);
  });
});
