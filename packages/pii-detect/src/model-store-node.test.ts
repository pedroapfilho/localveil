import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelSpec } from "./catalog";
import { modelById, tokenizerUrls, weightsUrl } from "./catalog";
import { serveFiles, stopAt, urlOf, WEIGHTS_BODY } from "./model-store-fixture";
import { createNodeModelStore } from "./model-store-node";

const MODEL = modelById("gliner-pii-base");
const OTHER = modelById("gliner-multi-pii");
const [TOKENIZER, TOKENIZER_CONFIG] = tokenizerUrls(MODEL);
const WEIGHTS = weightsUrl(MODEL);
const EVERYTHING = [TOKENIZER, TOKENIZER_CONFIG, WEIGHTS];
const TOKENIZER_JSON = { model: {} };

const ignore = () => undefined;

const superseded = (model: ModelSpec): ModelSpec => ({ ...model, revision: "0".repeat(40) });

let directory = "";

const weightsPath = (model: ModelSpec) => {
  const url = weightsUrl(model);
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);

  return path.join(directory, `${digest}-${path.basename(new URL(url).pathname)}`);
};

const failFetch = (failing: string, failure: () => Promise<void>) => {
  const serve = fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (urlOf(input) === failing) {
      await failure();
    }

    return serve(input, init);
  });
};

// Storage can become unavailable after the network request began, even if the initial stat succeeded.
const refuseSavingAt = (url: string) => {
  failFetch(url, async () => {
    await rm(directory, { force: true, recursive: true });
    await writeFile(directory, "blocked");
  });
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "localveil-models-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(directory, { force: true, recursive: true });
});

describe("inspectModel on disk", () => {
  it("calls a model ready once its weights and tokenizer are all on disk", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);

    await store.downloadModel(MODEL, ignore);

    await expect(store.inspectModel(MODEL)).resolves.toEqual({
      bytes: WEIGHTS_BODY.length,
      path: weightsPath(MODEL),
      state: "ready",
    });
  });

  it("does not call weights without their tokenizer ready, since they cannot load offline", async () => {
    const store = createNodeModelStore(directory);

    await writeFile(weightsPath(MODEL), WEIGHTS_BODY);

    await expect(store.inspectModel(MODEL)).resolves.toEqual({
      loaded: WEIGHTS_BODY.length,
      state: "partial",
      total: MODEL.bytes,
    });
  });

  it("reports a model whose weights never landed as absent", async () => {
    serveFiles();
    failFetch(WEIGHTS, () => Promise.reject(new TypeError("offline")));
    const store = createNodeModelStore(directory);

    await expect(store.downloadModel(MODEL, ignore)).rejects.toThrow("offline");
    await expect(store.inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });
});

describe("downloadModel on disk", () => {
  it("keeps the tokenizer before the weights, and leaves no half-written file", async () => {
    const asked = serveFiles();
    const store = createNodeModelStore(directory);

    await store.downloadModel(MODEL, ignore);

    expect(asked.toSorted()).toEqual(EVERYTHING.toSorted());
    expect(asked.at(-1)).toBe(WEIGHTS);
    const names = await readdir(directory);

    expect(names).toHaveLength(3);
    expect(names.some((name) => name.includes(".part-"))).toBe(false);
  });

  it("fetches only what is missing and reports already kept weights complete", async () => {
    const store = createNodeModelStore(directory);

    await writeFile(weightsPath(MODEL), WEIGHTS_BODY);
    const asked = serveFiles();
    const reported: Array<number> = [];

    await store.downloadModel(MODEL, (fraction) => {
      reported.push(fraction);
    });

    expect(asked.toSorted()).toEqual([TOKENIZER, TOKENIZER_CONFIG].toSorted());
    expect(reported).toEqual([1]);
  });

  it("rejects when saving the weights fails", async () => {
    serveFiles();
    refuseSavingAt(WEIGHTS);

    await expect(createNodeModelStore(directory).downloadModel(MODEL, ignore)).rejects.toThrow(
      "EEXIST",
    );
  });
});

