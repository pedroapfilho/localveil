/* oxlint-disable anti-slop/no-module-mocking -- the tokenizer and ONNX runtime are wasm engines; the module seam is the only practical hermetic substitute */
import { AutoTokenizer } from "@huggingface/transformers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createModelRunner, fetchModelBytes, pickDevice } from "#ort";

import { createDetector, MAX_WIDTH } from "./detector";
import type { GlinerInput } from "./gliner-encode";
import { ENTITY_PROMPTS } from "./gliner-labels";

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: { from_pretrained: vi.fn() },
  env: {},
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
    input.wordsMask.flatMap((mask, at) =>
      mask > 0 ? [wordsById.get(input.inputIds[at]) ?? ""] : [],
    );

  return { tokenizer: { encode }, wordsOf };
};

const promptIndex = (prompt: string) =>
  ENTITY_PROMPTS.findIndex((entity) => entity.prompt === prompt);

const logitsFor = (counts: Array<number>, hits: Array<Array<Hit>>) => {
  const entities = ENTITY_PROMPTS.length;
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

const setup = (respond: Respond) => {
  const { tokenizer, wordsOf } = createHarness();

  vi.mocked(AutoTokenizer.from_pretrained).mockResolvedValue(tokenizer as never);
  vi.mocked(pickDevice).mockResolvedValue("webgpu");
  vi.mocked(fetchModelBytes).mockResolvedValue(new Uint8Array());

  const submitted: Array<GlinerInput> = [];

  const run = vi.fn((inputs: Array<GlinerInput>) => {
    submitted.push(...inputs);

    return Promise.resolve(
      logitsFor(
        inputs.map((input) => input.keptWords.length),
        inputs.map((input) => respond(wordsOf(input))),
      ),
    );
  });

  vi.mocked(createModelRunner).mockResolvedValue(run);

  return { run, submitted, wordsOf };
};

beforeEach(() => {
  vi.mocked(AutoTokenizer.from_pretrained).mockReset();
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
      .mockResolvedValueOnce(vi.fn(() => Promise.resolve(logitsFor([0], [[]]))));

    const stages: Array<string> = [];

    await createDetector({
      onProgress: (_fraction, stage) => {
        stages.push(stage);
      },
    });

    const urls = vi.mocked(fetchModelBytes).mock.calls.map(([url]) => url);

    expect(urls.at(0)).toContain("model_q4.onnx");
    expect(urls.at(1)).toBe(urls.at(0));
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
