/* oxlint-disable anti-slop/no-module-mocking -- the tokenizer and ONNX runtime are wasm engines; the module seam is the only practical hermetic substitute */
import { PreTrainedTokenizer } from "@huggingface/transformers";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { DEFAULT_MODEL_ID, modelById, tokenizerUrls } from "./catalog";
import { memoryStore } from "./chunk-store-fixture";
import { createDetector } from "./detector";
import type { GlinerInput } from "./gliner-encode";
import type { EntityPrompt } from "./gliner-labels";
import { removeModel } from "./model-store-browser";

vi.mock("@huggingface/transformers", () => ({
  PreTrainedTokenizer: vi.fn(),
}));

vi.mock("#ort", () => ({
  createModelRunner: vi.fn(),
  fetchModelBytes: vi.fn(),
  pickDevice: vi.fn(),
}));

type Hit = { end: number; logit?: number; prompt: string; start: number };

type Respond = (words: Array<string>) => Array<Hit>;

const FIRST_WORD_ID = 10;

const createHarness = () => {
  const idsByWord = new Map<string, number>();
  const wordsById = new Map<number, string>();

  const encode = (text: string, options?: { add_special_tokens?: boolean }) => {
    if (options?.add_special_tokens === true) {
      return [1, 2];
    }

    let id = idsByWord.get(text);

    if (id === undefined) {
      id = FIRST_WORD_ID + idsByWord.size;
      idsByWord.set(text, id);
      wordsById.set(id, text);
    }

    return [id];
  };

  const wordsOf = (input: GlinerInput): Array<string> =>
    input.wordsMask.flatMap((mask, at) => {
      const id = input.inputIds[at];

      assert.isDefined(id, `no input id under word mask ${String(at)}`);

      return mask > 0 ? [wordsById.get(id) ?? ""] : [];
    });

  return { tokenizer: { encode }, wordsOf };
};

const { maxWidth: MAX_WIDTH, prompts: DEFAULT_PROMPTS } = modelById(DEFAULT_MODEL_ID);

type FakeTokenizer = ReturnType<typeof createHarness>["tokenizer"];

// The detector builds the tokenizer itself from the JSON it fetched, so the fake stands in for the class.
const fakeTokenizer = (tokenizer: FakeTokenizer) => {
  vi.mocked(PreTrainedTokenizer).mockImplementation(function build() {
    return tokenizer;
  } as never);
};

const JSON_FILE = new TextEncoder().encode("{}");

// Tokenizer files come back as JSON and the weights as bytes, the way both caches hand them over.
const serveFiles = () => {
  vi.mocked(fetchModelBytes).mockImplementation((url) =>
    Promise.resolve(url.endsWith(".json") ? JSON_FILE : new Uint8Array()),
  );
};

const fetchedUrls = () => vi.mocked(fetchModelBytes).mock.calls.map(([url]) => url);

const weightsFetched = () => fetchedUrls().filter((url) => url.endsWith(".onnx"));

const logitsFor = (
  counts: Array<number>,
  hits: Array<Array<Hit>>,
  prompts: ReadonlyArray<EntityPrompt> = DEFAULT_PROMPTS,
) => {
  const promptIndex = (prompt: string) => prompts.findIndex((entity) => entity.prompt === prompt);
  const entities = prompts.length;
  const positions = Math.max(...counts);
  const perItem = positions * MAX_WIDTH * entities;
  const data = new Float32Array(counts.length * perItem).fill(-50);

  hits.forEach((forItem, item) => {
    for (const hit of forItem) {
      const width = hit.end - hit.start;
      const at = (hit.start * MAX_WIDTH + width) * entities + promptIndex(hit.prompt);

      data[item * perItem + at] = hit.logit ?? 50;
    }
  });

  return { data, dims: [counts.length, positions, MAX_WIDTH, entities] };
};

const setup = (respond: Respond, prompts: ReadonlyArray<EntityPrompt> = DEFAULT_PROMPTS) => {
  const { tokenizer, wordsOf } = createHarness();

  fakeTokenizer(tokenizer);
  vi.mocked(pickDevice).mockResolvedValue("webgpu");
  serveFiles();

  const submitted: Array<GlinerInput> = [];

  const run = vi.fn((inputs: Array<GlinerInput>) => {
    submitted.push(...inputs);

    return Promise.resolve(
      logitsFor(
        inputs.map((input) => input.keptWords.length),
        inputs.map((input) => respond(wordsOf(input))),
        prompts,
      ),
    );
  });

  vi.mocked(createModelRunner).mockResolvedValue(run);

  return { run, submitted, wordsOf };
};