describe("openModel on disk", () => {
  it("downloads what is missing and hands back the tokenizer pair and the weights", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);

    await expect(store.openModel(MODEL, ignore)).resolves.toEqual({
      tokenizer: TOKENIZER_JSON,
      tokenizerConfig: TOKENIZER_JSON,
      weights: WEIGHTS_BODY,
    });
    await expect(store.inspectModel(MODEL)).resolves.toMatchObject({ state: "ready" });
  });

  it("opens a model it already keeps again without the network", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);
    const first = await store.openModel(MODEL, ignore);
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));

    vi.stubGlobal("fetch", offline);

    await expect(store.openModel(MODEL, ignore)).resolves.toEqual(first);
    expect(offline).not.toHaveBeenCalled();
  });

  it("reports no download for a model it already keeps", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);
    const reported: Array<number> = [];

    await store.downloadModel(MODEL, ignore);
    await store.openModel(MODEL, (fraction) => {
      reported.push(fraction);
    });

    expect(reported).toEqual([]);
  });

  it("stops downloading the weights when the load is stopped", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);
    const controller = new AbortController();

    stopAt(WEIGHTS, controller);

    await expect(store.openModel(MODEL, ignore, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(store.inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });

  it("reports the weights' progress and not the tokenizer's", async () => {
    const asked = serveFiles();
    const reported: Array<{ fraction: number; weightsAsked: boolean }> = [];

    await createNodeModelStore(directory).openModel(MODEL, (fraction) => {
      reported.push({ fraction, weightsAsked: asked.includes(WEIGHTS) });
    });

    expect(reported.every(({ weightsAsked }) => weightsAsked)).toBe(true);
    expect(reported.at(-1)?.fraction).toBe(1);
  });

  it("still hands back the weights when they cannot be saved, and says so", async () => {
    serveFiles();
    refuseSavingAt(WEIGHTS);
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    await expect(createNodeModelStore(directory).openModel(MODEL, ignore)).resolves.toMatchObject({
      weights: WEIGHTS_BODY,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not keep the model"),
      expect.anything(),
    );
  });

  it("deletes superseded revisions and dropped exports, and keeps every catalogued model", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);
    const droppedExport: ModelSpec = { ...MODEL, file: "model_fp16.onnx" };
    const unrelated = path.join(directory, "notes.txt");
    const inFlight = `${weightsPath(superseded(OTHER))}.part-0`;

    await store.downloadModel(superseded(MODEL), ignore);
    await store.downloadModel(droppedExport, ignore);
    await store.downloadModel(OTHER, ignore);
    await writeFile(unrelated, WEIGHTS_BODY);
    await writeFile(inFlight, WEIGHTS_BODY);

    await store.openModel(MODEL, ignore);

    await expect(store.inspectModel(superseded(MODEL))).resolves.toEqual({ state: "absent" });
    await expect(store.inspectModel(droppedExport)).resolves.toEqual({ state: "absent" });
    await expect(store.inspectModel(OTHER)).resolves.toMatchObject({ state: "ready" });
    await expect(store.inspectModel(MODEL)).resolves.toMatchObject({ state: "ready" });
    const left = await readdir(directory);

    expect(left).toContain(path.basename(unrelated));
    expect(left).toContain(path.basename(inFlight));
  });

  it("still opens the model when clearing superseded files fails", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    // A directory under a stale file's name cannot be removed as a file.
    await mkdir(weightsPath(superseded(MODEL)));

    await expect(store.openModel(MODEL, ignore)).resolves.toMatchObject({
      weights: WEIGHTS_BODY,
    });
    expect(warn).toHaveBeenCalledWith(
      "Could not clear superseded model weights",
      expect.anything(),
    );
  });
});

describe("removeModel on disk", () => {
  it("deletes every file of a model, and does not mind one that was never there", async () => {
    serveFiles();
    const store = createNodeModelStore(directory);

    await store.downloadModel(MODEL, ignore);
    await store.downloadModel(OTHER, ignore);
    await store.removeModel(MODEL);
    await store.removeModel(MODEL);

    await expect(store.inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
    await expect(store.inspectModel(OTHER)).resolves.toMatchObject({ state: "ready" });
  });
});
