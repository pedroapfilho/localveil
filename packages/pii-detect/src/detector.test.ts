import { AutoTokenizer } from "@huggingface/transformers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { createDetector, MAX_WIDTH } from "./detector.ts";
import type { GlinerInput } from "./gliner-encode.ts";
import { ENTITY_PROMPTS } from "./gliner-labels.ts";

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: { from_pretrained: vi.fn() },
  env: {},
}));

vi.mock("#ort", () => ({
  createModelRunner: vi.fn(),
  fetchModelBytes: vi.fn(),
  // Distinct names per device so the tests can see which tier was fetched.
  MODEL_FILES: { wasm: "model_int8.onnx", webgpu: "model_q4.onnx" },
  pickDevice: vi.fn(),
}));

// A hit names the words (inclusive) and the prompt that should claim them.
type Hit = { end: number; logit?: number; prompt: string; start: number };

type Respond = (words: Array<string>) => Array<Hit>;

const FIRST_WORD_ID = 10;

// One token per word, with a registry both directions: the runner stub reads the
// words back out of the encoded input, so tests can answer to text rather than ids.
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
    input.wordsMask.flatMap((mask, at) =>
      mask > 0 ? [wordsById.get(input.inputIds[at]) ?? ""] : [],
    );

  return { tokenizer: { encode }, wordsOf };
};

const promptIndex = (prompt: string) =>
  ENTITY_PROMPTS.findIndex((entity) => entity.prompt === prompt);

const logitsFor = (wordCount: number, hits: Array<Hit>) => {
  const entities = ENTITY_PROMPTS.length;
  const data = new Float32Array(wordCount * MAX_WIDTH * entities).fill(-50);

  for (const hit of hits) {
    const width = hit.end - hit.start;

    data[(hit.start * MAX_WIDTH + width) * entities + promptIndex(hit.prompt)] = hit.logit ?? 50;
  }

  return { data, dims: [1, wordCount, MAX_WIDTH, entities] };
};

const setup = (respond: Respond) => {
  const { tokenizer, wordsOf } = createHarness();

  vi.mocked(AutoTokenizer.from_pretrained).mockResolvedValue(tokenizer as never);
  vi.mocked(pickDevice).mockResolvedValue("webgpu");
  vi.mocked(fetchModelBytes).mockResolvedValue(new Uint8Array());

  const run = vi.fn((input: GlinerInput) => {
    const hits = respond(wordsOf(input));

    return Promise.resolve(logitsFor(input.keptWords.length, hits));
  });

  vi.mocked(createModelRunner).mockResolvedValue(run);

  return { run, wordsOf };
};

beforeEach(() => {
  vi.mocked(AutoTokenizer.from_pretrained).mockReset();
  vi.mocked(createModelRunner).mockReset();
  vi.mocked(fetchModelBytes).mockReset();
  vi.mocked(pickDevice).mockReset();
});

describe("createDetector", () => {
  it("chunks a long input into more than one model call", async () => {
    const { run } = setup(() => []);
    const detect = await createDetector({ maxWords: 3, overlapWords: 0 });

    await detect("aa bb cc dd ee");

    expect(run.mock.calls.length).toBeGreaterThan(1);
  });

  it("returns character offsets for the words the model flagged", async () => {
    const { run } = setup((words) =>
      words[0] === "mail" ? [{ end: 0, prompt: "email", start: 0 }] : [],
    );
    const detect = await createDetector();

    expect(await detect("mail me")).toEqual([
      { end: 4, label: "private_email", score: 1, start: 0 },
    ]);
    expect(run.mock.calls.length).toBe(1);
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
    expect(spans[0].label).toBe("account_number");
  });

  it("never wakes the model for text with no words", async () => {
    const { run } = setup(() => []);
    const detect = await createDetector();

    expect(await detect("  \n\t")).toEqual([]);
    expect(run.mock.calls.length).toBe(0);
  });

  it("retries once on wasm when the webgpu load fails", async () => {
    const { tokenizer } = createHarness();

    vi.mocked(AutoTokenizer.from_pretrained).mockResolvedValue(tokenizer as never);
    vi.mocked(pickDevice).mockResolvedValue("webgpu");
    vi.mocked(fetchModelBytes).mockResolvedValue(new Uint8Array());
    vi.mocked(createModelRunner)
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockResolvedValueOnce(vi.fn(() => Promise.resolve(logitsFor(0, []))));

    const stages: Array<string> = [];

    await createDetector({
      onProgress: (_fraction, stage) => {
        stages.push(stage);
      },
    });

    const urls = vi.mocked(fetchModelBytes).mock.calls.map(([url]) => url);

    expect(urls.at(0)).toContain("model_q4.onnx");
    expect(urls.at(1)).toContain("model_int8.onnx");
    expect(stages).toContain("model.slowDevice");
    expect(stages.at(-1)).toBe("model.ready");
  });

  it("rejects with the original failure visible when wasm also fails", async () => {
    const { tokenizer } = createHarness();

    vi.mocked(AutoTokenizer.from_pretrained).mockResolvedValue(tokenizer as never);
    vi.mocked(pickDevice).mockResolvedValue("webgpu");
    vi.mocked(fetchModelBytes).mockResolvedValue(new Uint8Array());
    vi.mocked(createModelRunner)
      .mockRejectedValueOnce(new Error("no adapter"))
      .mockRejectedValueOnce(new Error("wasm unavailable"));

    await expect(createDetector()).rejects.toThrow(/no adapter/v);
  });

  it("does not swallow a load failure into an empty detection", async () => {
    const { tokenizer } = createHarness();

    vi.mocked(AutoTokenizer.from_pretrained).mockResolvedValue(tokenizer as never);
    vi.mocked(pickDevice).mockResolvedValue("wasm");
    vi.mocked(fetchModelBytes).mockRejectedValue(new Error("network down"));

    await expect(createDetector()).rejects.toThrow(/network down/v);
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
    const { run } = setup(() => []);
    const detect = await createDetector();

    await detect("Pedro Silva went home");

    expect(run.mock.calls.length).toBe(1);
  });

  // An acronym is not a name, and treating one as shouting doubled every log file.
  it("does not pay for a second pass over a lone acronym", async () => {
    const { run } = setup(() => []);
    const detect = await createDetector();

    await detect("2026-01-01 INFO user signed in");

    expect(run.mock.calls.length).toBe(1);
  });

  it("sends the second pass the shouted line rather than the whole chunk", async () => {
    const { run, wordsOf } = setup(() => []);
    const detect = await createDetector();

    await detect("an invoice\nPEDRO AFONSO\ntotal 210");

    const second = run.mock.calls.at(1)?.at(0);

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