beforeEach(() => {
  vi.mocked(PreTrainedTokenizer).mockReset();
  vi.mocked(createModelRunner).mockReset();
  vi.mocked(fetchModelBytes).mockReset();
  vi.mocked(pickDevice).mockReset();
});

describe("createDetector", () => {
  it("chunks a long input into more than one model call", async () => {
    const { submitted } = setup(() => []);
    const detect = await createDetector({ maxWords: 3, overlapWords: 0 });

    await detect("aa bb cc dd ee");

    expect(submitted.length).toBeGreaterThan(1);
  });

  it("returns character offsets for the words the model flagged", async () => {
    const { submitted } = setup((words) =>
      words[0] === "mail" ? [{ end: 0, prompt: "email", start: 0 }] : [],
    );
    const detect = await createDetector();

    expect(await detect("mail me")).toEqual([
      { end: 4, label: "private_email", score: 1, start: 0 },
    ]);
    expect(submitted.length).toBe(1);
  });

  it("reports spans from a later chunk at absolute offsets", async () => {
    setup((words) => (words[0] === "cc" ? [{ end: 0, prompt: "person", start: 0 }] : []));

    const detect = await createDetector({ maxWords: 2, overlapWords: 0 });

    expect(await detect("aa bb cc dd")).toEqual([
      { end: 8, label: "private_person", score: 1, start: 6 },
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

    expect(spans.length).toBe(1);
    expect(spans[0]?.label).toBe("account_number");
  });

  it("never wakes the model for text with no words", async () => {
    const { run } = setup(() => []);
    const detect = await createDetector();

    expect(await detect("  \n\t")).toEqual([]);
    expect(run.mock.calls.length).toBe(0);
  });

  it("retries once on wasm when the webgpu load fails", async () => {
    const { tokenizer } = createHarness();

    fakeTokenizer(tokenizer);
    vi.mocked(pickDevice).mockResolvedValue("webgpu");
    serveFiles();
    vi.mocked(createModelRunner)
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockResolvedValueOnce(vi.fn(() => Promise.resolve(logitsFor([0], [[]]))));

    const stages: Array<string> = [];

    await createDetector({
      onProgress: (_fraction, stage) => {
        stages.push(stage);
      },
    });

    const urls = weightsFetched();

    expect(urls.at(0)).toContain("model_q4.onnx");
    expect(urls).toHaveLength(1);
    expect(vi.mocked(createModelRunner).mock.calls.map(([, device]) => device)).toEqual([
      "webgpu",
      "wasm",
    ]);
    expect(stages).toContain("model.slowDevice");
    expect(stages.at(-1)).toBe("model.ready");
  });

  it("rejects with the original failure visible when wasm also fails", async () => {
    const { tokenizer } = createHarness();

    fakeTokenizer(tokenizer);
    vi.mocked(pickDevice).mockResolvedValue("webgpu");
    serveFiles();
    vi.mocked(createModelRunner)
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockRejectedValueOnce(new Error("wasm unavailable"));

    await expect(createDetector()).rejects.toThrow(/no adapter/v);
  });

  it("does not swallow a load failure into an empty detection", async () => {
    const { tokenizer } = createHarness();

    fakeTokenizer(tokenizer);
    vi.mocked(pickDevice).mockResolvedValue("wasm");
    vi.mocked(fetchModelBytes).mockRejectedValue(new Error("network down"));

    await expect(createDetector()).rejects.toThrow(/network down/v);
  });
});

describe("choosing a model", () => {
  it("holds removal back until the worker has finished fetching its model files", async () => {
    setup(() => []);
    const started = Promise.withResolvers<undefined>();
    const weights = Promise.withResolvers<Uint8Array>();

    vi.mocked(fetchModelBytes).mockImplementation((url) => {
      if (url.endsWith(".json")) {
        return Promise.resolve(JSON_FILE);
      }

      started.resolve(undefined);

      return weights.promise;
    });

    const loading = createDetector({ resumableCache: true });

    await started.promise;
    let removed = false;
    const remove = async () => {
      await removeModel(modelById(DEFAULT_MODEL_ID), memoryStore());
      removed = true;
    };
    const removing = remove();

    await removeModel(modelById("gliner-pii-edge"), memoryStore());
    const removedDuringLoad = removed;

    weights.resolve(new Uint8Array());
    await Promise.all([loading, removing]);

    expect(removedDuringLoad).toBe(false);
    expect(removed).toBe(true);
  });

  it("loads the default model's tokenizer and weights when none is named", async () => {
    setup(() => []);

    await createDetector();

    const model = modelById(DEFAULT_MODEL_ID);

    expect(fetchedUrls()).toEqual(expect.arrayContaining(tokenizerUrls(model)));
    expect(weightsFetched()).toEqual([
      expect.stringContaining(`${model.repo}/resolve/${model.revision}`),
    ]);
    expect(PreTrainedTokenizer).toHaveBeenCalledOnce();
  });

  it("asks for nothing outside the pinned revision, so a cached model loads offline", async () => {
    setup(() => []);

    await createDetector({ model: "gliner-pii-edge" });

    const { repo, revision } = modelById("gliner-pii-edge");

    expect(fetchedUrls().every((url) => url.includes(`${repo}/resolve/${revision}/`))).toBe(true);
  });

  it("loads the named model and asks it in its own vocabulary", async () => {
    const model = modelById("gliner-pii-base");
    const { submitted } = setup(
      (words) => (words[0] === "Ana" ? [{ end: 1, prompt: "name", start: 0 }] : []),
      model.prompts,
    );

    const detect = await createDetector({ model: "gliner-pii-base" });
    const spans = await detect("Ana Lima signed");

    expect(fetchedUrls()).toEqual(expect.arrayContaining(tokenizerUrls(model)));
    expect(weightsFetched()).toEqual([expect.stringMatching(/model_quint8\.onnx$/v)]);
    expect(submitted.length).toBe(1);
    expect(spans).toEqual([{ end: 8, label: "private_person", score: 1, start: 0 }]);
  });
});

describe("a token-level model", () => {
  it("builds no span pairs and joins each word's start, end and inside into a span", async () => {
    const model = modelById("gliner-pii-edge");
    const nameAt = model.prompts.findIndex((entity) => entity.prompt === "name");
    const { tokenizer, wordsOf } = createHarness();
    const submitted: Array<GlinerInput> = [];

    const run = vi.fn((inputs: Array<GlinerInput>) => {
      submitted.push(...inputs);

      const words = Math.max(...inputs.map((input) => input.keptWords.length));
      const entities = model.prompts.length;
      const data = new Float32Array(inputs.length * words * entities * 3).fill(-50);

      inputs.forEach((input, item) => {
        const text = wordsOf(input);
        const at = (word: number, role: number) =>
          ((item * words + word) * entities + nameAt) * 3 + role;

        if (text[0] === "Ana") {
          data[at(0, 0)] = 50;
          data[at(0, 2)] = 50;
          data[at(1, 1)] = 50;
          data[at(1, 2)] = 50;
        }
      });

      return Promise.resolve({ data, dims: [inputs.length, words, entities, 3] });
    });

    fakeTokenizer(tokenizer);
    vi.mocked(pickDevice).mockResolvedValue("wasm");
    serveFiles();
    vi.mocked(createModelRunner).mockResolvedValue(run);

    const detect = await createDetector({ model: "gliner-pii-edge" });
    const spans = await detect("Ana Lima signed");

    expect(submitted.every((input) => input.spanIdx.length === 0)).toBe(true);
    expect(spans).toEqual([{ end: 8, label: "private_person", score: 1, start: 0 }]);
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
    const { submitted } = setup(() => []);
    const detect = await createDetector();

    await detect("Pedro Silva went home");

    expect(submitted.length).toBe(1);
  });

  it("does not pay for a second pass over a lone acronym", async () => {
    const { submitted } = setup(() => []);
    const detect = await createDetector();

    await detect("2026-01-01 INFO user signed in");

    expect(submitted.length).toBe(1);
  });

  it("sends the second pass the shouted line rather than the whole chunk", async () => {
    const { submitted, wordsOf } = setup(() => []);
    const detect = await createDetector();

    await detect("an invoice\nPEDRO AFONSO\ntotal 210");

    const second = submitted.at(1);

    expect(second && wordsOf(second)).toEqual(["Pedro", "Afonso"]);
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
    setup(() => []);

    const detect = await createDetector();
    const spans = await detect("CPF 108.467.036-45 emitido");

    expect(spans).toEqual([{ end: 18, label: "account_number", score: 1, start: 4 }]);
  });

  it("leaves a number that fails its check digits alone", async () => {
    setup(() => []);

    const detect = await createDetector();

    expect(await detect("total 12345678901 units")).toEqual([]);
  });
});
